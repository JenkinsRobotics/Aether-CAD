"""Exact finite native edge/plane contacts for the Pierce integration.

Uses FreeCAD's public Part geometry API. No mesh, sampled chord, EdgeN index or
saved sketch point replaces the source curve. Feature/reference integration is
separate; this helper does not advertise a completed constraint capability.
"""

import math
from itertools import pairwise


def _frame(frame):
    from FreeCAD import Vector

    if not isinstance(frame, dict):
        raise TypeError("Pierce needs a valid sketch frame.")
    values = []
    for key in ("originMillimeters", "xDirection", "normal"):
        v = frame.get(key)
        if (
            not isinstance(v, (list, tuple))
            or len(v) != 3
            or any(
                isinstance(x, bool)
                or not isinstance(x, (int, float))
                or not math.isfinite(x)
                for x in v
            )
        ):
            raise ValueError("Pierce needs finite sketch-frame coordinates.")
        values.append(Vector(*v))
    origin, x, normal = values
    if (
        abs(x.Length - 1) > 1e-6
        or abs(normal.Length - 1) > 1e-6
        or abs(x.dot(normal)) > 1e-6
    ):
        raise ValueError("Pierce needs an orthonormal sketch frame.")
    return origin, x, normal.cross(x), normal


def _value(coefficients, parameter):
    values = list(coefficients)
    while len(values) > 1:
        values = [(1 - parameter) * a + parameter * b for a, b in pairwise(values)]
    return values[0]


def _roots(coefficients):
    """All finite roots of the exact rational numerator in Bernstein form.

    Derivative roots partition monotone intervals. Keep a repeated boundary
    root once instead of bisecting numerical sign noise around a tangency.
    """
    scale = max(abs(v) for v in coefficients)
    if scale == 0:
        raise ValueError(
            "The curve has a span in the sketch plane; choose an isolated intersection."
        )
    values = [v / scale for v in coefficients]
    if len(values) == 1 or min(values) > 0 or max(values) < 0:
        return []
    degree = len(values) - 1
    if degree == 1:
        denominator = values[0] - values[1]
        return [values[0] / denominator] if denominator else []
    derivative = [degree * (b - a) for a, b in pairwise(values)]
    critical = _roots(derivative) if any(derivative) else []
    bounds = sorted({0.0, *critical, 1.0})
    epsilon = 16 * math.ulp(1.0)
    absolute = [abs(v) for v in values]

    def zero(t):
        return abs(_value(values, t)) <= epsilon * _value(absolute, t)

    roots = [t for t in bounds if zero(t)]
    for left, right in pairwise(bounds):
        fl, fr = _value(values, left), _value(values, right)
        if zero(left) or zero(right) or fl * fr >= 0:
            continue
        for _ in range(60):
            middle = (left + right) / 2
            fm = _value(values, middle)
            if fl * fm <= 0:
                right = middle
            else:
                left, fl = middle, fm
        roots.append((left + right) / 2)
    return sorted(roots)


def _root_direction(coefficients, parameter):
    derivative = list(coefficients)
    for order in range(1, len(coefficients)):
        degree = len(derivative) - 1
        derivative = [degree * (b - a) for a, b in pairwise(derivative)]
        slope = _value(derivative, parameter)
        if abs(slope) > _value(
            [abs(v) for v in derivative], parameter
        ) * 128 * math.ulp(1.0):
            sign = 1 if slope > 0 else -1
            return (sign if order % 2 else 0, sign * (-1) ** order, sign)
    raise ValueError(
        "The Pierce contact is locally coincident or numerically ambiguous."
    )


def edge_plane_contacts(edge, frame):
    origin, x, y, normal = _frame(frame)
    if edge.ShapeType != "Edge" or edge.isNull() or edge.Length < 1e-10:
        raise ValueError("Select a finite nondegenerate curve edge for Pierce.")
    low, high = edge.ParameterRange
    if not all(math.isfinite(v) for v in (low, high)) or high <= low:
        raise ValueError("Pierce requires a finite trimmed curve.")
    curve = edge.Curve
    # FreeCAD's public exact NURBS conversion and Bezier decomposition keep
    # weights and trimmed geometry. Their scalar plane-distance numerators
    # retain multiplicity; generic intersect() loses microns at triple roots.
    converted = edge.toNurbs().Edges[0]
    nurbs = converted.Curve.copy()
    nurbs.segment(*converted.ParameterRange)
    if all(abs((p - origin).dot(normal)) < 1e-10 for p in nurbs.getPoles()):
        raise ValueError(
            "The selected curve lies in the sketch plane; Pierce needs an isolated intersection."
        )
    periodic = curve.isPeriodic()
    period = curve.period() if periodic else None
    contacts = []
    for span in nurbs.toBezier():
        poles, weights = span.getPoles(), span.getWeights()
        if any(not math.isfinite(w) or w <= 0 for w in weights):
            raise ValueError("Pierce requires finite positive rational curve weights.")
        coefficients = [
            (p - origin).dot(normal) * w for p, w in zip(poles, weights, strict=True)
        ]
        for local in _roots(coefficients):
            p = span.value(local)
            parameter = curve.parameter(p)
            candidates = [parameter]
            if periodic:
                first = math.ceil((low - parameter - 1e-10) / period)
                last = math.floor((high - parameter + 1e-10) / period)
                candidates = [
                    parameter + turn * period for turn in range(first, last + 1)
                ]
            direction, before, after = _root_direction(coefficients, local)
            for candidate in candidates:
                if not low - 1e-9 <= candidate <= high + 1e-9:
                    continue
                candidate = max(low, min(high, candidate))
                actual = edge.valueAt(candidate)
                if (actual - p).Length > 1e-7 or abs((p - origin).dot(normal)) > 1e-7:
                    raise ValueError(
                        "The native curve-plane contact could not be resolved accurately."
                    )
                contacts.append(
                    {
                        "parameter": (candidate - low) / (high - low),
                        "p": p,
                        "direction": direction,
                        "before": before if local > 1e-10 else None,
                        "after": after if local < 1 - 1e-10 else None,
                    }
                )
    contacts.sort(key=lambda item: item["parameter"])
    unique = []

    def merge(first, second):
        first["before"] = first["before"] or second["before"]
        first["after"] = first["after"] or second["after"]
        if first["before"] and first["after"]:
            first["direction"] = (
                first["after"] if first["before"] != first["after"] else 0
            )

    for item in contacts:
        if (
            unique
            and abs(item["parameter"] - unique[-1]["parameter"]) < 1e-9
            and (item["p"] - unique[-1]["p"]).Length < 1e-7
        ):
            merge(unique[-1], item)
        else:
            unique.append(item)
    if (
        periodic
        and len(unique) > 1
        and unique[0]["parameter"] < 1e-9
        and unique[-1]["parameter"] > 1 - 1e-9
        and (unique[0]["p"] - unique[-1]["p"]).Length < 1e-7
    ):
        merge(unique[0], unique.pop())
    result = []
    for item in unique:
        p = item["p"]
        relative = p - origin
        result.append(
            {
                "parameter": item["parameter"],
                "point": [relative.dot(x), relative.dot(y)],
                "worldPoint": [p.x, p.y, p.z],
                "direction": item["direction"],
            }
        )
    return result
