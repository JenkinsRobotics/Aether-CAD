"""Configure native Revolution/Groove angular limits; no UI or host dependencies."""

import math


def configure_revolve_extent(feature, parameters):
    angle = float(parameters.get("angle_deg", 360))
    second = float(parameters.get("second_angle_deg", 0))
    symmetric = parameters.get("symmetric", False)
    reversed_direction = parameters.get("reversed", False)
    if not isinstance(symmetric, bool) or not isinstance(reversed_direction, bool):
        raise TypeError("Revolve direction flags must be booleans.")
    if (
        not all(math.isfinite(v) for v in (angle, second))
        or angle <= 0
        or second < 0
        or angle + second > 360
    ):
        raise ValueError(
            "Revolve angles must be finite, positive and total at most 360 degrees."
        )
    if symmetric and second:
        raise ValueError("Symmetric revolve cannot also have a second angle.")
    feature.Type = "TwoAngles" if second else "Angle"
    feature.Angle = angle
    feature.Angle2 = second
    feature.Midplane = symmetric
    feature.Reversed = reversed_direction
