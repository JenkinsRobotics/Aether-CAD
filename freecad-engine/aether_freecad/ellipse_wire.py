"""Exact ellipse arcs through FreeCAD's public Part.Ellipse/ArcOfEllipse API.

The wire contract uses Aether's existing SVG endpoint-arc frame, in millimeters
and radians. Geometry remains analytic; it is never sampled for construction.
"""

import math


def ellipse_wire_segment(start, end, frame, part, vector):
    if not isinstance(frame, dict):
        raise TypeError("An ellipse segment needs its exact ellipse_frame")
    center = frame.get("center")
    if not isinstance(center, (list, tuple)) or len(center) != 2:
        raise ValueError("An ellipse center needs two coordinates")
    values = [
        *center,
        *(
            frame.get(key)
            for key in ("radiusX", "radiusY", "rotation", "startAngle", "sweep")
        ),
    ]
    if any(
        type(value) not in (float, int) or not math.isfinite(value) for value in values
    ):
        raise ValueError("Ellipse geometry must be finite")
    cx, cy, rx, ry, rotation, begin, sweep = values
    if rx <= 0 or ry <= 0 or not 1e-12 < abs(sweep) <= math.tau + 1e-10:
        raise ValueError("Ellipse radii and sweep must be nonzero and valid")
    cosine, sine = math.cos(rotation), math.sin(rotation)

    def at(angle):
        x, y = rx * math.cos(angle), ry * math.sin(angle)
        return (cx + cosine * x - sine * y, cy + sine * x + cosine * y)

    tolerance = 1e-7 * max(1, rx, ry)
    if any(
        math.dist(point, at(angle)) > tolerance
        for point, angle in ((start, begin), (end, begin + sweep))
    ):
        raise ValueError("Ellipse frame does not match its wire endpoints")
    # Equal radii are an exact circle. Native Ellipse's major-axis choice is
    # undefined in this case; a three-point circular arc retains the traversal.
    if rx == ry:
        return part.Arc(
            vector(*start, 0), vector(*at(begin + sweep / 2), 0), vector(*end, 0)
        )
    # OCCT expects major radius first. Swapping axes is a quarter-turn of its
    # parameter, not a change to the authored ellipse or its traversal.
    if rx >= ry:
        major, minor, angle, parameter = rx, ry, rotation, begin
    else:
        major, minor, angle, parameter = (
            ry,
            rx,
            rotation + math.pi / 2,
            begin - math.pi / 2,
        )
    direction = 1 if sweep > 0 else -1
    origin = vector(cx, cy, 0)
    primary = origin + vector(major * math.cos(angle), major * math.sin(angle), 0)
    secondary = origin + vector(
        -direction * minor * math.sin(angle), direction * minor * math.cos(angle), 0
    )
    ellipse = part.Ellipse(primary, secondary, origin)
    return part.ArcOfEllipse(
        ellipse, direction * parameter, direction * parameter + abs(sweep)
    )
