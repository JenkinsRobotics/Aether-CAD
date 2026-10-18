"""Reopen STEP from real editor output, checking its independent exact position."""
import base64
import json
import math
import subprocess
from pathlib import Path

import pytest
from aether_freecad import BuildJob, Feature, FreeCADEngine

CASES = json.loads((Path(__file__).resolve().parents[2] / 'service/tests/fixtures/pierce-ui-documents.json').read_text())


@pytest.fixture(scope='module')
def engine():
    with FreeCADEngine() as instance:
        yield instance


@pytest.mark.parametrize(('name', 'x'), [('center', 10), ('circle-branch', -5), ('repaired', 20)])
def test_editor_pierce_exports_exact_solid_at_selected_intersection(engine, tmp_path, name, x):
    features = next(c['features'] for c in CASES if c['name'] == name)
    job = BuildJob(features=[Feature(f['id'], f['kind'], f['parameters']) for f in features])
    result = engine.export(job, {'format': 'step'})
    assert result['status'] == 'ok', result
    path, metrics, script = tmp_path / 'part.step', tmp_path / 'metrics.json', tmp_path / 'read.py'
    path.write_bytes(base64.b64decode(result['data_base64']))
    script.write_text(
        'import Part,json\n'
        f's=Part.Shape();s.read({str(path)!r})\n'
        f"open({str(metrics)!r},'w').write(json.dumps([s.isValid(),len(s.Solids),s.Volume,list(s.Solids[0].CenterOfMass),s.BoundBox.XLength,s.BoundBox.YLength,s.BoundBox.ZLength]))\n"
    )
    run = subprocess.run([engine.command, str(script)], input='', capture_output=True, text=True, timeout=20, check=True)
    assert metrics.read_text(), run.stdout + run.stderr
    valid, solids, volume, center, width, depth, height = json.loads(metrics.read_text())
    assert valid and solids == 1
    assert volume == pytest.approx(45 * math.pi, rel=1e-8)
    assert center == pytest.approx([x, -2.5, 0], abs=1e-7)
    assert [width, depth, height] == pytest.approx([6, 5, 6], abs=1e-7)
