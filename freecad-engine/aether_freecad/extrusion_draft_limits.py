"""Exact drafted tools terminated by public OCCT plane/solid operations.

Planar section bounds only size a finite tool; they never substitute for the
final native plane intersection. No tessellated geometry determines the stop.
"""
import math
from itertools import product

from aether_freecad.extrusion_draft import draft_section, drafted_prism


def projection_bounds(shape, direction):
    import FreeCAD

    aligned = shape.copy()
    aligned.transformShape(FreeCAD.Rotation(direction, FreeCAD.Vector(0, 0, 1)).toMatrix())
    box = aligned.BoundBox
    return box.ZMin, box.ZMax


def _past_plane(face, direction, low, angle, point, normal):
    """Find a valid end section wholly beyond a tilted plane.

    A guessed long prism can cross a cone apex even when the actual plane stop
    is valid. When an end section collapses, bisect toward the last valid one;
    when it remains before the plane, extend the search. Every accepted bound
    is rechecked geometrically. Unbounded/degenerate requests fail explicitly.
    """
    alignment = normal.dot(direction)
    if alignment < 0:
        normal = normal * -1
        alignment = -alignment
    target = normal.dot(point)
    section = draft_section(face, direction, low, angle)
    start_min, start_max = projection_bounds(section, normal)
    epsilon = max(1e-6, face.BoundBox.DiagonalLength * 1e-8)
    if start_max >= target - epsilon:
        raise ValueError("The stopping plane crosses or lies behind the drafted start. Flip direction or adjust the offset.")
    before = low
    high = low + max((target - start_min) / alignment, epsilon * 10)
    invalid = None
    for _ in range(48):
        try:
            section = draft_section(face, direction, high, angle)
        except ValueError:
            invalid = high
        else:
            minimum, _ = projection_bounds(section, normal)
            if minimum > target + epsilon:
                return high
            before = high
        if invalid is not None:
            high = (before + invalid) / 2
            if high - before <= epsilon * 1e-3:
                break
        else:
            high = low + 2 * (high - low)
            if not math.isfinite(high) or high - low > max(1, face.BoundBox.DiagonalLength) * 1e8:
                break
    raise ValueError("Draft cannot completely reach the stopping plane before collapsing or becoming unbounded. Reduce the angle or move the stop.")


def drafted_to_plane(document, face, direction, low, angle, stop, end_offset):
    import Part
    from FreeCAD import Vector

    normal = stop.normalAt(0, 0)
    alignment = normal.dot(direction)
    if abs(alignment) < 1e-7:
        raise ValueError("The stopping plane is parallel to the extrusion direction. Select another face.")
    point = stop.CenterOfMass - direction * end_offset
    if normal.cross(direction).Length < 1e-10:
        high = normal.dot(point - face.CenterOfMass) / alignment
        if high <= low + 1e-7:
            raise ValueError("The stopping plane leaves no drafted extrusion beyond its start.")
        return drafted_prism(document, face, direction, low, high, angle)
    high = _past_plane(face, direction, low, angle, point, normal)
    tool = drafted_prism(document, face, direction, low, high, angle)
    bounds = tool.BoundBox
    span = max((Vector(x, y, z) - point).Length for x, y, z in product(
        (bounds.XMin, bounds.XMax), (bounds.YMin, bounds.YMax), (bounds.ZMin, bounds.ZMax))) + 1
    plane = Part.makePlane(2 * span, 2 * span, Vector(), normal)
    plane.translate(point - plane.CenterOfMass)
    half_space = plane.makeHalfSpace(point - normal * (1 if alignment > 0 else -1))
    result = tool.common(half_space).removeSplitter()
    if result.isNull() or not result.isValid() or len(result.Solids) != 1 or result.Volume <= 1e-9:
        raise ValueError("The stopping plane does not leave a valid drafted solid.")
    return result


def drafted_to_next(document, profile, direction, low, angle, limit, end_offset):
    from aether_freecad.extrusion_drafted_next import to_drafted_next

    return to_drafted_next(document, profile, direction, low, angle, limit, end_offset)
