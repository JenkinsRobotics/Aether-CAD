"""Native hole feature; FreeCAD PartDesign::Hole owns drilling geometry.

Property contract: FreeCAD src/Mod/PartDesign/App/FeatureHole.cpp.
"""

import math


def hole(document, body, parameters, sketches):
    profile = sketches.get(parameters.get("profile"))
    if (
        profile is None
        or profile.GeometryCount != 1
        or profile.Geometry[0].TypeId != "Part::GeomCircle"
    ):
        raise ValueError("Choose one circular sketch region for the hole center.")
    if body.Tip is None or body.Shape.isNull():
        raise ValueError("Choose an existing target body for the hole.")

    def positive(key):
        value = float(parameters.get(key, 0))
        if not math.isfinite(value) or value <= 0:
            raise ValueError(f"{key} must be positive and finite.")
        return value

    diameter, depth = positive("diameter_mm"), positive("depth_mm")
    cut = parameters.get("cut_type", "plain")
    extent = parameters.get("depth_type", "blind")
    if cut not in ("plain", "counterbore", "countersink") or extent not in (
        "blind",
        "through-all",
    ):
        raise ValueError("Unsupported hole type or depth mode.")
    head_diameter = positive("counter_diameter_mm") if cut != "plain" else diameter
    if cut != "plain" and head_diameter <= diameter:
        raise ValueError("Head diameter must exceed the hole diameter.")
    head_depth = positive("counter_depth_mm") if cut == "counterbore" else 0
    if cut == "counterbore" and extent == "blind" and head_depth >= depth:
        raise ValueError("Counterbore depth must be less than the blind hole depth.")
    angle = positive("countersink_angle_deg") if cut == "countersink" else 90
    if angle >= 180:
        raise ValueError("Countersink angle must be less than 180 degrees.")

    result = body.newObject("PartDesign::Hole", "Hole")
    result.Profile = profile
    result.Diameter = diameter
    result.DepthType = "ThroughAll" if extent == "through-all" else "Dimension"
    result.Depth = depth
    result.DrillPoint = "Flat"
    result.Reversed = bool(parameters.get("reversed", False))
    result.HoleCutType = {
        "plain": "None",
        "counterbore": "Counterbore",
        "countersink": "Countersink",
    }[cut]
    if cut != "plain":
        result.HoleCutCustomValues = True
        result.HoleCutDiameter = head_diameter
        if cut == "counterbore":
            result.HoleCutDepth = head_depth
        else:
            result.HoleCutCountersinkAngle = angle
    document.recompute()
    return result
