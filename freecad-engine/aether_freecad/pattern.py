"""Native feature patterns; FreeCAD owns transforms and additive/subtractive tools.

Property contracts: PartDesign FeatureLinearPattern/FeaturePolarPattern and
Part LinearPatternExtension/PolarPatternExtension. Count includes the seed.
"""

import math


def pattern(document, body, parameters, built):
    source = built.get(parameters.get("source"))
    if source is None or source not in body.Group:
        raise ValueError("Choose a source feature in the selected target body.")
    if not source.isDerivedFrom("PartDesign::ProfileBased"):
        raise ValueError(
            "Choose an additive or subtractive profile feature to pattern."
        )
    count = parameters.get("count")
    if isinstance(count, bool) or not isinstance(count, int) or count < 2:
        raise ValueError(
            "Pattern needs at least two occurrences, including the original."
        )
    kind = parameters.get("pattern_type")
    axis_name = parameters.get("axis")
    if kind not in ("linear", "polar") or axis_name not in ("X", "Y", "Z"):
        raise ValueError("Unsupported pattern type or axis.")
    axis = next(
        (
            a
            for a in body.Origin.OriginFeatures
            if getattr(a, "Role", "") == f"{axis_name}_Axis"
        ),
        None,
    )
    if axis is None:
        raise ValueError("The pattern axis is unavailable.")
    if kind == "linear":
        extent = float(parameters.get("spacing_mm", 0)) * (count - 1)
        if not math.isfinite(extent) or extent <= 0:
            raise ValueError("Pattern spacing must be positive and finite.")
    else:
        extent = float(parameters.get("angle_deg", 0))
        if not math.isfinite(extent) or not 0 < extent <= 360:
            raise ValueError(
                "Pattern angle must be greater than 0 and at most 360 degrees."
            )
    result = body.newObject(
        "PartDesign::LinearPattern" if kind == "linear" else "PartDesign::PolarPattern",
        "Pattern",
    )
    result.Originals = [source]
    result.Occurrences = count
    result.Reversed = bool(parameters.get("reversed", False))
    if kind == "linear":
        result.Direction = (axis, [""])
        result.Length = extent
    else:
        result.Axis = (axis, [""])
        result.Angle = extent
    body.Tip = result
    document.recompute()
    return result
