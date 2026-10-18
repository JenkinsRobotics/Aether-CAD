"""Transient transform gizmo bounds from exact selected source solids."""
import math


def transform_frame(before, parameters):
    keys = parameters.get('body_ids', [])
    if not keys or any(key not in before for key in keys):
        return None
    # FreeCAD's BoundBox may use cached triangulation. Remove that display data
    # from the temporary shape so curved anchors cannot drift with mesh quality.
    boxes = [before[key].cleaned().BoundBox for key in keys]
    low = [min(getattr(box, axis+'Min') for box in boxes) for axis in 'XYZ']
    high = [max(getattr(box, axis+'Max') for box in boxes) for axis in 'XYZ']
    center = [(a+b)/2 for a, b in zip(low, high)]
    radius = math.dist(low, high)/2
    if not all(math.isfinite(v) for v in [*center, radius]) or radius <= 0:
        return None
    return {'center_mm': center, 'radius_mm': radius}
