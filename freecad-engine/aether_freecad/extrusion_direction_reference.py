"""Evaluate an authored sketch line in its current native support frame."""
import math


def resolve_direction_reference(parameters, built):
    if "direction_reference" not in parameters:
        return dict(parameters)
    from FreeCAD import Vector

    from aether_freecad.sketch_support import resolve_support

    ref = parameters["direction_reference"]
    if (not isinstance(ref, dict) or ref.get("kind") != "sketch-line"
            or "direction_vector" in parameters):
        raise ValueError("Choose either a sketch-line reference or a manual extrusion direction.")
    local = ref.get("local_vector")
    if (not isinstance(local, list) or len(local) != 2
            or any(isinstance(v, bool) or not isinstance(v, (float, int)) or not math.isfinite(v) for v in local)
            or not math.isfinite(math.hypot(*local)) or math.hypot(*local) < 1e-9):
        raise ValueError("Extrusion direction line must have finite nonzero length.")
    if "support" in ref:
        if not isinstance(ref["support"], dict):
            raise TypeError("Extrusion direction sketch support is unavailable.")
        frame = resolve_support(ref["support"], built)
    else:
        frame = ref.get("frame")
    if not isinstance(frame, dict):
        raise TypeError("Extrusion direction sketch frame is unavailable.")
    axes = [frame.get("xDirection"), frame.get("normal")]
    if any(not isinstance(axis, list) or len(axis) != 3
           or any(isinstance(v, bool) or not isinstance(v, (float, int)) or not math.isfinite(v) for v in axis)
           or abs(math.hypot(*axis) - 1) > 1e-6 for axis in axes):
        raise ValueError("Extrusion direction sketch requires a valid orthonormal frame.")
    x, normal = (Vector(*axis) for axis in axes)
    if abs(x.dot(normal)) > 1e-6:
        raise ValueError("Extrusion direction sketch requires a valid orthonormal frame.")
    direction = x * local[0] + normal.cross(x) * local[1]
    direction.normalize()
    result = dict(parameters)
    del result["direction_reference"]
    result["direction_vector"] = [direction.x, direction.y, direction.z]
    return result
