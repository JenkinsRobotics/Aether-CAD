"""Taper an extrusion tool through FreeCAD's public PartDesign::Draft API.

The sketch plane is neutral, including when the start is offset. Each face of
the chosen planar region is treated independently, including its inner wires.
FreeCAD owns the surface construction. End sections are checked independently:
OCCT can report a valid solid even after a cone passes through its apex.
API reference: FreeCAD src/Mod/PartDesign/App/FeatureDraft.cpp.
"""

import math


def _offset_boundary(wire, offset, *, inner=False):
    import Part

    # OCCT's generic planar offset can return null for a shrinking full circle
    # at small radii. Preserve that analytic curve directly, including its plane.
    if len(wire.Edges) == 1 and wire.isClosed() and isinstance(wire.Edges[0].Curve, Part.Circle):
        circle = wire.Edges[0].Curve
        radius = circle.Radius + (-offset if inner else offset)
        if radius <= 1e-7:
            raise ValueError("Draft crosses a circular boundary apex.")
        return Part.Face(Part.Wire([Part.makeCircle(radius, circle.Center, circle.Axis)]))
    return Part.Face(wire).makeOffset2D(offset, 2)


def _offset_section(face, offset):
    if abs(offset) < 1e-10:
        return face.copy()
    # OCCT's face offset can return null for a shrinking annulus even when
    # both boundaries are sound. Offset each material boundary independently.
    outer = _offset_boundary(face.OuterWire, offset)
    if len(outer.Faces) != 1 or len(outer.Wires) != 1:
        raise ValueError("Draft splits the outer boundary.")
    # OCCT may return a reversed offset after crossing a circular apex.
    # A real parallel boundary must retain the requested clearance.
    tolerance = max(1e-7, abs(offset) * 1e-7)
    if outer.OuterWire.distToShape(face.OuterWire)[0] < abs(offset) - tolerance:
        raise ValueError("Draft crosses the outer boundary apex.")
    section = outer
    for wire in face.Wires:
        if wire.isSame(face.OuterWire):
            continue
        # Inner wires retain the face's reversed boundary traversal, so the
        # same signed offset shrinks material by enlarging its holes.
        hole = _offset_boundary(wire, offset, inner=True)
        if len(hole.Faces) != 1 or len(hole.Wires) != 1 or hole.cut(section).Area > 1e-8:
            raise ValueError("Draft closes or intersects a hole.")
        if hole.OuterWire.distToShape(wire)[0] < abs(offset) - tolerance:
            raise ValueError("Draft crosses an inner boundary apex.")
        section = section.cut(hole)
    return section


def validate_draft(parameters):
    angle = parameters.get("draft_angle_deg", 0)
    if isinstance(angle, bool) or not isinstance(angle, (int, float)) or not math.isfinite(angle) or abs(angle) >= 90:
        raise ValueError("Extrusion draft must be finite and between -90 and 90 degrees.")
    return angle


def draft_section(face, direction, distance, angle):
    """Exact planar material section at a signed distance from the sketch."""
    try:
        section = _offset_section(face, -distance * math.tan(math.radians(angle)))
        if (section.isNull() or not section.isValid() or len(section.Faces) != 1
                or len(section.Wires) != len(face.Wires) or section.Area <= 1e-9):
            raise ValueError("The drafted section collapses or changes profile topology.")
        section.translate(direction * distance)
        return section
    except Exception as error:
        raise ValueError("Draft collapses or intersects the profile. Reduce the angle, depth or starting offset.") from error


def drafted_prism(document, planar, direction, low, high, angle, *, _relocated=False):
    import FreeCAD
    import Part

    if document is None:
        raise ValueError("Extrusion draft requires the native document context.")
    solids = []
    for face in planar.Faces:
        sections = [draft_section(face, direction, distance, angle) for distance in (low, high)]
        names = []
        try:
            body = document.addObject("PartDesign::Body", "ExtrusionDraftTool")
            names.append(body.Name)
            prism = body.newObject("PartDesign::Feature", "ExtrusionDraftPrism")
            names.append(prism.Name)
            start = face.copy()
            start.translate(direction * low)
            prism.Shape = start.extrude(direction * (high - low))
            neutral = body.newObject("PartDesign::Plane", "ExtrusionDraftNeutral")
            names.append(neutral.Name)
            neutral.Placement = FreeCAD.Placement(
                face.CenterOfMass, FreeCAD.Rotation(FreeCAD.Vector(0, 0, 1), direction)
            )
            body.Tip = prism
            sides = [f"Face{i + 1}" for i, side in enumerate(prism.Shape.Faces)
                     if not isinstance(side.Surface, Part.Plane) or abs(side.normalAt(0, 0).dot(direction)) < 1 - 1e-7]
            draft = body.newObject("PartDesign::Draft", "ExtrusionDraft")
            names.append(draft.Name)
            draft.Base = (prism, sides)
            draft.NeutralPlane = (neutral, [""])
            draft.Angle = abs(angle)
            draft.Reversed = angle < 0
            document.recompute()
            shape = draft.Shape
            if ("Invalid" in draft.State or shape.isNull() or not shape.isValid()
                    or len(shape.Solids) != 1 or shape.Volume <= 1e-9):
                if _relocated:
                    raise ValueError("The native kernel could not construct this draft. Reduce the angle, depth or starting offset.")
                # OCCT Draft can produce an invalid near-apex cone at the world
                # origin while the identical translated cone is valid. Retry
                # once in a bounded positive local frame, then undo that rigid
                # translation and apply the same exact end-section checks.
                rotation = FreeCAD.Rotation(FreeCAD.Vector(0, 0, 1), direction)
                center = rotation.inverted().multVec(face.CenterOfMass)
                scale = max(1, face.BoundBox.DiagonalLength * 2)
                shift = rotation.multVec(FreeCAD.Vector(scale - center.x, scale - center.y, 0))
                relocated = face.copy()
                relocated.translate(shift)
                shape = drafted_prism(document, relocated, direction, low, high, angle, _relocated=True)
                shape.translate(shift * -1)
            # Verify both actual end caps against independent planar offsets.
            # This also catches incorrect direction/neutral-plane interpretation.
            for expected in sections:
                caps = [cap for cap in shape.Faces if isinstance(cap.Surface, Part.Plane)
                        and abs(cap.normalAt(0, 0).dot(direction)) > 1 - 1e-7
                        and abs((cap.CenterOfMass - expected.CenterOfMass).dot(direction)) < 1e-7]
                area_error = sum(cap.Area for cap in caps) + expected.Area - 2 * sum(cap.common(expected).Area for cap in caps)
                if abs(area_error) > max(1e-7, expected.Area * 1e-7):
                    raise ValueError("Draft could not preserve the complete end profile. Reduce its angle or offset.")
            solids.append(shape.copy())
        finally:
            # Transient tool features must never become history or change the
            # destination body's tip, even when the kernel rejects a taper.
            for name in reversed(names):
                document.removeObject(name)
    if not solids:
        raise ValueError("Draft needs a closed planar region.")
    return solids[0] if len(solids) == 1 else solids[0].multiFuse(solids[1:]).removeSplitter()
