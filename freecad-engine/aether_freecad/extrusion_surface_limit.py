"""Exact extrusion to the untrimmed native surface underlying a selected face.

The kernel's surface half-space extends analytic surfaces past trimmed face edges.
Only the connected tool component touching the complete start is retained. A
surviving far cap is never accepted as a stopping surface. Tool bounds are adaptive
construction limits, not the geometry of the selected surface.
"""
import math


def _surface_patch(face, tool, direction, end_offset):
    """Retain the native surface, bounding an extrusion's infinite V parameter.

    OCCT cannot reliably intersect the +/-2e100 V bounds of a spline extrusion.
    Project both bounding boxes onto its extrusion axis to cover every possible
    parameter needed by the tool. This extends beyond the selected face's trim;
    the curve's entire natural U interval and exact geometry are preserved.
    """
    surface = face.Surface
    if type(surface).__name__ != 'SurfaceOfExtrusion':
        return surface.toShape()
    axis = surface.Direction
    length = axis.Length
    axis = axis/length

    def projections(shape, translation):
        from FreeCAD import Vector
        box = shape.BoundBox
        return [(Vector(x, y, z)+translation).dot(axis)
                for x in (box.XMin, box.XMax)
                for y in (box.YMin, box.YMax)
                for z in (box.ZMin, box.ZMax)]

    values = projections(tool, direction*end_offset)
    curve = projections(surface.BasisCurve.toShape(), direction*0)
    margin = max(1, tool.BoundBox.DiagonalLength)
    low = (min(values)-max(curve)-margin)/length
    high = (max(values)-min(curve)+margin)/length
    u_min, u_max, _, _ = surface.bounds()
    return surface.toShape(u_min, u_max, low, high)


def to_surface(document, profile, direction, low, angle, face, end_offset):
    from aether_freecad.extrusion_draft import draft_section, drafted_prism

    def section(distance):
        if angle:
            return draft_section(profile, direction, distance, angle)
        result = profile.copy()
        result.translate(direction*distance)
        return result

    start = section(low)
    epsilon = max(1e-6, start.BoundBox.DiagonalLength*1e-9)
    area_tolerance = max(1e-9, start.Area*1e-9)
    # A start vertex belongs to actual material, unlike a ring's center of mass.
    # Choose the original side before moving the boundary by its signed offset.
    sample = start.Vertexes[0].Point + direction*epsilon
    span = max(1, (face.CenterOfMass-start.CenterOfMass).Length
               + face.BoundBox.DiagonalLength + start.BoundBox.DiagonalLength + abs(end_offset))
    before, invalid, high = low, None, low+2*span
    for _ in range(48):
        try:
            end = section(high)
            tool = drafted_prism(document, profile, direction, low, high, angle) if angle else start.extrude(direction*(high-low))
        except ValueError:
            if not angle:
                raise
            invalid = high
        else:
            surface = _surface_patch(face, tool, direction, end_offset)
            half = surface.makeHalfSpace(sample)
            half.translate(direction*-end_offset)
            surface.translate(direction*-end_offset)
            if abs(start.common(half).Area-start.Area) > area_tolerance:
                raise ValueError('The stopping surface crosses or lies behind the extrusion start. Adjust the start or end offset.')
            remainder = tool.common(half).removeSplitter()
            touching = [solid for solid in remainder.Solids if solid.common(start).Area > area_tolerance]
            if len(touching) != 1 or abs(touching[0].common(start).Area-start.Area) > area_tolerance:
                raise ValueError('The stopping surface does not leave the complete extrusion start connected.')
            result = touching[0]
            if (result.common(end).Area <= max(1e-12, end.Area*1e-9)
                    and result.common(surface).cut(start).Area > area_tolerance):
                if not result.isValid() or result.Volume <= 1e-9:
                    raise ValueError('The stopping surface does not produce a valid extrusion.')
                result.check(True)
                return result
            before = high
            if invalid is None:
                high = low+2*(high-low)
                if not math.isfinite(high) or high-low > 1e12:
                    break
                continue
        high = (before+invalid)/2
        if high-before <= epsilon*1e-3:
            break
    raise ValueError('The selected surface does not completely terminate the extrusion before the profile escapes or its draft collapses.')
