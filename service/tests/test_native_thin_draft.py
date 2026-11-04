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


@native
def test_agent_drafted_face_stop_edits_offset_and_reopens(tmp_path):
    authored = run(tmp_path, empty(), [
        {"id": "limitSketch", "tool": "aether_cad_sketch_circle", "arguments": {
            "plane": "XY", "offset_mm": 10, "center_x_mm": 0, "center_y_mm": 0, "radius_mm": 20,
        }},
        {"id": "limit", "tool": "aether_cad_feature_add", "arguments": {"feature_json": {
            "type": "extrude", "name": "Stopping part", "profileFeatureId": {"$ref": "limitSketch.feature_id"},
            "distanceMillimeters": 5, "operation": "new",
        }}},
        {"id": "profile", "tool": "aether_cad_sketch_circle", "arguments": {
            "plane": "XY", "offset_mm": 0, "center_x_mm": 0, "center_y_mm": 0, "radius_mm": 10,
        }},
        {"id": "draft", "tool": "aether_cad_feature_add", "arguments": {"feature_json": {
            "type": "extrude", "name": "Draft to face", "profileFeatureId": {"$ref": "profile.feature_id"},
            "distanceMillimeters": 1, "operation": "new", "draftAngleDegrees": 3, "endType": "up-to-face",
            "endOffsetMillimeters": 1, "endReference": {
                "sourceFeatureId": {"$ref": "limit.feature_id"}, "bodyId": {"$ref": "limit.body_id"},
                "normal": [0, 0, -1], "label": "Lower face",
            },
        }}},
    ])
    slope = math.tan(math.radians(3))

    def expected(height):
        return math.pi * (2000 + 100 * height - 10 * slope * height**2 + slope**2 * height**3 / 3)

    assert sum(body["volume_mm3"] for body in authored["result"]["evaluated_bodies"]) == pytest.approx(expected(9), abs=1e-4)
    feature_id = authored["result"]["references"]["draft"]["feature_id"]
    edited = run(tmp_path, authored["content"], [
        {"id": "offset", "tool": "aether_cad_feature_update", "arguments": {
            "feature_id": feature_id, "changes_json": '{"endOffsetMillimeters":-2}',
        }},
    ])
    assert sum(body["volume_mm3"] for body in edited["result"]["evaluated_bodies"]) == pytest.approx(expected(12), abs=1e-4)
    reopened = invoke(tmp_path, "cad.part.verify", edited["content"], {})
    assert sum(body["volume_mm3"] for body in reopened["result"]["measurements"]) == pytest.approx(expected(12), abs=1e-4)
