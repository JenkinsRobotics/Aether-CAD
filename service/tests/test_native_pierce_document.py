"""Saved associative Pierce constraints cross the real packaged worker boundary."""
import copy
import json
import math
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
from test_native_connected_profile import ROOT, bodies, invoke

CASES = json.loads((Path(__file__).parent / "fixtures/pierce-documents.json").read_text())


@pytest.mark.parametrize("case", CASES, ids=lambda c: c["name"])
def test_saved_pierce_reopens_through_packaged_native_worker(tmp_path, case):
    path = tmp_path / (case["name"] + ".acpart")
    content = json.dumps(case["document"])
    path.write_text(content)
    result = bodies(invoke(tmp_path, json.loads(path.read_text())))
    if case["name"] == "circle-center":
        assert len(result) == 1
        assert result[0]["volume_mm3"] == pytest.approx(45 * math.pi, rel=1e-8)
    else:
        assert not result
    assert path.read_text() == content


def test_upstream_edit_rebuilds_and_keeps_pierce_in_saved_edit_candidate(tmp_path):
    document = copy.deepcopy(next(c["document"] for c in CASES if c["name"] == "circle-center"))
    document["features"][0]["profile"]["contours"][0]["segments"][0]["end"] = [40, 5]
    result = bodies(invoke(tmp_path, document))
    assert result[0]["volume_mm3"] == pytest.approx(45 * math.pi, rel=1e-8)
    edited = invoke(tmp_path, document, "cad.extrude.setdepth", {"feature_id": "pad", "depth_mm": 8})
    assert "error" not in edited, edited
    saved = json.loads(edited["content"])
    assert saved["formatVersion"] == 21
    assert saved["features"][1]["profile"]["constraints"] == document["features"][1]["profile"]["constraints"]
    assert bodies(invoke(tmp_path, saved))[0]["volume_mm3"] == pytest.approx(72 * math.pi, rel=1e-8)


@pytest.mark.parametrize("change", ["missing", "suppressed", "branch"])
def test_failed_source_returns_no_saved_candidate(tmp_path, change):
    document = copy.deepcopy(next(c["document"] for c in CASES if c["name"] == "circle-center"))
    if change == "missing":
        document["features"].pop(0)
    elif change == "suppressed":
        document["features"][0]["suppressed"] = True
    else:
        document["features"][0]["profile"]["contours"][0]["segments"][0]["end"] = [40, -1]
    result = invoke(tmp_path, document, "cad.extrude.setdepth", {"feature_id": "pad", "depth_mm": 8})
    assert result["error"] == {"kind": "invalid"}
    assert "content" not in result


def test_project_container_reopens_the_same_associative_native_part(tmp_path):
    def project(action, arguments):
        run = subprocess.run(
            [sys.executable, "-I", "-S", str(ROOT / "service/aether_cad_service/runtime/runner.pyz"), shutil.which("node"),
             os.environ.get("AETHER_FREECAD_CMD", "/Applications/FreeCAD.app/Contents/Resources/bin/freecadcmd")],
            input=json.dumps({"service": "/api/cad/project-" + action, "arguments": arguments}),
            text=True, capture_output=True, cwd=tmp_path, timeout=60, check=True,
            env={"HOME": str(tmp_path), "TMPDIR": str(tmp_path), "QT_QPA_PLATFORM": "offscreen"},
        )
        assert not run.stderr
        response = json.loads(run.stdout)
        assert "error" not in response, response
        return response["result"]

    document = next(c["document"] for c in CASES if c["name"] == "circle-center")
    created = project("create", {"name": "Pierce project", "operation_id": "pierce-test", "packaging": "project"})
    saved = project("edit", {**created, "operation": "save_part", "part_id": created["project"]["parts"][0]["id"], "document": document})
    reopened = project("read", {"data_base64": saved["data_base64"]})
    retained = reopened["project"]["parts"][0]["document"]
    assert retained["formatVersion"] == 21
    assert retained["features"] == document["features"]
    assert bodies(invoke(tmp_path, retained))[0]["volume_mm3"] == pytest.approx(45 * math.pi, rel=1e-8)
