"""First encountered solid boundaries, evaluated with exact OCCT operations.

Each boundary patch casts a forward volume along the extrusion direction. Cutting
their union from the finite tool retains only material before the first boundary
on each ray, including stepped stops made by different parts. Simply cutting the
stopping solids would incorrectly retain material behind a nearer obstruction.
Bounds size finite tools only; no tessellation defines the terminating surface.
"""
import math


def to_next(profile, direction, low, limit, end_offset):
    from aether_freecad.extrusion_direction import profile_axis
    from aether_freecad.extrusion_draft_limits import projection_bounds

    if limit is None or limit.isNull() or not limit.Solids or not limit.isValid():
        raise ValueError("Up to next requires valid solid parts in the extrusion direction.")
    normal, alignment = profile_axis(profile, direction)
    origin = profile.CenterOfMass.dot(normal)
    _, maximum = projection_bounds(limit, normal)
    epsilon = max(1e-6, profile.BoundBox.DiagonalLength * 1e-9)
    reach = (maximum - origin) / alignment - low
    if not math.isfinite(reach) or reach <= epsilon:
        raise ValueError("No next boundary lies beyond the extrusion start. Flip direction or adjust its offset.")
    reach += max(1, limit.BoundBox.DiagonalLength * 1e-6) / alignment
    start = profile.copy()
    start.translate(direction * low)
    # Ignore the coincident starting face, so a profile entering a part reaches
    # its next exit. The complete-start check below refuses lost profile area.
    probe = start.copy()
    probe.translate(direction * epsilon)
    probe = probe.extrude(direction * reach)
    length = reach + abs(end_offset) + 1
    tool = start.extrude(direction * length)
    end = start.copy()
    end.translate(direction * length)
    shadows = cast_boundaries(limit.Faces, probe, direction, length + abs(end_offset) + 1, end_offset)
    if not shadows:
        raise ValueError("No next face covers the selected profile. Flip direction or choose another limit.")
    result = tool.cut(shadows).removeSplitter()
    area_tolerance = max(1e-9, start.Area * 1e-9)
    if (result.isNull() or not result.isValid() or len(result.Solids) != 1
            or result.Volume <= 1e-9
            or abs(result.common(start).Area - start.Area) > area_tolerance
            or result.common(end).Area > area_tolerance):
        raise ValueError("The next boundary does not cover and completely terminate the profile beyond its start. Adjust the profile, direction or end offset.")
    result.check(True)
    return result


def cast_boundaries(faces, probe, direction, length, end_offset):
    """Forward material exclusions from exact trimmed native boundary patches."""
    shadows = []
    for face in faces:
        for patch in face.common(probe).Faces:
            shadow = patch.extrude(direction * length)
            if not shadow.Solids or abs(shadow.Volume) <= 1e-10:
                continue  # Tangential walls do not terminate an axial ray.
            if not shadow.isValid():
                raise ValueError("The next boundary folds across the extrusion direction. Split the profile or select another limit.")
            # Select the original next boundary first, then offset it. Moving
            # the parts before searching could silently skip a too-near stop.
            shadow.translate(direction * -end_offset)
            shadows.append(shadow)
    return shadows
