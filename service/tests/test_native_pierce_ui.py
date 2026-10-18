"""Actual mounted-editor output must reopen and rebuild in the packaged engine."""
import copy
import json
import math
from pathlib import Path

import pytest
from test_native_connected_profile import bodies, invoke

CASES = json.loads((Path(__file__).parent / 'fixtures/pierce-ui-documents.json').read_text())


@pytest.mark.parametrize('case', CASES, ids=lambda c: c['name'])
def test_interactively_authored_pierce_file_rebuilds(tmp_path, case):
    path = tmp_path / (case['name'] + '.acpart')
    content = json.dumps(case['document'])
    path.write_text(content)
    result = bodies(invoke(tmp_path, json.loads(path.read_text())))
    if any(f['type'] == 'extrude' for f in case['document']['features']):
        assert len(result) == 1
        assert result[0]['volume_mm3'] == pytest.approx(45 * math.pi, rel=1e-8)
    else:
        assert not result
    assert path.read_text() == content
    assert 'pierceContext' not in content and 'projectionContext' not in content


def test_interactive_relationship_survives_upstream_edit_and_downstream_command(tmp_path):
    document = copy.deepcopy(next(c['document'] for c in CASES if c['name'] == 'center'))
    document['features'][0]['profile']['contours'][0]['segments'][0]['end'] = [40, 5]
    response = invoke(tmp_path, document, 'cad.extrude.setdepth', {'feature_id': 'pad', 'depth_mm': 8})
    assert 'error' not in response, response
    saved = json.loads(response['content'])
    assert saved['features'][1]['profile']['constraints'] == document['features'][1]['profile']['constraints']
    assert bodies(invoke(tmp_path, saved))[0]['volume_mm3'] == pytest.approx(72 * math.pi, rel=1e-8)


def test_interactive_source_loss_cannot_produce_a_silent_saved_candidate(tmp_path):
    document = copy.deepcopy(next(c['document'] for c in CASES if c['name'] == 'center'))
    document['features'].pop(0)
    response = invoke(tmp_path, document, 'cad.extrude.setdepth', {'feature_id': 'pad', 'depth_mm': 8})
    assert response['error'] == {'kind': 'invalid'}
    assert 'content' not in response
