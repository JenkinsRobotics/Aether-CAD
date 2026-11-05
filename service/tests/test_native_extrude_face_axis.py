"""Face axes through the same validated agent operations and archive as the UI."""
import json
import subprocess
import sys
from pathlib import Path

import pytest
from aether_animation.aether_workspace import AetherWorkspace
from documents import part_archive
from test_native_feature_operations import native, run
from test_native_program import empty, invoke


@native
@pytest.mark.parametrize('surface', ['cylinder', 'cone'])
@pytest.mark.parametrize('mode', ['solid', 'thin', 'surface'])
def test_native_face_axis_edit_reopen_and_failed_transaction(tmp_path, surface, mode):
    guide = {'type': 'profile', 'name': 'Guide sketch', 'plane': 'XY', 'offsetMillimeters': 0,
             'frame': {'originMillimeters': [30, 0, 0], 'normal': [.6, 0, .8], 'xDirection': [.8, 0, -.6]},
             'profile': {'type': 'circle', 'radiusMillimeters': 5, 'centerMillimeters': [0, 0]}}
    created = run(tmp_path, empty(), [
        {'id': 'guideSketch', 'tool': 'aether_cad_feature_add', 'arguments': {'feature_json': guide}},
        {'id': 'guide', 'tool': 'aether_cad_feature_add', 'arguments': {'feature_json': {
            'type': 'extrude', 'name': 'Guide', 'profileFeatureId': {'$ref': 'guideSketch.feature_id'},
            'bodyId': 'guide-body', 'operation': 'new', 'distanceMillimeters': 10,
            **({'draftAngleDegrees': 5} if surface == 'cone' else {})}}},
        {'id': 'sketch', 'tool': 'aether_cad_feature_add', 'arguments': {'feature_json': {
            'type': 'profile', 'name': 'Outline', 'plane': 'XY', 'offsetMillimeters': 0,
            'profile': {'type': 'drawing', 'contours': [{'id': 'outline', 'type': 'path', 'start': [0, 0],
                'segments': [{'type': 'line', 'end': p} for p in [[20, 0], [20, 10], [0, 10], [0, 0]]]}]}}}},
        {'id': 'extrude', 'tool': 'aether_cad_feature_add', 'arguments': {'feature_json': {
            'type': 'surface-extrude' if mode == 'surface' else 'extrude', 'name': 'Extrude',
            'profileFeatureId': {'$ref': 'sketch.feature_id'}, 'profileContourId': 'outline', 'bodyId': 'body',
            'operation': 'new', 'distanceMillimeters': 10, 'directionReference': {
                'kind': 'face-axis', 'sourceFeatureId': {'$ref': 'guide.feature_id'},
                'bodyId': 'guide-body', 'surfaceType': surface, 'label': 'Guide axis'},
            **({'thin': {'thickness1Millimeters': 1, 'thickness2Millimeters': 0}} if mode == 'thin' else {})}}},
    ])
    expected = {'solid': 1600, 'thin': 512, 'surface': 8}[mode]
    body = next(b for b in created['result']['evaluated_bodies'] if b['id'] != 'guide-body')
    assert (body['bbox_mm'][1][2] if mode == 'surface' else body['volume_mm3']) == pytest.approx(expected)
    document = json.loads(created['content'])
    assert document['formatVersion'] == 28
    guide_id = created['result']['references']['guideSketch']['feature_id']
    changed = run(tmp_path, created['content'], [{'id': 'edit', 'tool': 'aether_cad_feature_update', 'arguments': {
        'feature_id': guide_id, 'changes_json': {'frame': {**guide['frame'], 'normal': [0, 0, 1], 'xDirection': [1, 0, 0]}}}}])
    saved = json.loads(changed['content'])
    reopened = next(iter(AetherWorkspace.from_bytes(part_archive(saved)).part_definitions.values()))['feature_document']
    assert reopened == saved
    evaluated = invoke(tmp_path, 'cad.part.evaluate', json.dumps(reopened), {})
    body = next(b for b in evaluated['result']['evaluated_bodies'] if b['id'] != 'guide-body')
    assert (body['bbox_mm'][1][2] if mode == 'surface' else body['volume_mm3']) == pytest.approx({'solid': 2000, 'thin': 640, 'surface': 10}[mode])
    failed = invoke(tmp_path, 'cad.part.runprogram', changed['content'], {'program_json': json.dumps({'version': 1, 'steps': [
        {'id': 'bad', 'tool': 'aether_cad_feature_update', 'arguments': {'feature_id': guide_id,
         'changes_json': {'frame': {**guide['frame'], 'normal': [1, 0, 0], 'xDirection': [0, 1, 0]}}}}]})})
    assert 'error' in failed and 'content' not in failed


def test_part28_archive_is_refused_by_part27_codec(tmp_path):
    doc = {'format': 'aether-part', 'formatVersion': 28, 'documentId': 'axis', 'name': 'Axis', 'units': 'millimeter',
           'features': [{'id': 'e', 'type': 'extrude', 'directionReference': {
               'kind': 'face-axis', 'sourceFeatureId': 'guide', 'bodyId': 'guide-body', 'surfaceType': 'cone', 'label': 'Axis'}}]}
    raw = part_archive(doc)
    assert AetherWorkspace.from_bytes(raw).part_definitions['axis']['feature_document'] == doc
    archive = tmp_path / 'axis.aethercad'; archive.write_bytes(raw)
    prior = Path(__file__).resolve().parents[2] / 'vendor/python/aether_animation-0.1.0-30-py3-none-any.whl'
    script = 'import sys;sys.path.insert(0,sys.argv[1]);from aether_animation.aether_workspace import AetherWorkspace;AetherWorkspace.from_bytes(open(sys.argv[2],"rb").read())'
    result = subprocess.run([sys.executable, '-I', '-S', '-c', script, str(prior), str(archive)], capture_output=True, text=True)
    assert result.returncode != 0 and 'invalid authored Part projection' in result.stderr
