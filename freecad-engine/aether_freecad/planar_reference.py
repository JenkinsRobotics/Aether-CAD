"""Conservative geometric face selection shared by planar feature references."""
import math


def resolve_planar_face(shape, normal, label, anchor=None):
    import FreeCAD
    import Part

    if not math.isfinite(normal.Length) or abs(normal.Length - 1) > 1e-6:
        raise ValueError(f"{label} needs a unit planar normal.")
    if anchor is not None:
        center = anchor.get("centerMillimeters") if isinstance(anchor, dict) else None
        area = anchor.get("areaSquareMillimeters") if isinstance(anchor, dict) else None
        if (not isinstance(center, list) or len(center) != 3
                or any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in center)
                or isinstance(area, bool) or not isinstance(area, (int, float)) or not math.isfinite(area) or area <= 0):
            raise ValueError(f"{label} has an invalid planar face anchor. Reselect the face.")
        center = FreeCAD.Vector(*center)
    matches = []
    for face in shape.Faces:
        if not isinstance(face.Surface, Part.Plane):
            continue
        u, v = face.Surface.parameter(face.CenterOfMass)
        if face.normalAt(u, v).dot(normal) <= 1 - 1e-7:
            continue
        if anchor is not None and ((face.CenterOfMass - center).Length > 1e-6
                                   or abs(face.Area - area) > max(1e-6, area * 1e-9)):
            continue
        matches.append(face)
    if len(matches) != 1:
        qualifier = "changed or is ambiguous" if anchor is not None else "is missing or ambiguous"
        raise ValueError(f"{label} face {qualifier}. Reselect the face on the earlier geometry.")
    return matches[0]
