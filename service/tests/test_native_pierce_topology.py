"""Split/trim output must retain finite native contacts across the saved worker."""
import json
import math
from pathlib import Path

import pytest
from test_native_connected_profile import bodies, invoke

FOLDER = Path(__file__).parent / 'fixtures'
CASES = json.loads((FOLDER / 'pierce-topology-documents.json').read_text()) + json.loads((FOLDER / 'pierce-topology-ui-documents.json').read_text())


@pytest.mark.parametrize('case', CASES, ids=lambda c: c['name'])
def test_split_and_trim_saved_pierce_rebuilds(tmp_path, case):
    content = json.dumps(case['document'])
    path = tmp_path / (case['name'] + '.acpart')
    path.write_text(content)
    response = bodies(invoke(tmp_path, json.loads(path.read_text())))
    if case['name'] == 'circle-split':
        assert len(response) == 1
        assert response[0]['volume_mm3'] == pytest.approx(45 * math.pi, rel=1e-8)
    else:
        assert not response
    assert path.read_text() == content
    relations = [c for f in case['document']['features'] if f['type'] == 'profile'
                 for c in f['profile'].get('constraints', []) if c['kind'] == 'pierce']
    checks = [c for f in case['features'] for c in f['parameters'].get('pierce_checks', [])]
    if relations:
        assert checks, 'A saved relation must reach native contact validation.'


def test_split_circle_retains_relationship_through_downstream_depth_edit(tmp_path):
    document = next(c['document'] for c in CASES if c['name'] == 'circle-split')
    changed = invoke(tmp_path, document, 'cad.extrude.setdepth', {'feature_id': 'pad', 'depth_mm': 8})
    assert 'error' not in changed, changed
    saved = json.loads(changed['content'])
    assert saved['features'][1]['profile']['constraints'] == document['features'][1]['profile']['constraints']
    assert bodies(invoke(tmp_path, saved))[0]['volume_mm3'] == pytest.approx(72 * math.pi, rel=1e-8)
