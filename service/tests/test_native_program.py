"""Real isolated packaged programs and proof, without importing the Studio host."""

import json
import math
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
FREECAD = Path("/Applications/FreeCAD.app/Contents/Resources/bin/freecadcmd")


def empty():
    source = json.loads(
        (ROOT / "service/tests/fixtures/automation-part.acpart").read_text()
    )
    source["features"] = []
    return json.dumps(source)


def program():
    return {
        "version": 1,
        "steps": [
            {
                "id": "outline",
                "tool": "aether_cad_sketch_rectangle",
                "arguments": {
                    "plane": "XY",
                    "x_mm": 0,
                    "y_mm": 0,
                    "width_mm": 80,
                    "height_mm": 50,
                },
            },
            {
                "id": "plate",
                "tool": "aether_cad_extrude",
                "arguments": {
                    "profile_id": {"$ref": "outline.feature_id"},
                    "depth_mm": 10,
                    "operation": "new",
                },
            },
            {
                "id": "circle",
                "tool": "aether_cad_sketch_circle",
                "arguments": {
                    "plane": "XY",
                    "offset_mm": 10,
                    "center_x_mm": 40,
                    "center_y_mm": 25,
                    "radius_mm": 5,
                },
            },
            {
                "id": "bore",
                "tool": "aether_cad_extrude",
                "arguments": {
                    "profile_id": {"$ref": "circle.feature_id"},
                    "depth_mm": 10,
                    "operation": "cut",
                    "target_body_id": {"$ref": "plate.body_id"},
                },
            },
        ],
    }


def invoke(tmp_path, command, content, arguments, *, freecad=FREECAD):
    proc = subprocess.run(
        [
            sys.executable,
            "-I",
            "-S",
            str(ROOT / "service/aether_cad_service/runtime/runner.pyz"),
            shutil.which("node"),
            str(freecad),
        ],
        input=json.dumps(
            {"command": command, "content": content, "arguments": arguments}
        ),
        text=True,
        capture_output=True,
        cwd=tmp_path,
        timeout=60,
        check=False,
        env={
            "HOME": str(tmp_path),
            "TMPDIR": str(tmp_path),
            "QT_QPA_PLATFORM": "offscreen",
        },
    )
    assert proc.returncode == 0, proc.stderr
    assert not proc.stderr
    return json.loads(proc.stdout)


def test_docs_work_without_launching_a_geometry_engine(tmp_path):
    result = invoke(
        tmp_path, "cad.part.docs", empty(), {}, freecad=Path("/usr/bin/false")
    )
    assert "content" not in result and result["result"]["total"] == 8
    assert len(result["result"]["tools"]) == 5
    assert result["result"]["execute_with"] == "cad.part.runprogram"


@pytest.mark.skipif(
    os.environ.get("AETHER_TEST_FREECAD") != "1" or not FREECAD.exists(),
    reason="Native qualification required",
)
def test_program_builds_and_verifies_referenced_bore_then_reopens(tmp_path):
    source = empty()
    result = invoke(
        tmp_path, "cad.part.runprogram", source, {"program_json": json.dumps(program())}
    )
    assert "error" not in result, result
    assert len(json.loads(source)["features"]) == 0
    assert result["result"]["steps_completed"] == 4
    assert len(json.loads(result["content"])["features"]) == 4
    expected = 40000 - 250 * math.pi
    assert result["result"]["evaluated_bodies"][0]["volume_mm3"] == pytest.approx(
        expected
    )
    references = result["result"]["references"]
    assert references["plate"]["body_id"] == references["bore"]["body_id"]
    proof = invoke(
        tmp_path, "cad.part.verify", result["content"], {"density_kg_m3": 7800}
    )
    assert "content" not in proof and "error" not in proof, proof
    measure = proof["result"]["measurements"][0]
    assert measure["volume_mm3"] == pytest.approx(expected)
    assert measure["mass_kg"] == pytest.approx(expected * 1e-9 * 7800)
    reopened = invoke(tmp_path, "cad.part.evaluate", result["content"], {})
    assert reopened["result"]["evaluated_bodies"][0]["volume_mm3"] == pytest.approx(
        expected
    )
    # A repeated equal-depth edit returns no candidate and creates no revision.
    noop = {
        "version": 1,
        "steps": [
            {
                "id": "same",
                "tool": "aether_cad_extrude_depth",
                "arguments": {
                    "feature_id": references["plate"]["feature_id"],
                    "depth_mm": 10,
                },
            }
        ],
    }
    unchanged = invoke(
        tmp_path,
        "cad.part.runprogram",
        result["content"],
        {"program_json": json.dumps(noop)},
    )
    assert "error" not in unchanged and "content" not in unchanged, unchanged


@pytest.mark.skipif(
    os.environ.get("AETHER_TEST_FREECAD") != "1" or not FREECAD.exists(),
    reason="Native qualification required",
)
def test_failed_later_step_returns_no_partial_document(tmp_path):
    bad = program()
    bad["steps"][-1]["arguments"]["target_body_id"] = "missing-solid"
    result = invoke(
        tmp_path, "cad.part.runprogram", empty(), {"program_json": json.dumps(bad)}
    )
    assert "error" in result and "content" not in result, result


@pytest.mark.parametrize(
    "encoded", ['{"version":1,"steps":[]}', "x" * 65537, '{"version":2,"steps":[]}']
)
def test_invalid_programs_refused_without_geometry(tmp_path, encoded):
    result = invoke(
        tmp_path,
        "cad.part.runprogram",
        empty(),
        {"program_json": encoded},
        freecad=Path("/usr/bin/false"),
    )
    assert "error" in result and "content" not in result


@pytest.mark.parametrize(
    "arguments",
    [{"density_kg_m3": True}, {"density_kg_m3": -1}, {"offset": True}, {"offset": -1}],
)
def test_verify_parameters_refused_without_geometry(tmp_path, arguments):
    result = invoke(
        tmp_path, "cad.part.verify", empty(), arguments, freecad=Path("/usr/bin/false")
    )
    assert "error" in result and "content" not in result
