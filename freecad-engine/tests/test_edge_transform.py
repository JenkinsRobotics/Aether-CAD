"""Exact edge references retain line membership, length, direction and history."""
import copy
import math

import pytest
from aether_freecad import BuildJob, Feature, FreeCADEngine


@pytest.fixture(scope='module')
def engine():
    with FreeCADEngine() as value:
        yield value


def base(height=5):
    return [Feature('s', 'sketch-rectangle', {'width_mm': 10, 'height_mm': 20}),
            Feature('base', 'pad', {'profile': 's', 'distance_mm': height, 'operation': 'new', 'body_id': 'body'})]


def bounds(body):
    return [min(body.vertices[i::3]) for i in range(3)] + [max(body.vertices[i::3]) for i in range(3)]


def selected_edge(engine, features=None):
    built = engine.build(BuildJob(features=features or base()))
    assert not built.diagnostics, built.diagnostics
    candidates = [c for f in built.bodies[0].topology for c in f['candidates'] if c.get('edgeAnchor')]
    chosen = next(c for c in candidates if all(p['positionMillimeters'][:2] == [10, 20]
                                               for p in c['edgeAnchor'].values()))
    return {'kind': 'solid-edge', 'sourceFeatureId': 'base', 'bodyId': 'body', 'label': 'Vertical edge',
            'anchor': chosen['edgeAnchor']}


def request(ref, mode='translate-reference', **options):
    return BuildJob(features=[*base(), Feature('t', 'transform', {
        'body_ids': ['body'], 'transform': {'kind': mode, 'reference': ref, **options}})], preview_feature_id='t')


@pytest.mark.parametrize('copy_parts', [False, True])
@pytest.mark.parametrize('mode,distance,reverse', [
    ('translate-reference', None, False), ('translate-reference', 12, False),
    ('translate-reference', -12, True), ('rotate-reference', None, False)])
def test_edge_driven_bounds_volume_and_copies(engine, copy_parts, mode, distance, reverse):
    ref = selected_edge(engine)
    start, end = (ref['anchor'][key]['positionMillimeters'] for key in ['start', 'end'])
    sign = 1 if end[2] > start[2] else -1
    parameters = {'angleDegrees': 90} if mode == 'rotate-reference' else {'reversed': reverse}
    if distance is not None:
        parameters['distanceMillimeters'] = distance
    job = request(ref, mode, **parameters)
    if copy_parts:
        job.features[-1].parameters['copy_body_ids'] = {'body': 'copy'}
    result = engine.build(job)
    assert not result.diagnostics, result.diagnostics
    body = result.bodies[-1]
    assert body.volume_mm3 == pytest.approx(1000)
    if mode == 'translate-reference':
        dz = sign * (5 if distance is None else distance) * (-1 if reverse else 1)
        expected = [0, 0, dz, 10, 20, 5 + dz]
    else:
        points = [(10 - sign * (y - 20), 20 + sign * (x - 10)) for x in [0, 10] for y in [0, 20]]
        expected = [min(x for x, _ in points), min(y for _, y in points), 0,
                    max(x for x, _ in points), max(y for _, y in points), 5]
    assert bounds(body) == pytest.approx(expected, abs=1e-6)
    if copy_parts:
        assert bounds(result.bodies[0]) == pytest.approx([0, 0, 0, 10, 20, 5])
    exchange = engine.export(job, {'format': 'step', 'body_ids': [body.id]})
    assert exchange['status'] == 'ok'
    reopened = engine.build(BuildJob(features=[Feature('import', 'import-step', {
        'operation': 'new', 'body_id': 'restored', 'data_base64': exchange['data_base64']})]))
    assert not reopened.diagnostics
    assert bounds(reopened.bodies[0]) == pytest.approx(expected, abs=1e-6)


def test_edge_length_and_axis_follow_source_dimensions(engine):
    ref = selected_edge(engine)
    positive = ref['anchor']['end']['positionMillimeters'][2] > ref['anchor']['start']['positionMillimeters'][2]
    for height in [5, 12, 3]:
        job = request(ref)
        job.features[1].parameters['distance_mm'] = height
        result = engine.build(job)
        assert not result.diagnostics, result.diagnostics
        dz = height if positive else -height
        assert bounds(result.bodies[0]) == pytest.approx([0, 0, dz, 10, 20, height + dz])
        assert result.preview['transform_frame']['resolved_transform']['translationMillimeters'] == pytest.approx([0, 0, dz])


@pytest.mark.parametrize('bad', ['missing-source', 'changed-signature', 'changed-incidence', 'same-point', 'diagonal'])
def test_invalid_edge_refs_preserve_source_and_refuse_export(engine, bad):
    ref = copy.deepcopy(selected_edge(engine))
    if bad == 'missing-source':
        ref['sourceFeatureId'] = 'gone'
    if bad == 'changed-signature':
        ref['anchor']['start']['signature'] = 'different'
    if bad == 'changed-incidence':
        ref['anchor']['end']['incidence'] = 'different'
    if bad == 'same-point':
        ref['anchor']['end'] = copy.deepcopy(ref['anchor']['start'])
    if bad == 'diagonal':
        source = engine.build(BuildJob(features=base()))
        ref['anchor']['end'] = next(c['vertexAnchor'] for f in source.bodies[0].topology for c in f['candidates']
                                    if c.get('vertexAnchor', {}).get('positionMillimeters') == [0, 0, 5])
    job = request(ref)
    result = engine.build(job)
    assert result.diagnostics and result.preview is None
    assert bounds(result.bodies[0]) == pytest.approx([0, 0, 0, 10, 20, 5])
    assert engine.export(job, {'format': 'step'})['status'] == 'error'


def test_native_curve_is_not_a_straight_reference_even_with_valid_endpoint_anchors(engine):
    features = [Feature('s', 'sketch-wire', {'start_mm': [-5, 0], 'segments': [
        {'type': 'arc', 'middle': [0, 5], 'end': [5, 0]}, {'type': 'line', 'end': [0, -5]}, {'type': 'line', 'end': [-5, 0]}]}),
        Feature('base', 'pad', {'profile': 's', 'distance_mm': 5, 'operation': 'new', 'body_id': 'body'})]
    built = engine.build(BuildJob(features=features))
    assert not built.diagnostics, built.diagnostics
    candidates = [c for f in built.bodies[0].topology for c in f['candidates']]
    curves = [c for c in candidates if c['kind'] == 'edge-midpoint' and 'linearDirection' not in c['measurements']]
    assert curves and all('edgeAnchor' not in c for c in curves)
    anchors = [next(c['vertexAnchor'] for c in candidates if c.get('vertexAnchor', {}).get('positionMillimeters') == pytest.approx(p, abs=1e-9))
               for p in [[-5, 0, 5], [5, 0, 5]]]
    ref = {'kind': 'solid-edge', 'sourceFeatureId': 'base', 'bodyId': 'body', 'anchor': dict(zip(['start', 'end'], anchors))}
    job = request(ref)
    job.features[:2] = features
    result = engine.build(job)
    assert result.diagnostics and 'straight edge' in result.diagnostics[-1]['message']
    assert result.bodies[0].volume_mm3 == pytest.approx((12.5 * math.pi + 25) * 5)


def test_imported_step_edge_anchor_and_old_native_capability(engine):
    exported = engine.export(BuildJob(features=base()), {'format': 'step'})
    source = [Feature('base', 'import-step', {'operation': 'new', 'body_id': 'body', 'data_base64': exported['data_base64']})]
    ref = selected_edge(engine, source)
    job = request(ref, distanceMillimeters=9)
    job.features[:2] = source
    result = engine.build(job)
    assert not result.diagnostics, result.diagnostics
    assert result.bodies[0].volume_mm3 == pytest.approx(1000)
    assert abs(result.preview['transform_frame']['resolved_transform']['translationMillimeters'][2]) == pytest.approx(9)
    assert 'solid-edge-transform' in engine.describe()['capabilities']
