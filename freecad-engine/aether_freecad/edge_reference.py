"""Straight solid edges resolved by checked endpoint topology, never EdgeN order."""
import math

from aether_freecad.vertex_reference import point_key, resolve_vertex


def edge_anchor(edge, anchors):
    import Part

    try:
        if not isinstance(edge.Curve, Part.Line) or not math.isfinite(edge.Length) or edge.Length < 1e-9:
            return None
        start = anchors.get(point_key(edge.valueAt(edge.FirstParameter)))
        end = anchors.get(point_key(edge.valueAt(edge.LastParameter)))
        if start is None or end is None or start['positionMillimeters'] == end['positionMillimeters']:
            return None
        return {'start': start, 'end': end}
    except (Part.OCCError, RuntimeError, TypeError, ValueError):
        return None


def resolve_edge(reference, built):
    import Part

    if not isinstance(reference, dict) or reference.get('kind') != 'solid-edge':
        raise ValueError('Select a straight solid edge for the transform.')
    shape = built.get((reference.get('sourceFeatureId'), reference.get('bodyId')))
    if shape is None or shape.isNull():
        raise ValueError('Transform edge source is unavailable. Reselect an earlier solid edge.')
    anchor = reference.get('anchor')
    if not isinstance(anchor, dict):
        raise TypeError('Transform edge anchor is unavailable. Reselect the edge.')
    try:
        start = resolve_vertex(shape, anchor.get('start'))
        end = resolve_vertex(shape, anchor.get('end'))
    except (TypeError, ValueError) as error:
        raise ValueError('Transform edge changed or is ambiguous. Reselect the edge on the earlier part.') from error
    if not math.isfinite((end - start).Length) or (end - start).Length < 1e-9:
        raise ValueError('Transform edge must have two distinct endpoints.')
    matches = []
    for edge in shape.Edges:
        try:
            if not isinstance(edge.Curve, Part.Line) or len(edge.Vertexes) != 2:
                continue
            a, b = (vertex.Point for vertex in edge.Vertexes)
            if (((a - start).Length < 1e-6 and (b - end).Length < 1e-6)
                    or ((b - start).Length < 1e-6 and (a - end).Length < 1e-6)):
                matches.append(edge)
        except (Part.OCCError, RuntimeError, TypeError, ValueError):
            continue
    if len(matches) != 1:
        raise ValueError('The referenced straight edge is unavailable or ambiguous. Reselect it; two points cannot replace a changed edge.')
    return start, end
