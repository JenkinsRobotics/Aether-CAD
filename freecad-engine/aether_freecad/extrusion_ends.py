"""Compose independent extrusion ends using one sketch and native tools."""
import math


def validate_ends(parameters):
    if parameters.get("second_distance_mm") and parameters.get("end_type", "blind") != "blind":
        raise ValueError("Legacy opposite depth requires Blind.")
    second = parameters.get("second_end")
    if second is None:
        return
    if not isinstance(second, dict):
        raise TypeError("Second end must contain extrusion end parameters.")
    if parameters.get("second_distance_mm"):
        raise ValueError("Choose one second-end definition, not both legacy depth and independent end.")
    if parameters.get("end_type") in ("symmetric", "symmetric-through-all"):
        raise ValueError("Symmetric and an independent second end are mutually exclusive.")
    allowed = {"end_type", "distance_mm", "end_offset_mm", "end_reference", "end_part_id", "end_point_reference", "_limit_point", "draft_angle_deg", "_limit_face", "_limit_shape"}
    if set(second) - allowed:
        raise ValueError("Invalid second-end parameters.")
    if second.get("end_type", "blind") not in ("blind", "through-all", "up-to-next", "up-to-face", "up-to-part", "up-to-vertex"):
        raise ValueError("Invalid second-end condition.")
    distance = second.get("distance_mm", 1)
    if isinstance(distance, bool) or not isinstance(distance, (int, float)) or not math.isfinite(distance) or distance <= 0:
        raise ValueError("Second-end depth must be finite and positive.")


def independent_ends(planar, direction, target, parameters, document, single):
    """Return None for the unchanged legacy single-interval path.

    Offset locates a common start plane. Both draft angles retain the original
    sketch as neutral. A second end uses the opposite direction and signed
    start offset, so old straight two-ended documents retain their interval.
    """
    import Part

    validate_ends(parameters)
    angle = parameters.get("draft_angle_deg", 0)
    second = parameters.get("second_end")
    symmetric = parameters.get("end_type") in ("symmetric", "symmetric-through-all")
    through = parameters.get("end_type") == "symmetric-through-all"
    legacy_depth = parameters.get("second_distance_mm", 0)
    if second is None and not through and not (angle and (symmetric or legacy_depth)):
        return None
    primary = dict(parameters)
    primary.pop("second_end", None)
    primary.pop("second_distance_mm", None)
    if symmetric:
        depth = float(parameters.get("distance_mm", parameters.get("depth_mm", 0))) / 2
        mode = "through-all" if through else "blind"
        primary.update(end_type=mode, distance_mm=depth)
        second = {"end_type": mode, "distance_mm": depth, "draft_angle_deg": angle}
    elif second is None:
        second = {"end_type": "blind", "distance_mm": legacy_depth}
    opposite = {"operation": parameters.get("operation"), "starting_offset_mm": -float(parameters.get("starting_offset_mm", 0)),
                "_scope_allow_no_hit": parameters.get("_scope_allow_no_hit", False), **second}
    # A target can lie entirely on either side. Through-all may be empty on
    # one side as long as the combined tool reaches the target on the other.
    primary["_allow_empty_through_all"] = True
    opposite["_allow_empty_through_all"] = True
    tools = [single(planar, direction, target, primary, document),
             single(planar, direction * -1, target, opposite, document)]
    tools = [tool for tool in tools if not tool.isNull() and tool.Solids]
    if not tools:
        if parameters.get("_scope_allow_no_hit") and parameters.get("operation") == "cut":
            return Part.Shape()
        raise ValueError("Neither extrusion end reaches the target part.")
    return tools[0] if len(tools) == 1 else tools[0].fuse(tools[1]).removeSplitter()
