"""Canonical saved Pierce jobs verify independent native source/target geometry."""
import base64
import copy
import json
import math
import subprocess
from pathlib import Path

import pytest
from aether_freecad import BuildJob, Feature, FreeCADEngine

CASES = json.loads((Path(__file__).resolve().parents[2] / "service/tests/fixtures/pierce-documents.json").read_text())


@pytest.fixture(scope="module")
def engine():
    with FreeCADEngine() as instance:
        assert "sketch-pierce" in instance.describe()["capabilities"]
        yield instance


def build(engine, features):
    return engine.build(BuildJob(features=[Feature(f["id"], f["kind"], f["parameters"]) for f in features]))


@pytest.mark.parametrize("case", CASES, ids=lambda c: c["name"])
def test_saved_canonical_target_native_contact(engine, case):
    before = copy.deepcopy(case)
    result = build(engine, case["features"])
    assert not result.diagnostics, result.diagnostics
    if case["name"] == "circle-center":
        assert len(result.bodies) == 1
        assert result.bodies[0].volume_mm3 == pytest.approx(45 * math.pi, rel=1e-8)
    assert case == before


@pytest.mark.parametrize("mutation", ["source", "world", "target", "geometry", "missing-source", "malformed-checks", "malformed-target"])
def test_native_boundary_refuses_stale_or_invalid_contact(engine, mutation):
    features = copy.deepcopy(next(c["features"] for c in CASES if c["name"] == "circle-center"))
    source = next(f for f in features if "#pierce-source#" in f["id"])
    target = next(f for f in features if "pierce_checks" in f["parameters"])
    check = target["parameters"]["pierce_checks"][0]
    if mutation == "source":
        source["parameters"]["segments"][0]["end"] = [40, 5]
    elif mutation == "world":
        check["world_point"] = [11, 0, 0]
    elif mutation == "target":
        target["parameters"]["center_mm"] = [11, 0]
    elif mutation == "geometry":
        check["target"]["geometry"] = 99
    elif mutation == "missing-source":
        check["source_sketch"] = "missing"
    elif mutation == "malformed-checks":
        target["parameters"]["pierce_checks"] = None
    else:
        check["target"] = None
    result = build(engine, features)
    assert result.diagnostics
    assert not result.bodies


def test_saved_pierce_solid_exports_exact_step_and_reopens_at_its_contact(engine, tmp_path):
    features = next(c["features"] for c in CASES if c["name"] == "circle-center")
    job = BuildJob(features=[Feature(f["id"], f["kind"], f["parameters"]) for f in features])
    result = engine.export(job, {"format": "step"})
    assert result["status"] == "ok", result
    path, metrics, script = tmp_path / "pierce.step", tmp_path / "metrics.json", tmp_path / "read.py"
    path.write_bytes(base64.b64decode(result["data_base64"]))
    script.write_text(
        "import Part,json\n"
        f"s=Part.Shape();s.read({str(path)!r})\n"
        f"open({str(metrics)!r},'w').write(json.dumps([s.isValid(),len(s.Solids),s.Volume,list(s.Solids[0].CenterOfMass),s.BoundBox.XLength,s.BoundBox.YLength,s.BoundBox.ZLength]))\n"
    )
    run = subprocess.run([engine.command, str(script)], input="", capture_output=True, text=True, timeout=20, check=True)
    assert metrics.read_text(), run.stdout + run.stderr
    valid, solids, volume, center, x, y, z = json.loads(metrics.read_text())
    assert valid and solids == 1
    assert volume == pytest.approx(45 * math.pi, rel=1e-8)
    assert center == pytest.approx([10, -2.5, 0], abs=1e-7)
    assert [x, y, z] == pytest.approx([6, 5, 6], abs=1e-7)
