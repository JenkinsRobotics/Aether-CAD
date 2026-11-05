"""Surface extents use the same canonical agent operations and file boundary."""
import json
import subprocess
import sys
from pathlib import Path

import pytest

from aether_animation.aether_workspace import AetherWorkspace
from documents import part_archive
from test_native_feature_operations import native, run
from test_native_program import empty, invoke

ROOT = Path(__file__).resolve().parents[2]


@native
def test_agent_surface_extents_edit_refusal_and_saved_reopen(tmp_path):
    authored = run(tmp_path, empty(), [
        {"id": "curve", "tool": "aether_cad_feature_add", "arguments": {"feature_json": {
            "type": "profile", "name": "Open curve", "plane": "XY", "offsetMillimeters": 0,
            "profile": {"type": "drawing", "contours": [{"id": "line", "type": "path", "start": [-5, 0],
                "segments": [{"type": "line", "end": [5, 0]}]}]},
        }}},
        {"id": "sheet", "tool": "aether_cad_feature_add", "arguments": {"feature_json": {
            "type": "surface-extrude", "name": "Surface", "operation": "new",
            "profileFeatureId": {"$ref": "curve.feature_id"}, "contourIds": ["line"],
            "distanceMillimeters": 4, "directionVector": [0, 0.6, 0.8], "startingOffsetMillimeters": 2,
            "secondEnd": {"endType": "blind", "distanceMillimeters": 3},
        }}},
    ])
    saved = json.loads(authored["content"])
    assert saved["formatVersion"] == 25
    feature_id = authored["result"]["references"]["sheet"]["feature_id"]
    original_id = authored["result"]["evaluated_bodies"][0]["id"]
    assert authored["result"]["evaluated_bodies"][0]["bbox_mm"][1] == pytest.approx([5, 3.6, 4.8], abs=1e-5)
    edited = run(tmp_path, authored["content"], [
        {"id": "depth", "tool": "aether_cad_feature_update", "arguments": {
            "feature_id": feature_id, "changes_json": {"distanceMillimeters": 8}}},
    ])
    reopened = invoke(tmp_path, "cad.part.evaluate", edited["content"], {})
    assert "error" not in reopened, reopened
    body = reopened["result"]["evaluated_bodies"][0]
    assert body["id"] == original_id
    assert body["bbox_mm"][0] == pytest.approx([-5, -0.6, -0.8], abs=1e-5)
    assert body["bbox_mm"][1] == pytest.approx([5, 6, 8], abs=1e-5)
    refused = invoke(tmp_path, "cad.part.runprogram", edited["content"], {"program_json": json.dumps({"version": 1, "steps": [
        {"id": "missing", "tool": "aether_cad_feature_update", "arguments": {
            "feature_id": feature_id, "changes_json": {"contourIds": ["line", "missing"]}}},
    ]})})
    assert "error" in refused and "content" not in refused, refused


def test_part23_surface_archive_roundtrip_and_previous_codec_refusal(tmp_path):
    doc = {"format": "aether-part", "formatVersion": 23, "documentId": "surface-format",
           "name": "Surface format", "units": "millimeter", "features": [
        {"id": "sheet", "type": "surface-extrude", "operation": "add", "profileFeatureId": "curve",
         "distanceMillimeters": 4, "endType": "up-to-part", "endPartId": "stop",
         "startingOffsetMillimeters": 2, "targetBodyIds": ["first", "second"],
         "directionVector": [0, 0.6, 0.8], "secondEnd": {"endType": "blind", "distanceMillimeters": 3}}]}
    data = part_archive(doc)
    reopened = AetherWorkspace.from_bytes(data)
    assert reopened.part_definitions[doc["documentId"]]["feature_document"] == doc
    archive = tmp_path / "surface.aethercad"
    archive.write_bytes(data)
    prior = ROOT / "vendor/python/aether_animation-0.1.0-25-py3-none-any.whl"
    script = 'import sys;sys.path.insert(0,sys.argv[1]);from aether_animation.aether_workspace import AetherWorkspace;AetherWorkspace.from_bytes(open(sys.argv[2],"rb").read())'
    refused = subprocess.run([sys.executable, '-I', '-S', '-c', script, str(prior), str(archive)], capture_output=True, text=True)
    assert refused.returncode != 0 and 'invalid authored Part projection' in refused.stderr
