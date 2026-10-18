"""Resolve associative transform references in native pre-feature history."""
import math

from aether_freecad.extrusion_point_limit import resolve_point


def resolve_transform(transform, built):
    if not isinstance(transform, dict):
        raise TypeError('Choose a valid part transform.')
    kind = transform.get('kind')
    if kind not in ('translate-reference', 'rotate-reference', 'scale-reference'):
        return dict(transform), None
    if kind == 'scale-reference':
        center = resolve_point(transform.get('centerReference'), built)
        return {'kind': 'scale', 'centerMillimeters': list(center),
                'scaleFactors': transform.get('scaleFactors')}, None
    reference = transform.get('reference')
    if isinstance(reference, dict) and reference.get('kind') == 'solid-edge':
        from aether_freecad.edge_reference import resolve_edge
        start, end = resolve_edge(reference, built)
    elif isinstance(reference, dict) and reference.get('kind') == 'two-points':
        start = resolve_point(reference.get('from'), built)
        end = resolve_point(reference.get('to'), built)
    else:
        raise ValueError('Select a straight sketch line, solid edge or two ordered points for the transform.')
    vector = end - start
    length = vector.Length
    if not math.isfinite(length) or length < 1e-9:
        raise ValueError('Transform points must be distinct. Reselect a nonzero line or two different points.')
    direction = vector / length
    if kind == 'rotate-reference':
        return {'kind': 'rotate', 'axisOriginMillimeters': list(start),
                'axisDirection': list(direction), 'angleDegrees': transform.get('angleDegrees')}, None
    distance = transform.get('distanceMillimeters', length)
    reverse = transform.get('reversed', False)
    if (isinstance(distance, bool) or not isinstance(distance, (int, float)) or not math.isfinite(distance)
            or not isinstance(reverse, bool)):
        raise ValueError('Enter a finite transform distance and valid direction.')
    if reverse:
        direction = -direction
    return {'kind': 'translate', 'translationMillimeters': list(direction * distance)}, list(direction)
