"""Exact rho-defined conics via FreeCAD's public quadratic NURBS API.

The endpoint tangent intersection is the middle pole. Rho measures the curve's
midpoint along the chord-midpoint/control line, so the middle weight is
rho/(1-rho), not rho. No sampling or cubic approximation constructs this curve.
"""

import math


def conic_wire_segment(start, end, control, rho, part, vector):
    for point in (start, end, control):
        if (
            not isinstance(point, (tuple, list))
            or len(point) != 2
            or any(
                type(value) not in (int, float) or not math.isfinite(value)
                for value in point
            )
        ):
            raise ValueError("Conic points must contain two finite coordinates")
    if type(rho) not in (int, float) or not math.isfinite(rho) or not 0 < rho < 1:
        raise ValueError("Conic rho must be greater than 0 and less than 1")
    a = [control[i] - start[i] for i in (0, 1)]
    b = [end[i] - start[i] for i in (0, 1)]
    la, lb = math.hypot(*a), math.hypot(*b)
    if (
        not math.isfinite(la)
        or not math.isfinite(lb)
        or la < 1e-9
        or lb < 1e-9
        or abs((a[0] / la) * (b[1] / lb) - (a[1] / la) * (b[0] / lb)) < 1e-12
    ):
        raise ValueError(
            "Conic endpoints and control must be distinct and noncollinear"
        )
    curve = part.BSplineCurve()
    # Public signature verified in FreeCAD Part/App/BSplineCurvePyImp.cpp.
    # Three poles, clamped endpoints, degree two, one rational middle weight.
    curve.buildFromPolesMultsKnots(
        [vector(*p, 0) for p in (start, control, end)],
        [3, 3],
        [0.0, 1.0],
        False,
        2,
        [1.0, rho / (1 - rho), 1.0],
    )
    return curve
