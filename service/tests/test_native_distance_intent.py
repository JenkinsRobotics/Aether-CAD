"""Projected clearance survives source crossing through real packaged operations."""
import json
import math
import os
from pathlib import Path

import pytest

from test_native_program import invoke

pytestmark = pytest.mark.skipif(os.environ.get("AETHER_TEST_NATIVE") != "1", reason="Native qualification required")
FIXTURE = Path(__file__).parent / "fixtures/projected-distance.json"


def step(tmp_path, content, tool, arguments):
    program = {"version": 1, "steps": [{"id": "edit", "tool": tool, "arguments": arguments}]}
    result = invoke(tmp_path, "cad.part.runprogram", content, {"program_json": json.dumps(program)})
    assert "error" not in result, result
    return result


def test_native_projected_clearance_edit_source_crossings_and_reopen(tmp_path):
    built = step(tmp_path, FIXTURE.read_text(), "aether_cad_extrude", {
        "profile_id": "target", "profile_point_mm": [50, 45], "depth_mm": 10, "operation": "new",
    })
    content = built["content"]
    original_id = built["result"]["evaluated_bodies"][0]["id"]
    height = 50
    for next_height in [20, 80, 6, 400, 50]:
        moved = step(tmp_path, content, "aether_cad_sketch_translate", {
            "feature_id": "source", "dx_mm": 0, "dy_mm": next_height - height,
        })
        content = moved["content"]
        body = moved["result"]["evaluated_bodies"][0]
        assert body["id"] == original_id
        assert body["volume_mm3"] == pytest.approx(40 * math.pi)
        assert body["bbox_mm"][0][1] == pytest.approx(next_height - 7, abs=1e-5)
        assert body["bbox_mm"][1][1] == pytest.approx(next_height - 3, abs=1e-5)
        height = next_height
    edited = step(tmp_path, content, "aether_cad_sketch_dimension", {
        "feature_id": "target", "dimension_id": "gap", "value": 7,
    })
    saved = json.loads(edited["content"])
    assert saved["formatVersion"] == 22
    authored = saved["features"][1]["profile"]["authored"]
    assert authored["constraints"][0]["distanceSide"] == 1
    assert authored["contours"][0]["center"] == pytest.approx([50, 43])
    assert "projectionContext" not in authored and "pierceContext" not in authored
    reopened = invoke(tmp_path, "cad.part.evaluate", edited["content"], {})
    assert "error" not in reopened, reopened
    assert reopened["result"]["evaluated_bodies"][0]["bbox_mm"][0][1] == pytest.approx(41, abs=1e-5)
    bad = {"feature_id": "target", "dimension_id": "gap", "value": -1}
    refused = invoke(tmp_path, "cad.part.runprogram", edited["content"], {"program_json": json.dumps({
        "version": 1, "steps": [{"id": "bad", "tool": "aether_cad_sketch_dimension", "arguments": bad}],
    })})
    assert "error" in refused and "content" not in refused
