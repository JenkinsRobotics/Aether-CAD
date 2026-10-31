"""Real packaged projection commands, rebuilds and fresh-process reopen."""
import json
import math
import os

import pytest

from test_native_program import empty, invoke

pytestmark = pytest.mark.skipif(
    os.environ.get("AETHER_TEST_NATIVE") != "1",
    reason="Native qualification required",
)


def source_part():
    document = json.loads(empty())
    document["features"] = [
        {"id": "circle", "name": "Source", "type": "profile", "plane": "XY",
         "offsetMillimeters": 0, "suppressed": False,
         "profile": {"type": "circle", "centerMillimeters": [3, 4], "radiusMillimeters": 5}},
        {"id": "extrude", "name": "Extrude", "type": "extrude", "profileFeatureId": "circle",
         "distanceMillimeters": 10, "operation": "new", "suppressed": False},
        {"id": "target", "name": "Offset sketch", "type": "profile", "plane": "XY",
         "offsetMillimeters": 25, "suppressed": False,
         "profile": {"type": "drawing", "contours": []}},
    ]
    return json.dumps(document)


def test_packaged_projection_reopens_and_extrudes_the_exact_displaced_circle(tmp_path):
    source = source_part()
    projected = invoke(tmp_path, "cad.sketch.includemodel", source, {"feature_id": "target"})
    assert "error" not in projected, projected
    assert projected["result"]["projection"]["associative"] is False
    assert projected["result"]["projection"]["approximated_edges"] == []
    saved = json.loads(projected["content"])
    target = saved["features"][-1]["profile"]
    rings = [c for c in target["contours"] if c["type"] == "circle"]
    assert len(rings) == 1
    assert rings[0]["center"] == pytest.approx([3, 4])
    assert rings[0]["radius"] == pytest.approx(5)
    assert rings[0]["id"]
    reopened = invoke(tmp_path, "cad.sketch.inspect", projected["content"], {"feature_id": "target"})
    assert reopened["result"]["regions"]["total"] == 1
    program = {"version": 1, "steps": [{"id": "pad", "tool": "aether_cad_extrude", "arguments": {
        "profile_id": "target", "profile_point_mm": [3, 4], "depth_mm": 5, "operation": "new",
    }}]}
    extruded = invoke(tmp_path, "cad.part.runprogram", projected["content"], {"program_json": json.dumps(program)})
    assert "error" not in extruded, extruded
    bodies = extruded["result"]["evaluated_bodies"]
    assert sorted(b["volume_mm3"] for b in bodies) == pytest.approx([125 * math.pi, 250 * math.pi])
    assert any(b["bbox_mm"][0][2] == pytest.approx(25, abs=1e-5) for b in bodies)
    assert json.loads(source)["features"][-1]["profile"]["contours"] == []


@pytest.mark.parametrize("arguments", [
    {"feature_id": "target", "entities_json": '[{"body_id":"missing"}]'},
    {"feature_id": "target", "entities_json": "[]"},
    {"feature_id": "target", "tolerance_mm": 0},
    {"feature_id": "missing"},
])
def test_packaged_projection_refusal_returns_no_changed_content(tmp_path, arguments):
    result = invoke(tmp_path, "cad.sketch.includemodel", source_part(), arguments)
    assert "error" in result
    assert "content" not in result
