"""Connected Surface Add survives the real command, codec and reopen boundary."""
import json
import subprocess
import sys
from pathlib import Path

import pytest
from aether_animation.aether_workspace import AetherWorkspace
from documents import part_archive
from test_native_feature_operations import native, run
from test_native_program import empty, invoke


def sketch(name, xs, z=0):
    return {"id": name, "tool": "aether_cad_feature_add", "arguments": {"feature_json": {
        "type": "profile", "name": name, "plane": "XY", "offsetMillimeters": z,
        "profile": {"type": "drawing", "contours": [
            {"id": f"line-{i}", "type": "path", "start": [x, 0], "segments": [{"type": "line", "end": [x+10, 0]}]}
            for i, x in enumerate(xs)]}}}}


@native
@pytest.mark.parametrize("automatic", [False, True])
def test_connected_surface_add_preserves_bodies_and_refuses_detached_edits(tmp_path, automatic):
    steps = []
    for name, x in [("a", 0), ("b", 20)]:
        steps += [sketch(name+"-source", [x]), {"id": name, "tool": "aether_cad_feature_add", "arguments": {"feature_json": {
            "type": "surface-extrude", "name": name, "operation": "new", "separateBodies": False,
            "bodyId": name, "profileFeatureId": {"$ref": name+"-source.feature_id"}, "distanceMillimeters": 4}}}]
    steps.append(sketch("extension", [0, 20], 4))
    steps.append({"id": "join", "tool": "aether_cad_feature_add", "arguments": {"feature_json": {
        "type": "surface-extrude", "name": "Join", "operation": "add", "profileFeatureId": {"$ref": "extension.feature_id"},
        "distanceMillimeters": 4, **({"scopeMode": "all"} if automatic else {"targetBodyId": "b", "targetBodyIds": ["b", "a"]})}}})
    authored = run(tmp_path, empty(), steps)
    saved = json.loads(authored["content"])
    assert saved["formatVersion"] == 26
    feature = saved["features"][-1]
    assert feature["connectedMerge"]
    assert sorted(group["bodyId"] for group in feature["scopeResolution"]["groups"]) == ["a", "b"]
    assert sorted(body["id"] for body in authored["result"]["evaluated_bodies"]) == ["a", "b"]
    edited = run(tmp_path, authored["content"], [{"id": "depth", "tool": "aether_cad_feature_update", "arguments": {
        "feature_id": feature["id"], "changes_json": {"distanceMillimeters": 7}}}])
    archive = part_archive(json.loads(edited["content"]))
    doc = next(iter(AetherWorkspace.from_bytes(archive).part_definitions.values()))["feature_document"]
    reopened = invoke(tmp_path, "cad.part.evaluate", json.dumps(doc), {})
    assert "error" not in reopened, reopened
    for body in reopened["result"]["evaluated_bodies"]:
        assert body["id"] in ["a", "b"]
        assert body["bbox_mm"][1][2] == pytest.approx(11, abs=1e-5)
    refused = invoke(tmp_path, "cad.part.runprogram", edited["content"], {"program_json": json.dumps({"version": 1, "steps": [
        {"id": "detach", "tool": "aether_cad_feature_update", "arguments": {
            "feature_id": feature["id"], "changes_json": {"startingOffsetMillimeters": 1}}}]})})
    assert "error" in refused and "content" not in refused, refused


def test_part26_connected_surface_intent_roundtrip_and_old_reader_refusal(tmp_path):
    doc = {"format": "aether-part", "formatVersion": 26, "documentId": "surface-groups", "name": "Surface groups", "units": "millimeter", "features": [
        {"id": "join", "type": "surface-extrude", "operation": "add", "connectedMerge": True,
         "targetBodyId": "a", "targetBodyIds": ["a", "b"], "scopeResolution": {"targets": ["a", "b"], "groups": [
             {"bodyId": "a", "sources": ["a"]}, {"bodyId": "b", "sources": ["b"]}]}}]}
    raw = part_archive(doc)
    assert AetherWorkspace.from_bytes(raw).part_definitions[doc["documentId"]]["feature_document"] == doc
    archive = tmp_path / "groups.aethercad"
    archive.write_bytes(raw)
    prior = Path(__file__).resolve().parents[2] / "vendor/python/aether_animation-0.1.0-28-py3-none-any.whl"
    script = 'import sys;sys.path.insert(0,sys.argv[1]);from aether_animation.aether_workspace import AetherWorkspace;AetherWorkspace.from_bytes(open(sys.argv[2],"rb").read())'
    result = subprocess.run([sys.executable, '-I', '-S', '-c', script, str(prior), str(archive)], capture_output=True, text=True)
    assert result.returncode != 0 and 'invalid authored Part projection' in result.stderr
