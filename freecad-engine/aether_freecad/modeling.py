"""Aether feature adapters; evaluated by FreeCAD, never by the browser."""

import FreeCAD
import Part


def apply_frame(sketch, frame):
    if not frame:
        return
    origin = FreeCAD.Vector(*frame["originMillimeters"])
    x = FreeCAD.Vector(*frame["xDirection"])
    normal = FreeCAD.Vector(*frame["normal"])
    y = normal.cross(x)
    sketch.Placement = FreeCAD.Placement(origin, FreeCAD.Rotation(x, y, normal, "ZXY"))


def body_sketch(document, body, source):
    """A profile can be reused by several bodies without moving its source."""
    tip = body.Tip
    sketch = document.copyObject(source, False)
    body.addObject(sketch)
    if tip:
        body.Tip = tip
    return sketch


def sweep(document, body, parameters, sketches):
    profile = sketches.get(parameters.get("profile"))
    path = sketches.get(parameters.get("path"))
    if profile is None or path is None:
        raise ValueError("Sweep requires a profile and a path.")
    document.recompute()
    feature = document.addObject(
        "PartDesign::SubtractivePipe"
        if parameters.get("cut")
        else "PartDesign::AdditivePipe",
        "Sweep",
    )
    body.addObject(feature)
    feature.Profile = profile
    feature.Spine = (path, [f"Edge{i + 1}" for i in range(len(path.Shape.Edges))])
    body.Tip = feature
    return feature


def faces_in_plane(shape, plane, offset):
    axis = {"XY": 2, "XZ": 1, "YZ": 0}.get(plane)
    if axis is None:
        raise ValueError("Unknown removed-face plane.")
    result = []
    for index, face in enumerate(shape.Faces):
        # Vertices alone also match curved faces with a single seam vertex.
        if not isinstance(face.Surface, Part.Plane):
            continue
        box = face.BoundBox
        bounds = [(box.XMin, box.XMax), (box.YMin, box.YMax), (box.ZMin, box.ZMax)][
            axis
        ]
        if all(abs(value - offset) < 1e-6 for value in bounds):
            result.append(f"Face{index + 1}")
    return result


def shell(document, body, parameters):
    document.recompute()
    tip = body.Tip
    if tip is None or tip.Shape.isNull():
        raise ValueError("Shell requires a solid.")
    thickness = float(parameters.get("thickness_mm", 0))
    if thickness <= 0:
        raise ValueError("Shell thickness must be positive.")
    plane = parameters.get("removed_plane")
    if not plane:
        # A closed shell removes an inward offset solid from the original.
        inside = tip.Shape.makeOffsetShape(-thickness, 0.0001)
        result = tip.Shape.cut(inside)
        if inside.isNull() or result.isNull() or result.Volume >= tip.Shape.Volume:
            raise ValueError("Thickness does not leave a valid inner cavity.")
        feature = document.addObject("PartDesign::Feature", "ClosedShell")
        body.addObject(feature)
        feature.Shape = result
    else:
        faces = faces_in_plane(
            tip.Shape, plane, float(parameters.get("removed_offset_mm", 0))
        )
        if not faces:
            raise ValueError("shell matched no face on that plane to open")
        feature = document.addObject("PartDesign::Thickness", "Shell")
        body.addObject(feature)
        feature.Base = (tip, faces)
        feature.Value = thickness
        feature.Reversed = True
        feature.Mode = 0
        feature.Join = 0
    body.Tip = feature
    return feature
