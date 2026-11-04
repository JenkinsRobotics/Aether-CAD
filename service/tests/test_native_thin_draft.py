"""Thin + Draft is an editable native feature through the same agent operations."""

import json
import math

import pytest

from test_native_feature_operations import native, run, volume
from test_native_program import empty, invoke


@native
def test_agent_authors_edits_and_reopens_drafted_thin_wall(tmp_path):
    authored = run(tmp_path, empty(), [
        {"id": "sketch", "tool": "aether_cad_feature_add", "arguments": {"feature_json": {
            "type": "profile", "name": "Circular wall sketch", "plane": "XY", "offsetMillimeters": 0,
            "profile": {"type": "drawing", "contours": [{"id": "wall", "type": "circle", "center": [0, 0], "radius": 10}]},
        }}},
        {"id": "wall", "tool": "aether_cad_feature_add", "arguments": {"feature_json": {
            "type": "extrude", "name": "Drafted thin wall", "profileFeatureId": {"$ref": "sketch.feature_id"},
            "profileContourId": "wall", "distanceMillimeters": 10, "operation": "new", "draftAngleDegrees": 3,
            "thin": {"thickness1Millimeters": 2, "thickness2Millimeters": 1},
        }}},
    ])
    expected = math.pi * 21 * (30 - 100 * math.tan(math.radians(3)))
    assert volume(authored) == pytest.approx(expected, abs=1e-4)
    feature_id = authored["result"]["references"]["wall"]["feature_id"]
    edited = run(tmp_path, authored["content"], [
        {"id": "resize", "tool": "aether_cad_feature_update", "arguments": {
            "feature_id": feature_id,
            "changes_json": json.dumps({"draftAngleDegrees": 5, "thin": {"thickness1Millimeters": 3, "thickness2Millimeters": 1}}),
        }},
    ])
    expected = math.pi * 22 * (40 - 100 * math.tan(math.radians(5)))
    assert volume(edited) == pytest.approx(expected, abs=1e-4)
    reopened = invoke(tmp_path, "cad.part.verify", edited["content"], {})
    assert reopened["result"]["measurements"][0]["volume_mm3"] == pytest.approx(expected, abs=1e-4)

    invalid = invoke(tmp_path, "cad.part.runprogram", edited["content"], {"program_json": json.dumps({"version": 1, "steps": [
        {"id": "collapse", "tool": "aether_cad_feature_update", "arguments": {"feature_id": feature_id, "changes_json": '{"draftAngleDegrees":80}'}},
    ]})})
    assert "error" in invalid and "content" not in invalid, invalid
    unchanged = invoke(tmp_path, "cad.part.verify", edited["content"], {})
    assert unchanged["result"]["measurements"][0]["volume_mm3"] == pytest.approx(expected, abs=1e-4)
