"""Terminate a tool against a selected native solid, including curved boundaries.

Bounds only size the tool. OCCT solid operations supply the actual stop; the one
connected remainder touching the entire starting face must not reach the far cap.
An adaptive bound avoids demanding draft geometry past an otherwise valid stop.
"""
import math


def to_part(document, profile, direction, low, angle, limit, end_offset):
    import Part

    from aether_freecad.extrusion_direction import profile_axis
    from aether_freecad.extrusion_draft import draft_section, drafted_prism
    from aether_freecad.extrusion_draft_limits import projection_bounds

    if limit is None or limit.isNull() or not limit.Solids or not limit.isValid():
        raise ValueError("Up to part requires an available solid stopping part.")
    stop = limit.copy()
    stop.translate(direction * -end_offset)
    normal, alignment = profile_axis(profile, direction)
    origin = profile.CenterOfMass.dot(normal)
    _, farthest = projection_bounds(stop, normal)
    epsilon = max(1e-6, profile.BoundBox.DiagonalLength * 1e-8)
    bound = (farthest - origin) / alignment + epsilon * 10
    if not math.isfinite(bound) or bound <= low + epsilon:
        raise ValueError("The stopping part lies behind the extrusion start. Flip direction or adjust its offset.")

    def section(distance):
        if angle:
            return draft_section(profile, direction, distance, angle)
        face = profile.copy()
        face.translate(direction * distance)
        return face

    start = section(low)
    area_tolerance = max(1e-8, start.Area * 1e-8)
    # A profile inside the part stops at its exit boundary. A profile outside
    # stops at entry. Probe just along travel to distinguish coincident starts.
    probe = section(low + epsilon)
    overlap = probe.common(stop).Area
    inside = abs(overlap - probe.Area) <= max(1e-8, probe.Area * 1e-8)
    if not inside and overlap > max(1e-8, probe.Area * 1e-8):
        raise ValueError("The stopping part crosses the extrusion start. Move the start to one side of its boundary.")
    before, invalid, high = low, None, bound
    for _ in range(48):
        try:
            end = section(high)
            tool = drafted_prism(document, profile, direction, low, high, angle) if angle else start.extrude(direction * (high-low))
        except ValueError:
            if not angle:
                raise
            invalid = high
        else:
            remainder = (tool.common(stop) if inside else tool.cut(stop)).removeSplitter()
            touching = [solid for solid in remainder.Solids if solid.common(start).Area > area_tolerance]
            if len(touching) != 1 or abs(touching[0].common(start).Area - start.Area) > area_tolerance:
                raise ValueError("The stopping part does not leave the complete extrusion start connected.")
            result = touching[0]
            # Never confuse a tiny near-apex cap with a fully terminated tool.
            # The result must actually contact the chosen part away from start.
            boundary = result.common(Part.makeShell(stop.Faces)).cut(start)
            if (result.common(end).Area <= max(1e-12, end.Area * 1e-8)
                    and boundary.Area > area_tolerance):
                if not result.isValid() or result.Volume <= 1e-9:
                    raise ValueError("The stopping part does not produce a valid extrusion.")
                result.check(True)
                return result
            before = high
            if invalid is None:
                break
        high = (before + invalid) / 2
        if high - before <= epsilon * 1e-3:
            break
    raise ValueError("The selected part does not fully stop the extrusion before its draft collapses or the profile passes beyond it.")
