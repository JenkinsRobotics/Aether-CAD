"""Native reference transforms: independent bounds, association and refusal."""
import pytest
from aether_freecad import BuildJob, Feature, FreeCADEngine


@pytest.fixture(scope='module')
def engine():
    with FreeCADEngine() as value:
        yield value


def point(x, y, z=0):
    return {'kind': 'sketch-point', 'local_point': [x, y], 'frame': {
        'originMillimeters': [0, 0, z], 'normal': [0, 0, 1], 'xDirection': [1, 0, 0]}}


def vector():
    return {'kind': 'two-points', 'from': point(1, 2), 'to': point(4, 6)}


def base():
    return [Feature('s', 'sketch-rectangle', {'width_mm': 10, 'height_mm': 20}),
            Feature('base', 'pad', {'profile': 's', 'distance_mm': 5, 'operation': 'new', 'body_id': 'body'})]


def job(transform, copy=False):
    return BuildJob(features=[*base(), Feature('transform', 'transform', {
        'body_ids': ['body'], 'transform': transform, **({'copy_body_ids': {'body': 'copy'}} if copy else {})})],
        preview_feature_id='transform')


def bounds(body):
    return [min(body.vertices[i::3]) for i in range(3)] + [max(body.vertices[i::3]) for i in range(3)]


@pytest.mark.parametrize('copy', [False, True])
@pytest.mark.parametrize('transform,expected,volume', [
    ({'kind': 'translate-reference', 'reference': vector()}, [3, 4, 0, 13, 24, 5], 1000),
    ({'kind': 'translate-reference', 'reference': vector(), 'distanceMillimeters': 10}, [6, 8, 0, 16, 28, 5], 1000),
    ({'kind': 'translate-reference', 'reference': vector(), 'distanceMillimeters': -10, 'reversed': True}, [6, 8, 0, 16, 28, 5], 1000),
    ({'kind': 'rotate-reference', 'reference': {'kind': 'two-points', 'from': point(1, 2), 'to': point(1, 2, 5)}, 'angleDegrees': 90}, [-17, 1, 0, 3, 11, 5], 1000),
    ({'kind': 'scale-reference', 'centerReference': point(1, 2, 3), 'scaleFactors': [2, .5, 3]}, [-1, 1, -6, 19, 11, 9], 3000),
])
def test_native_reference_modes_and_copy(engine, copy, transform, expected, volume):
    request = job(transform, copy)
    result = engine.build(request)
    assert not result.diagnostics, result.diagnostics
    assert bounds(result.bodies[-1]) == pytest.approx(expected, abs=1e-6)
    assert result.bodies[-1].volume_mm3 == pytest.approx(volume)
    frame = result.preview['transform_frame']
    assert frame['resolved_transform']['kind'] == transform['kind'].split('-')[0]
    if copy:
        assert bounds(result.bodies[0]) == pytest.approx([0, 0, 0, 10, 20, 5])
    exchange = engine.export(request, {'format': 'step'})
    assert exchange['status'] == 'ok'
    restored = engine.build(BuildJob(features=[Feature('import', 'import-step', {
        'body_id': 'restored', 'operation': 'new', 'data_base64': exchange['data_base64']})]))
    assert not restored.diagnostics
    assert sum(b.volume_mm3 for b in restored.bodies) == pytest.approx(volume + (1000 if copy else 0))


@pytest.mark.parametrize('bad', [
    {'kind': 'translate-reference', 'reference': {'kind': 'two-points', 'from': point(0, 0), 'to': point(0, 0)}},
    {'kind': 'rotate-reference', 'reference': vector(), 'angleDegrees': True},
    {'kind': 'translate-reference', 'reference': vector(), 'distanceMillimeters': True},
    {'kind': 'translate-reference', 'reference': vector(), 'reversed': 'yes'},
    {'kind': 'scale-reference', 'centerReference': point(1, 2), 'scaleFactors': [1, 0, 1]},
    {'kind': 'translate-reference', 'reference': {}},
    {'kind': 'rotate-reference', 'reference': {'kind': 'two-points', 'from': {'kind': 'solid-vertex', 'sourceFeatureId': 'gone', 'bodyId': 'body'}, 'to': point(1, 2)}, 'angleDegrees': 90},
])
def test_bad_references_are_atomic_and_cannot_export(engine, bad):
    result = engine.build(job(bad))
    assert result.diagnostics and result.preview is None
    assert bounds(result.bodies[0]) == pytest.approx([0, 0, 0, 10, 20, 5])
    assert engine.export(job(bad), {'format': 'step'})['status'] == 'error'


def test_native_attached_sketch_axis_follows_support_height(engine):
    ref = vector()
    for p in [ref['from'], ref['to']]:
        p['support'] = {'sourceFeatureId': 'base', 'bodyId': 'body', 'normal': [0, 0, 1], 'xDirection': [1, 0, 0], 'label': 'Top'}
    transform = {'kind': 'rotate-reference', 'reference': ref, 'angleDegrees': 180}
    request = job(transform)
    for height in [5, 12]:
        request.features[1].parameters['distance_mm'] = height
        result = engine.build(request)
        assert not result.diagnostics, result.diagnostics
        assert result.preview['transform_frame']['resolved_transform']['axisOriginMillimeters'][2] == pytest.approx(height)
        assert bounds(result.bodies[0])[2::3] == pytest.approx([height, 2 * height])


def test_solid_vertex_reference_follows_upstream_and_refuses_missing_anchor(engine):
    source = engine.build(BuildJob(features=base()))
    candidates = [c for face in source.bodies[0].topology for c in face['candidates'] if c['kind'] == 'vertex']
    chosen = max(candidates, key=lambda c: tuple(c['origin'][i] for i in [2, 0, 1]))
    ref = {'kind': 'solid-vertex', 'sourceFeatureId': 'base', 'bodyId': 'body', 'anchor': chosen['vertexAnchor']}
    request = job({'kind': 'scale-reference', 'centerReference': ref, 'scaleFactors': [2, 2, 2]})
    for height in [5, 12]:
        request.features[1].parameters['distance_mm'] = height
        result = engine.build(request)
        assert not result.diagnostics, result.diagnostics
        assert result.preview['transform_frame']['resolved_transform']['centerMillimeters'] == pytest.approx([10, 20, height])
        assert bounds(result.bodies[0]) == pytest.approx([-10, -20, -height, 10, 20, height])
    ref['anchor']['signature'] = 'unavailable'
    result = engine.build(request)
    assert result.diagnostics and result.preview is None
    assert bounds(result.bodies[0]) == pytest.approx([0, 0, 0, 10, 20, 12])
