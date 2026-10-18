import base64
from pathlib import Path
import struct

import pytest
from aether_freecad import BuildJob, Feature, FreeCADEngine

FIXTURES = Path(__file__).resolve().parents[2] / 'test-fixtures/imports'


@pytest.fixture(scope='module')
def engine():
    with FreeCADEngine() as value:
        yield value


def imported(fmt, mode='reference', units='mm', data=None):
    return Feature('imported', 'import-cad', {
        'operation': 'new', 'body_id': 'imported-body', 'format': fmt,
        'data_base64': base64.b64encode(data if data is not None else (FIXTURES / f'box.{fmt}').read_bytes()).decode(),
        **({'mesh_mode': mode, 'mesh_units': units} if fmt in ('stl', 'obj', 'ply', 'off') else {}),
    })


@pytest.mark.parametrize('fmt', ['step', 'iges', 'brep'])
def test_exact_import_and_step_roundtrip(engine, fmt):
    job = BuildJob(features=[imported(fmt)])
    result = engine.build(job)
    assert not result.diagnostics
    assert result.bodies[0].volume_mm3 == pytest.approx(24)
    assert result.bodies[0].id == 'imported-body'
    exported = engine.export(job, {'format': 'step'})
    assert exported['status'] == 'ok'
    back = engine.build(BuildJob(features=[imported('step', data=base64.b64decode(exported['data_base64']))]))
    assert back.bodies[0].volume_mm3 == pytest.approx(24)


@pytest.mark.parametrize('fmt', ['stl', 'obj', 'ply', 'off'])
@pytest.mark.parametrize('mode', ['reference', 'solid'])
def test_mesh_units_interpretation_rebuild_export(engine, fmt, mode):
    job = BuildJob(features=[imported(fmt, mode, 'in')])
    for _ in range(2):
        result = engine.build(job)
        assert not result.diagnostics, result.diagnostics
        body = result.bodies[0]
        assert body.id == 'imported-body'
        assert max(body.vertices[0::3]) - min(body.vertices[0::3]) == pytest.approx(2 * 25.4)
        assert max(body.vertices[2::3]) - min(body.vertices[2::3]) == pytest.approx(4 * 25.4)
        if mode == 'reference':
            assert body.geometry_kind == 'mesh'
            assert body.topology == body.face_ranges == []
            assert len(body.triangles) == 36
        else:
            assert body.volume_mm3 == pytest.approx(24 * 25.4 ** 3)
            assert body.topology
    assert engine.export(job, {'format': 'stl'})['status'] == 'ok'
    step = engine.export(job, {'format': 'step'})
    assert step['status'] == ('error' if mode == 'reference' else 'ok')
    if mode == 'reference':
        assert 'solid' in step['message'].lower()
        assert engine.analyze(job, {'kind': 'properties'})['status'] == 'error'


@pytest.mark.parametrize('binary', [False, True])
def test_open_ascii_and_binary_stl_remain_meshes(engine, binary):
    data = (b'open triangle'.ljust(80, b'\0') + struct.pack('<I12fH', 1, 0,0,1, 0,0,0, 1,0,0, 0,1,0, 0) if binary else
            b'solid triangle\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid triangle\n')
    result = engine.build(BuildJob(features=[imported('stl', data=data)]))
    assert not result.diagnostics and len(result.bodies[0].triangles) == 3
    failed = engine.build(BuildJob(features=[imported('stl', 'solid', data=data)]))
    assert failed.diagnostics and not failed.bodies
    assert 'closed mesh' in failed.diagnostics[0]['message']


def test_solid_conversion_allows_following_cut_and_mesh_refuses_it(engine):
    sketch = Feature('hole', 'sketch-circle', {'radius_mm': .25, 'center_mm': [0,0], 'offset_mm': 2})
    cut = Feature('cut', 'pocket', {'profile':'hole','depth_mm':4,'body_id':'imported-body','operation':'cut'})
    solid = engine.build(BuildJob(features=[imported('stl','solid'),sketch,cut]))
    assert not solid.diagnostics
    assert solid.bodies[0].volume_mm3 == pytest.approx(24 - 3.141592653589793 * .25)
    reference = engine.build(BuildJob(features=[imported('stl'),sketch,cut]))
    assert 'requires a solid' in reference.diagnostics[0]['message']
    assert reference.bodies[0].geometry_kind == 'mesh'


def test_bad_sources_do_not_destroy_preceding_geometry(engine):
    for fmt in ('step','iges','brep','stl','obj','ply','off'):
        bad = imported(fmt, data=b'not geometry')
        bad = Feature('bad', bad.kind, {**bad.parameters, 'body_id':'bad-body'})
        result = engine.build(BuildJob(features=[imported('step'),bad]))
        assert result.diagnostics, fmt
        assert len(result.bodies) == 1 and result.bodies[0].volume_mm3 == pytest.approx(24)


def test_nested_mesh_shells_are_not_silently_filled(engine):
    data = (FIXTURES / 'box.stl').read_bytes()
    count = struct.unpack_from('<I', data, 80)[0]
    inside = bytearray()
    for i in range(count):
        values = list(struct.unpack_from('<12fH', data, 84 + i * 50))
        values[3:12] = [v * .5 for v in values[3:12]]
        inside.extend(struct.pack('<12fH', *values))
    nested = data[:80] + struct.pack('<I', count * 2) + data[84:] + inside
    job = BuildJob(features=[imported('stl', 'solid', data=nested)])
    result = engine.build(job)
    assert not result.bodies
    assert 'Nested or overlapping shells' in result.diagnostics[0]['message']
