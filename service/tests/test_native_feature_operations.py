"""Agents author canonical features through the same native pipeline as the editor."""

import json
import os

import pytest

from test_native_program import empty, invoke

native = pytest.mark.skipif(
    os.environ.get("AETHER_TEST_NATIVE") != "1",
    reason="Native qualification required",
)


def run(tmp_path, content, steps):
    result = invoke(
        tmp_path,
        "cad.part.runprogram",
        content,
        {"program_json": json.dumps({"version": 1, "steps": steps})},
    )
    assert "error" not in result, result
    return result


def volume(result):
    return result["result"]["evaluated_bodies"][0]["volume_mm3"]


@native
def test_agent_builds_shells_edits_and_deletes_canonical_features(tmp_path):
    tray = run(
        tmp_path,
        empty(),
        [
            {"id": "outline", "tool": "aether_cad_sketch_rectangle",
             "arguments": {"plane": "XY", "x_mm": 0, "y_mm": 0, "width_mm": 80, "height_mm": 50}},
            {"id": "plate", "tool": "aether_cad_feature_add",
             "arguments": {"feature_json": {"type": "extrude", "name": "Plate",
                           "profileFeatureId": {"$ref": "outline.feature_id"},
                           "distanceMillimeters": 10, "operation": "new", "endType": "blind",
                           "separateBodies": True}}},
            # The open face is referenced by meaning — the Plate's +Z face — so it
            # survives the depth edit below (a fixed XY@10 mm coordinate would not).
            {"id": "tray", "tool": "aether_cad_feature_add",
             "arguments": {"feature_json": {"type": "shell", "name": "Tray",
                           "targetBodyId": {"$ref": "plate.body_id"}, "thicknessMillimeters": 2,
                           "removedFaces": [{"sourceFeatureId": {"$ref": "plate.feature_id"},
                                             "bodyId": {"$ref": "plate.body_id"},
                                             "label": "Top", "normal": [0, 0, 1]}]}}},
        ],
    )
    # 80×50×10 block, 2 mm walls, open top: 40000 − 76×46×8.
    assert volume(tray) == pytest.approx(12032)
    refs = tray["result"]["references"]

    deeper = run(tmp_path, tray["content"], [
        {"id": "depth", "tool": "aether_cad_feature_update",
         "arguments": {"feature_id": refs["plate"]["feature_id"], "changes_json": '{"distanceMillimeters":20}'}},
    ])
    assert volume(deeper) == pytest.approx(80 * 50 * 20 - 76 * 46 * 18)

    solid = run(tmp_path, deeper["content"], [
        {"id": "unshell", "tool": "aether_cad_feature_delete",
         "arguments": {"feature_id": refs["tray"]["feature_id"]}},
    ])
    assert volume(solid) == pytest.approx(80 * 50 * 20)

    proof = invoke(tmp_path, "cad.part.verify", solid["content"], {})
    assert proof["result"]["measurements"][0]["volume_mm3"] == pytest.approx(80000)


@native
def test_agent_feature_that_fails_natively_commits_nothing(tmp_path):
    result = invoke(tmp_path, "cad.part.runprogram", empty(), {"program_json": json.dumps({"version": 1, "steps": [
        {"id": "outline", "tool": "aether_cad_sketch_rectangle",
         "arguments": {"plane": "XY", "x_mm": 0, "y_mm": 0, "width_mm": 20, "height_mm": 20}},
        {"id": "pad", "tool": "aether_cad_feature_add",
         "arguments": {"feature_json": {"type": "extrude", "name": "Pad", "profileFeatureId": {"$ref": "outline.feature_id"},
                       "distanceMillimeters": 5, "operation": "new", "endType": "blind"}}},
        # A shell thicker than the part cannot be built: the whole program is refused.
        {"id": "bad", "tool": "aether_cad_feature_add",
         "arguments": {"feature_json": {"type": "shell", "name": "Bad", "targetBodyId": {"$ref": "pad.body_id"},
                       "thicknessMillimeters": 50, "removedFaces": [{"plane": "XY", "offsetMillimeters": 5}]}}},
    ]})})
    assert "error" in result and "content" not in result, result


@native
def test_coordinate_open_face_reports_why_an_upstream_edit_fails(tmp_path):
    tray = run(tmp_path, empty(), [
        {"id": "outline", "tool": "aether_cad_sketch_rectangle",
         "arguments": {"plane": "XY", "x_mm": 0, "y_mm": 0, "width_mm": 80, "height_mm": 50}},
        {"id": "plate", "tool": "aether_cad_extrude",
         "arguments": {"profile_id": {"$ref": "outline.feature_id"}, "depth_mm": 10, "operation": "new"}},
        {"id": "tray", "tool": "aether_cad_feature_add",
         "arguments": {"feature_json": {"type": "shell", "name": "Tray", "targetBodyId": {"$ref": "plate.body_id"},
                       "thicknessMillimeters": 2, "removedFaces": [{"plane": "XY", "offsetMillimeters": 10}]}}},
    ])
    plate = tray["result"]["references"]["plate"]["feature_id"]
    result = invoke(tmp_path, "cad.part.runprogram", tray["content"], {"program_json": json.dumps({"version": 1, "steps": [
        {"id": "deeper", "tool": "aether_cad_extrude_depth", "arguments": {"feature_id": plate, "depth_mm": 20}}]})})
    # The legacy coordinate no longer matches a face; the agent is told why instead of a bare "invalid".
    assert result["error"]["kind"] == "invalid"
    assert "shell matched no face" in result["error"]["message"]
