"""Exact split-circle UI output retains the same solid through STEP export."""
import base64
import json
import math
import subprocess
from pathlib import Path

import pytest
from aether_freecad import BuildJob, Feature, FreeCADEngine


def test_split_circle_ui_exports_and_reopens_without_changing_shape(tmp_path):
    path = Path(__file__).resolve().parents[2] / 'service/tests/fixtures/pierce-topology-ui-documents.json'
    case = next(c for c in json.loads(path.read_text()) if c['name'] == 'circle-split')
    job = BuildJob(features=[Feature(f['id'], f['kind'], f['parameters']) for f in case['features']])
    with FreeCADEngine() as engine:
        result = engine.export(job, {'format': 'step'})
        assert result['status'] == 'ok', result
        step, metrics, script = tmp_path / 'split.step', tmp_path / 'metrics.json', tmp_path / 'read.py'
        step.write_bytes(base64.b64decode(result['data_base64']))
        script.write_text(
            'import Part,json\n'
            f's=Part.Shape();s.read({str(step)!r})\n'
            f"open({str(metrics)!r},'w').write(json.dumps([s.isValid(),len(s.Solids),s.Volume,list(s.Solids[0].CenterOfMass),s.BoundBox.XLength,s.BoundBox.YLength,s.BoundBox.ZLength]))\n"
        )
        run = subprocess.run([engine.command, str(script)], input='', capture_output=True, text=True, timeout=20, check=True)
        assert metrics.read_text(), run.stdout + run.stderr
        valid, solids, volume, center, width, depth, height = json.loads(metrics.read_text())
        assert valid and solids == 1
        assert volume == pytest.approx(45 * math.pi, rel=1e-8)
        assert center == pytest.approx([0, -2.5, 0], abs=1e-7)
        assert [width, depth, height] == pytest.approx([6, 5, 6], abs=1e-7)
