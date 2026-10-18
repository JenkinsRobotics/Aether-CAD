"""Bounded, rebuild-dependent extrusion intervals in the profile direction."""

import math
from itertools import product


def extrusion_tool(planar, direction, target, parameters, document=None):
    from aether_freecad.extrusion_ends import independent_ends
    from aether_freecad.extrusion_start import starting_parameters

    parameters = starting_parameters(planar, direction, parameters)
    tool = independent_ends(planar, direction, target, parameters, document, _single_ended_tool)
    result = tool if tool is not None else _single_ended_tool(planar, direction, target, parameters, document)
    from aether_freecad.extrusion_preview_axes import capture_preview_axes
    capture_preview_axes(planar, direction, parameters)
    return result


def _single_ended_tool(planar, direction, target, parameters, document=None):
    from FreeCAD import Vector

    from aether_freecad.extrusion_draft import validate_draft

    draft_angle = validate_draft(parameters)

    mode = parameters.get("end_type", "blind")
    depth = float(parameters.get("distance_mm", parameters.get("depth_mm", 0)))
    offset = float(parameters.get("starting_offset_mm", 0))
    end_offset = float(parameters.get("end_offset_mm", 0))
    second = float(parameters.get("second_distance_mm") or 0)
    if (
        not all(math.isfinite(v) for v in (depth, offset, second, end_offset))
        or depth <= 0
        or second < 0
    ):
        raise ValueError("Extrusion depths must be finite and positive.")
    if end_offset and mode not in ("up-to-next", "up-to-face", "up-to-part", "up-to-vertex"):
        raise ValueError("End offset requires a supported stopping limit.")
    if second and mode != "blind":
        raise ValueError("Opposite depth requires Blind.")
    low, high = offset - second, offset + depth
    if mode == "up-to-vertex":
        from aether_freecad.extrusion_point_limit import point_depth
        high = point_depth(planar, direction, parameters.get("_limit_point"), offset, end_offset)
        low = offset
        mode = "blind"
    if mode == "up-to-part":
        import Part

        from aether_freecad.extrusion_part_limit import to_part
        return Part.makeCompound([to_part(document, face, direction, offset, draft_angle,
            parameters.get("_limit_shape"), end_offset) for face in planar.Faces])
    if mode == "up-to-face":
        import Part

        limit = parameters.get("_limit_face")
        if limit is None:
            raise ValueError("Up to face needs an available stopping face.")
        if not isinstance(limit.Surface, Part.Plane):
            from aether_freecad.extrusion_surface_limit import to_surface
            return Part.makeCompound([to_surface(document, face, direction, offset, draft_angle, limit, end_offset) for face in planar.Faces])
        normal = limit.normalAt(0, 0)
        alignment = normal.dot(direction)
        if abs(alignment) < 1e-7:
            raise ValueError("The stopping plane is parallel to the extrusion direction. Select another face.")
        if draft_angle:
            from aether_freecad.extrusion_draft_limits import drafted_to_plane
            return Part.makeCompound([drafted_to_plane(document, face, direction, offset, draft_angle, limit, end_offset) for face in planar.Faces])
        # Extend the selected surface over the finite tool before using the
        # public Face.makeHalfSpace API. A tiny trimmed face alone can fail to
        # split a distant tool in OCCT. Offsets retain axial-distance meaning.
        stop = limit.copy()
        stop.translate(direction * -end_offset)
        plane_point = stop.CenterOfMass
        tools = []
        for face in planar.Faces:
            start = face.copy()
            start.translate(direction * offset)
            box = start.BoundBox
            distances = [
                normal.dot(plane_point - Vector(x, y, z)) / alignment
                for x, y, z in product(
                    (box.XMin, box.XMax), (box.YMin, box.YMax), (box.ZMin, box.ZMax)
                )
            ]
            maximum = max(distances)
            if not math.isfinite(maximum) or maximum <= 1e-7:
                raise ValueError("The stopping plane leaves no extrusion beyond its start.")
            if normal.cross(face.normalAt(0, 0)).Length < 1e-10:
                tool = start.extrude(direction * maximum)
            else:
                prism = start.extrude(direction * (maximum + max(1, box.DiagonalLength * 0.01)))
                bounds = prism.BoundBox
                span = max(
                    (Vector(x, y, z) - plane_point).Length
                    for x, y, z in product(
                        (bounds.XMin, bounds.XMax), (bounds.YMin, bounds.YMax), (bounds.ZMin, bounds.ZMax)
                    )
                ) + 1
                plane = Part.makePlane(2 * span, 2 * span, Vector(), normal)
                plane.translate(plane_point - plane.CenterOfMass)
                half_space = plane.makeHalfSpace(plane_point - normal * (1 if alignment > 0 else -1))
                # Do not silently discard any portion of a starting profile.
                clearance = start.copy()
                clearance.translate(direction * 1e-6)
                if clearance.cut(half_space).Area > max(1e-10, start.Area * 1e-10):
                    raise ValueError("The stopping plane crosses or lies behind the extrusion start. Flip direction or adjust the offset.")
                tool = prism.common(half_space).removeSplitter()
            if tool.isNull() or not tool.isValid() or len(tool.Solids) != 1 or tool.Volume <= 1e-9:
                raise ValueError("The selected plane does not produce a valid complete extrusion.")
            tools.append(tool)
        return Part.makeCompound(tools)
    if mode == "up-to-next":
        import Part

        limit = parameters.get("_limit_shape")
        if limit is None or limit.isNull() or not limit.Solids:
            raise ValueError("Up to next requires an existing part in the extrusion direction.")
        if draft_angle:
            from aether_freecad.extrusion_draft_limits import drafted_to_next
            return Part.makeCompound([drafted_to_next(document, face, direction, offset, draft_angle, limit, end_offset) for face in planar.Faces])
        from aether_freecad.extrusion_next import to_next
        return Part.makeCompound([to_next(face, direction, offset, limit, end_offset) for face in planar.Faces])
    if mode == "symmetric":
        low, high = offset - depth / 2, offset + depth / 2
    elif mode == "through-all":
        if parameters.get("operation") not in ("cut", "intersect") or target is None:
            raise ValueError("Through all requires Remove or Intersect and a target body.")
        from aether_freecad.extrusion_direction import profile_axis
        from aether_freecad.extrusion_draft_limits import projection_bounds

        normal, alignment = profile_axis(planar, direction)
        _, farthest = projection_bounds(target, normal)
        maximum = (farthest - planar.CenterOfMass.dot(normal)) / alignment
        if maximum <= offset:
            if parameters.get("_allow_empty_through_all") or (parameters.get("_scope_allow_no_hit") and parameters.get("operation") == "cut"):
                import Part
                return Part.Shape()
            raise ValueError("The target lies behind the extrusion. Flip direction or adjust its offset.")
        low = offset
        high = maximum + max(1e-6, target.BoundBox.DiagonalLength * 1e-8) / alignment
    elif mode != "blind":
        raise ValueError("Unknown extrusion end type.")
    if draft_angle:
        from aether_freecad.extrusion_draft import drafted_prism

        return drafted_prism(document, planar, direction, low, high, draft_angle)
    start = planar.copy()
    start.translate(direction * low)
    return start.extrude(direction * (high - low))


def _next_planar_distance(profile, direction, limit, offset):
    from aether_freecad.extrusion_direction import next_planar_distance

    return next_planar_distance(profile, direction, limit, offset)


def resolve_extent_references(parameters, bodies, built):
    """The same stopping references serve single-target and scoped extrusions."""
    import Part
    from FreeCAD import Vector

    from aether_freecad.extrusion_direction_reference import resolve_direction_reference
    from aether_freecad.face_extrude import unique_planar_face

    result = resolve_direction_reference(parameters, built)
    if "starting_reference" in result:
        from aether_freecad.extrusion_start import resolve_start
        result["_start_plane"] = resolve_start(result["starting_reference"], built)
    if result.get("second_end") is not None:
        from aether_freecad.extrusion_ends import validate_ends
        validate_ends(result)
        result["second_end"] = resolve_extent_references(result["second_end"], bodies, built)
    if result.get("end_type") == "up-to-vertex":
        from aether_freecad.extrusion_point_limit import resolve_point
        result["_limit_point"] = resolve_point(result.get("end_point_reference"), built)
    if result.get("end_type") == "up-to-next":
        result["_limit_shape"] = Part.makeCompound([body.Shape for body in bodies.values() if hasattr(body, "Shape") and not body.Shape.isNull()])
    if result.get("end_type") == "up-to-part":
        identity = result.get("end_part_id")
        stop = bodies.get(identity) if isinstance(identity, str) else None
        if stop is None or not hasattr(stop, "Shape") or stop.Shape.isNull() or not stop.Shape.Solids:
            raise ValueError("The stopping part is unavailable. Reselect an earlier solid part.")
        result["_limit_shape"] = stop.Shape.copy()
    if result.get("end_type") == "up-to-face":
        reference = result.get("end_reference") or {}
        source = built.get((reference.get("sourceFeatureId"), reference.get("bodyId")))
        if source is None:
            raise ValueError("Up to face reference is unavailable. Reselect the stopping face.")
        if 'surfaceType' in reference:
            from aether_freecad.surface_reference import resolve_surface_face
            result["_limit_face"] = resolve_surface_face(source, reference)
        else:
            normal = Vector(*reference.get("normal", []))
            if not math.isfinite(normal.Length) or abs(normal.Length - 1) > 1e-6:
                raise ValueError("Up to face needs a valid unit normal.")
            result["_limit_face"] = unique_planar_face(source, normal, "Up to face", reference.get("faceAnchor"))
    return result
