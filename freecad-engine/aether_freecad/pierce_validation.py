"""Verify resolved canonical Pierce relations against actual native geometry.

The saved relationship is resolved by CAD before translation. This boundary
independently checks its exact source B-rep contact and selected target entity;
it must never silently accept a stale browser cache or native placement change.
"""
import math

from aether_freecad.pierce import edge_plane_contacts


def validate_pierce_contacts(sketch, parameters, sketches):
    import FreeCAD
    import Part

    checks = parameters.get("pierce_checks", [])
    if not isinstance(checks, list) or len(checks) > 512:
        raise ValueError("Invalid Pierce native checks.")
    if not checks:
        return
    sketch.Document.recompute()
    placement = sketch.Placement
    origin = placement.multVec(FreeCAD.Vector())
    frame = {
        "originMillimeters": list(origin),
        "xDirection": list(placement.Rotation.multVec(FreeCAD.Vector(1, 0, 0))),
        "normal": list(placement.Rotation.multVec(FreeCAD.Vector(0, 0, 1))),
    }
    for check in checks:
        if not isinstance(check, dict):
            raise TypeError("Invalid Pierce native check.")
        source = sketches.get(check.get("source_sketch"))
        if source is None or len(source.Shape.Edges) != 1:
            raise ValueError("Pierce source native curve is missing or ambiguous.")
        world = check.get("world_point")
        if not isinstance(world, list) or len(world) != 3 or not all(type(v) in (int, float) and math.isfinite(v) for v in world):
            raise ValueError("Invalid derived Pierce world contact.")
        hits = [hit for hit in edge_plane_contacts(source.Shape.Edges[0], frame) if math.dist(hit["worldPoint"], world) < 1e-7]
        if len(hits) != 1:
            raise ValueError("The Pierce source contact changed during native rebuilding. Resolve the sketch again.")
        point = FreeCAD.Vector(*hits[0]["point"], 0)
        target = check.get("target", {})
        if not isinstance(target, dict):
            raise TypeError("Invalid Pierce native target.")
        index = target.get("geometry")
        if type(index) is not int or index < 0 or index >= sketch.GeometryCount:
            raise ValueError("Pierce native target geometry is missing.")
        geometry = sketch.Geometry[index]
        kind = target.get("kind")
        if kind == "curve":
            error = geometry.toShape().distToShape(Part.Vertex(point))[0]
        elif kind == "center" and isinstance(geometry, Part.Circle):
            error = (geometry.Center - point).Length
        elif kind == "control" and isinstance(geometry, Part.BSplineCurve):
            poles, control, scale = geometry.getPoles(), target.get("control"), target.get("scale", 1)
            if type(control) is not int or control not in (0, 1) or type(scale) not in (int, float) or not math.isfinite(scale) or scale <= 0:
                raise ValueError("Invalid Pierce control point.")
            anchor, pole = (poles[0], poles[1]) if control == 0 else (poles[-1], poles[-2])
            error = (anchor + (pole - anchor) * scale - point).Length
        elif kind == "endpoint":
            expected = target.get("local_point")
            if not isinstance(expected, list) or len(expected) != 2 or not all(type(v) in (int, float) and math.isfinite(v) for v in expected):
                raise ValueError("Invalid Pierce endpoint correspondence.")
            local = FreeCAD.Vector(*expected, 0)
            matches = [v.Point for v in geometry.toShape().Vertexes if (v.Point - local).Length < 1e-7]
            if len(matches) != 1:
                raise ValueError("Pierce target endpoint changed in the native sketch.")
            error = (matches[0] - point).Length
        else:
            raise ValueError("Unsupported Pierce native target.")
        if not math.isfinite(error) or error >= 1e-7:
            raise ValueError("Native sketch geometry does not satisfy the Pierce constraint.")
