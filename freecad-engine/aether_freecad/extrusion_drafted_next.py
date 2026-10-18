"""Drafted first stops, using exact native tapers and boundary intersections."""
import math


def to_drafted_next(document, profile, direction, low, angle, limit, end_offset):
    import Part

    from aether_freecad.extrusion_draft import draft_section, drafted_prism
    from aether_freecad.extrusion_draft_limits import projection_bounds
    from aether_freecad.extrusion_next import cast_boundaries

    if limit is None or limit.isNull() or not limit.Solids or not limit.isValid():
        raise ValueError("Up to next requires valid solid stopping parts.")
    origin = profile.CenterOfMass.dot(direction)
    _, maximum = projection_bounds(limit, direction)
    epsilon = max(1e-6, profile.BoundBox.DiagonalLength * 1e-9)
    bound = maximum - origin + abs(end_offset) + max(1, limit.BoundBox.DiagonalLength * 1e-6)
    if not math.isfinite(bound) or bound <= low + epsilon:
        raise ValueError("No next face lies beyond the drafted start.")
    start = draft_section(profile, direction, low, angle)
    area_tolerance = max(1e-9, start.Area * 1e-9)
    before, invalid, high = low, None, bound
    for _ in range(48):
        try:
            end = draft_section(profile, direction, high, angle)
            tool = drafted_prism(document, profile, direction, low, high, angle)
        except ValueError:
            invalid = high
        else:
            # Remove the coincident starting cap before choosing encountered
            # faces. The original sketch remains the taper's neutral plane.
            point = start.CenterOfMass + direction * epsilon
            span = max(1, tool.BoundBox.DiagonalLength * 2)
            plane = Part.makePlane(2 * span, 2 * span, point, direction)
            plane.translate(point - plane.CenterOfMass)
            probe = tool.common(plane.makeHalfSpace(point + direction))
            encountered = [face for face in limit.Faces if face.common(probe).Area > area_tolerance]
            if encountered:
                # A signed end offset can change the required section width.
                # Keep the actual encountered face, but trim its shadow with a
                # projection of the widest valid section, not its first contact.
                wide = (start if start.Area >= end.Area else end).copy()
                wide.translate(direction * (low + epsilon - (low if start.Area >= end.Area else high)))
                reach = high - low + abs(end_offset) + 1
                envelope = wide.extrude(direction * reach)
                shadows = cast_boundaries(encountered, envelope, direction, reach + abs(end_offset) + 1, end_offset)
                if shadows:
                    result = tool.cut(shadows).removeSplitter()
                    if (not result.isNull() and result.isValid() and len(result.Solids) == 1
                            and result.Volume > 1e-9
                            and abs(result.common(start).Area - start.Area) <= area_tolerance
                            and result.common(end).Area <= max(1e-12, end.Area * 1e-9)):
                        result.check(True)
                        return result
            before = high
            if invalid is None:
                break
        high = (before + invalid) / 2
        if high - before <= epsilon * 1e-3:
            break
    raise ValueError("The next faces do not cover the complete drafted profile before its taper collapses. Adjust the draft, profile or end offset.")
