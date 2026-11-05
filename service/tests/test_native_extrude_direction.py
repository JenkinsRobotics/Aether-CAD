"""Direction references through the packaged agent, archive and native rebuild."""
import json
import subprocess
import sys
from pathlib import Path

import pytest
from aether_animation.aether_workspace import AetherWorkspace
from documents import part_archive
from test_native_feature_operations import native, run
from test_native_program import empty, invoke


@native
def test_agent_axis_direction_edit_reopen_and_failed_transaction(tmp_path):
    axis = {"kind": "axis", "partId": "guide", "candidateId": "axis", "label": "Axis",
            "originMillimeters": [0, 0, 0], "directionMillimeters": [.6, 0, .8]}
    created = run(tmp_path, empty(), [
        {"id": "axis", "tool": "aether_cad_feature_add", "arguments": {"feature_json": {
            "type": "axis", "name": "Direction", "definition": {"method": "edge", "axis": axis}}}},
        {"id": "sketch", "tool": "aether_cad_sketch_rectangle", "arguments": {
            "plane": "XY", "x_mm": 0, "y_mm": 0, "width_mm": 20, "height_mm": 10}},
        {"id": "extrude", "tool": "aether_cad_feature_add", "arguments": {"feature_json": {
            "type": "extrude", "name": "Extrude", "operation": "new", "distanceMillimeters": 10,
            "profileFeatureId": {"$ref": "sketch.feature_id"}, "directionReference": {
                "kind": "axis", "sourceFeatureId": {"$ref": "axis.feature_id"}, "label": "Direction"}}}},
    ])
    assert created["result"]["evaluated_bodies"][0]["volume_mm3"] == pytest.approx(1600)
    document = json.loads(created["content"])
    assert document["formatVersion"] == 27
    axis_id = created["result"]["references"]["axis"]["feature_id"]
    updated = run(tmp_path, created["content"], [{"id": "axis", "tool": "aether_cad_feature_update", "arguments": {
        "feature_id": axis_id, "changes_json": {"definition": {"method": "edge", "axis": {**axis, "directionMillimeters": [0, 0, 1]}}}}}])
    saved = json.loads(updated["content"])
    archive = part_archive(saved)
    reopened = next(iter(AetherWorkspace.from_bytes(archive).part_definitions.values()))["feature_document"]
    assert reopened == saved
    evaluated = invoke(tmp_path, "cad.part.evaluate", json.dumps(reopened), {})
    assert evaluated["result"]["evaluated_bodies"][0]["volume_mm3"] == pytest.approx(2000)
    failed = invoke(tmp_path, "cad.part.runprogram", updated["content"], {"program_json": json.dumps({"version": 1, "steps": [
        {"id": "bad", "tool": "aether_cad_feature_update", "arguments": {"feature_id": axis_id,
         "changes_json": {"definition": {"method": "edge", "axis": {**axis, "directionMillimeters": [1, 0, 0]}}}}}]})})
    assert "error" in failed and "content" not in failed


def test_part27_archive_is_refused_by_the_previous_codec(tmp_path):
    doc = {"format": "aether-part", "formatVersion": 27, "documentId": "direction", "name": "Direction", "units": "millimeter",
           "features": [{"id": "e", "type": "extrude", "directionReference": {"kind": "axis", "sourceFeatureId": "axis", "label": "Axis"}}]}
    raw = part_archive(doc)
    assert AetherWorkspace.from_bytes(raw).part_definitions[doc["documentId"]]["feature_document"] == doc
    archive = tmp_path / 'direction.aethercad'
    archive.write_bytes(raw)
    prior = Path(__file__).resolve().parents[2] / 'vendor/python/aether_animation-0.1.0-29-py3-none-any.whl'
    script = 'import sys;sys.path.insert(0,sys.argv[1]);from aether_animation.aether_workspace import AetherWorkspace;AetherWorkspace.from_bytes(open(sys.argv[2],"rb").read())'
    result = subprocess.run([sys.executable, '-I', '-S', '-c', script, str(prior), str(archive)], capture_output=True, text=True)
    assert result.returncode != 0 and 'invalid authored Part projection' in result.stderr
