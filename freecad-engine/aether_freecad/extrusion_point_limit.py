"""Resolve selected points in current native history, then an axial end depth."""
import math


def resolve_point(reference, built):
    from FreeCAD import Vector

    from aether_freecad.sketch_support import resolve_support
    from aether_freecad.vertex_reference import resolve_vertex

    if not isinstance(reference, dict):
        raise TypeError("Up to vertex requires a stopping point reference.")
    if reference.get("kind") == "solid-vertex":
        shape = built.get((reference.get("sourceFeatureId"), reference.get("bodyId")))
        if shape is None or shape.isNull():
            raise ValueError("Stopping vertex source is unavailable. Reselect an earlier part vertex.")
        return resolve_vertex(shape, reference.get("anchor"))
    if reference.get("kind") != "sketch-point":
        raise ValueError("Unsupported stopping point reference.")
    frame = resolve_support(reference["support"], built) if "support" in reference else reference.get("frame")
    local = reference.get("local_point")
    def finite_vector(value, size):
        return (isinstance(value, list) and len(value) == size
                and all(not isinstance(v, bool) and isinstance(v, (int, float)) and math.isfinite(v) for v in value))
    if (not isinstance(frame, dict) or not finite_vector(local, 2)
            or any(not finite_vector(frame.get(key), 3) for key in ("originMillimeters", "normal", "xDirection"))):
        raise ValueError("Stopping sketch point needs a finite point and valid frame.")
    origin, normal, x_axis = (Vector(*frame[key]) for key in ("originMillimeters", "normal", "xDirection"))
    if abs(normal.Length - 1) > 1e-6 or abs(x_axis.Length - 1) > 1e-6 or abs(x_axis.dot(normal)) > 1e-6:
        raise ValueError("Stopping sketch point needs an orthonormal frame.")
    return origin + x_axis * local[0] + normal.cross(x_axis) * local[1]


def point_depth(planar, direction, point, start_offset, end_offset):
    from aether_freecad.extrusion_direction import profile_axis

    if point is None:
        raise ValueError("Select a stopping vertex.")
    normal, alignment = profile_axis(planar, direction)
    depth = normal.dot(point - planar.CenterOfMass) / alignment - end_offset
    if not math.isfinite(depth) or depth <= start_offset + 1e-7:
        raise ValueError("The stopping point leaves no extrusion beyond its start. Flip direction or adjust the offset.")
    return depth
