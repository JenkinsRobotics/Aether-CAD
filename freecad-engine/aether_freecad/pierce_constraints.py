"""Isolated native Sketcher proof path for the pending Pierce integration.

Public FreeCAD Sketcher Coincident/PointOnObject/Block APIs. Inputs are exact
curves and resolved reference contacts, not mesh points. Callers own the saved
source/branch reference; this adapter independently verifies it on the B-rep.
No existing document is mutated, even when a solve fails. Not yet advertised
as a worker command or saved Part constraint.
"""

import math

from aether_freecad.pierce import _frame, edge_plane_contacts


def solve_pierce_sketch(geometry, constraints, frame, targets, construction=()):
    """Return solved copies of the input geometry, without synthetic points.

    Each target contains source_edge (a world-space Part.Edge), world_point
    (derived, never persisted) and geometry index. Optional position selects a
    Sketcher endpoint/center; omission attaches the finite target curve.
    """
    import FreeCAD as App
    import Part
    import Sketcher

    _frame(frame)
    if not isinstance(targets, (list, tuple)) or not targets:
        raise ValueError("Select at least one Pierce target.")
    if len(geometry) > 1000 or len(targets) + len(constraints) > 512:
        raise ValueError("Too many Pierce sketch entities or constraints.")
    if any(type(i) is not int or i < 0 or i >= len(geometry) for i in construction):
        raise ValueError("Invalid construction geometry index.")
    prepared = []
    for target in targets:
        if not isinstance(target, dict):
            raise TypeError("Invalid Pierce target.")
        index, position = target.get("geometry"), target.get("position")
        if type(index) is not int or index < 0 or index >= len(geometry):
            raise ValueError("Pierce target geometry is missing.")
        if position is not None and (
            type(position) is not int or position not in (1, 2, 3)
        ):
            raise ValueError("Pierce target must name a native endpoint or center.")
        curve = geometry[index]
        if position is not None:
            allowed = (
                (1,) if isinstance(curve, Part.Point)
                else (3,) if isinstance(curve, (Part.Circle, Part.Ellipse))
                else (1, 2, 3) if isinstance(curve, (Part.ArcOfCircle, Part.ArcOfEllipse))
                else (1, 2) if isinstance(curve, (Part.LineSegment, Part.BSplineCurve))
                else ()
            )
            if position not in allowed:
                raise ValueError("Pierce target position does not belong to this geometry.")
        elif not hasattr(curve, "toShape") or curve.toShape().ShapeType != "Edge":
            raise ValueError("Pierce needs a finite target curve.")
        world = target.get("world_point")
        if (
            not isinstance(world, (list, tuple))
            or len(world) != 3
            or any(type(v) not in (float, int) or not math.isfinite(v) for v in world)
        ):
            raise ValueError("Pierce needs a finite derived world contact.")
        contacts = edge_plane_contacts(target["source_edge"], frame)
        matches = [
            hit
            for hit in contacts
            if math.dist(hit["worldPoint"], world) < 1e-7
        ]
        if len(matches) != 1:
            raise ValueError("The selected Pierce contact is missing or ambiguous.")
        prepared.append((index, position, App.Vector(*matches[0]["point"], 0)))

    blocked = {
        c.First: geometry[c.First].copy()
        for c in constraints
        if c.Type == "Block" and c.IsActive and 0 <= c.First < len(geometry)
    }

    def fixed_unchanged(current):
        # This FreeCAD build can replace a Block endpoint when Coincident
        # eliminates coordinates and still return solve()==0. Guard the actual
        # frozen geometry, including trims, instead of trusting only that code.
        for index, original in blocked.items():
            actual = current[index]
            if not original.isSame(actual, 1e-7, 1e-9):
                raise ValueError("Pierce conflicts with fixed sketch geometry.")
            first, second = original.toShape().Vertexes, actual.toShape().Vertexes
            if len(first) != len(second) or any(
                (a.Point - b.Point).Length >= 1e-7
                for a, b in zip(first, second, strict=True)
            ):
                raise ValueError("Pierce conflicts with fixed sketch geometry.")

    previous = App.activeDocument()
    document = App.newDocument("AetherPierceSolve")
    try:
        sketch = document.addObject("Sketcher::SketchObject", "Target")
        def add(constraint):
            if sketch.addConstraint(constraint) < 0:
                raise ValueError("Pierce constraint could not be added to the sketch.")

        for index, curve in enumerate(geometry):
            sketch.addGeometry(curve.copy(), index in construction)
        for constraint in constraints:
            add(constraint)
        # Native Block captures its geometry when the solver initializes. Solve
        # the existing system before introducing any new contact equations.
        if sketch.solve() != 0:
            raise ValueError("Existing sketch constraints cannot be solved.")
        fixed_unchanged(sketch.Geometry)
        # A fully local sketch suffices: the plane transformation has already
        # been validated when deriving the exact local point from the source.
        fixed_points = []
        for index, position, point in prepared:
            fixed = sketch.addGeometry(Part.Point(point), True)
            fixed_points.append((fixed, point))
            add(Sketcher.Constraint("Block", fixed))
            if sketch.solve() != 0:
                raise ValueError("The Pierce source point could not be fixed.")
            if position is None:
                add(
                    Sketcher.Constraint("PointOnObject", fixed, 1, index)
                )
            else:
                add(
                    Sketcher.Constraint("Coincident", index, position, fixed, 1)
                )
        if sketch.solve() != 0:
            raise ValueError("Pierce conflicts with the existing sketch constraints.")
        document.recompute()
        solved = [sketch.Geometry[i].copy() for i in range(len(geometry))]
        fixed_unchanged(solved)
        if any((sketch.getPoint(index, 1) - point).Length >= 1e-7 for index, point in fixed_points):
            raise ValueError("Pierce cannot move its read-only source intersection.")
        for index, position, point in prepared:
            if position is not None:
                error = (sketch.getPoint(index, position) - point).Length
            else:
                # Sketcher PointOnObject uses an underlying curve. The finite
                # boundary is part of our contract and must also contain it.
                error = solved[index].toShape().distToShape(Part.Vertex(point))[0]
            if not math.isfinite(error) or error >= 1e-7:
                raise ValueError("Pierce contact lies outside the finite target curve.")
        return solved
    finally:
        App.closeDocument(document.Name)
        if previous is not None:
            App.setActiveDocument(previous.Name)
