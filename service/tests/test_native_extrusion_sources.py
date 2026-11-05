"""Agents author the same multi-sketch Extrude and stable outputs as the UI."""
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
@pytest.mark.parametrize("mode", ["solid", "thin", "surface"])
def test_multiple_sketch_sources_survive_edits_and_saved_reopen(tmp_path, mode):
    steps = []
    for name, x, z in [("first", -12, 0), ("second", 12, 3)]:
        steps.append({"id": name, "tool": "aether_cad_feature_add", "arguments": {"feature_json": {
            "type": "profile", "name": name, "plane": "XY", "offsetMillimeters": z,
            "profile": {"type": "drawing", "contours": [{"id": "same-name", "type": "circle", "center": [x, 0], "radius": 4}]},
        }}})
    feature = {"type": "surface-extrude" if mode == "surface" else "extrude", "operation": "new", "name": "Extrude",
               "profileFeatureId": {"$ref": "first.feature_id"}, "distanceMillimeters": 5,
               "profileSelections": [{"profileFeatureId": {"$ref": f"{name}.feature_id"}, "profileContourId": "same-name"}
                                     for name in ["first", "second"]]}
    if mode != "surface":
        feature["separateBodies"] = True
    if mode == "thin":
        feature["thin"] = {"thickness1Millimeters": 1, "thickness2Millimeters": 0}
    steps.append({"id": "extrude", "tool": "aether_cad_feature_add", "arguments": {"feature_json": feature}})
    authored = run(tmp_path, empty(), steps)
    saved = json.loads(authored["content"])
    assert saved["formatVersion"] == 26
    refs = authored["result"]["references"]
    original = saved["features"][-1]
    changes = {"profileFeatureId": refs["second"]["feature_id"], "distanceMillimeters": 8,
               "profileSelections": [{"profileFeatureId": refs["second"]["feature_id"], "profileContourId": "same-name"}]}
    edited = run(tmp_path, authored["content"], [{"id": "keep_second", "tool": "aether_cad_feature_update", "arguments": {
        "feature_id": refs["extrude"]["feature_id"], "changes_json": changes}}])
    current = json.loads(edited["content"])["features"][-1]
    assert len(original["bodyOutputs"]) == 2
    assert current["outputProfileId"] == refs["first"]["feature_id"]
    assert len(current["bodyOutputs"]) == 1
    assert current["bodyOutputs"][0] in original["bodyOutputs"]
    rebuilt = invoke(tmp_path, "cad.part.evaluate", edited["content"], {})
    assert "error" not in rebuilt, rebuilt
    body = rebuilt["result"]["evaluated_bodies"][0]
    assert body["bbox_mm"][0][2] == pytest.approx(3, abs=1e-5)
    assert body["bbox_mm"][1][2] == pytest.approx(11, abs=1e-5)
    refused = invoke(tmp_path, "cad.part.runprogram", edited["content"], {"program_json": json.dumps({"version": 1, "steps": [
        {"id": "missing", "tool": "aether_cad_feature_update", "arguments": {"feature_id": refs["extrude"]["feature_id"],
         "changes_json": {"profileSelections": [{"profileFeatureId": refs["second"]["feature_id"], "profileContourId": "gone"}]}}},
    ]})})
    assert "error" in refused and "content" not in refused, refused


def test_part24_lineage_archive_and_previous_codec_refusal(tmp_path):
    document = {"format": "aether-part", "formatVersion": 24, "documentId": "lineage", "name": "Lineage", "units": "millimeter", "features": [
        {"id": "e", "type": "extrude", "profileFeatureId": "b", "outputProfileId": "a", "separateBodies": True,
         "bodyOutputs": ["saved-id"], "profileSelections": [{"profileFeatureId": "b", "profileContourId": "same-name"}]}]}
    data = part_archive(document)
    assert AetherWorkspace.from_bytes(data).part_definitions["lineage"]["feature_document"] == document
    path = tmp_path / "part.aethercad"
    path.write_bytes(data)
    prior = Path(__file__).resolve().parents[2] / "vendor/python/aether_animation-0.1.0-26-py3-none-any.whl"
    script = 'import sys;sys.path.insert(0,sys.argv[1]);from aether_animation.aether_workspace import AetherWorkspace;AetherWorkspace.from_bytes(open(sys.argv[2],"rb").read())'
    refused = subprocess.run([sys.executable, '-I', '-S', '-c', script, str(prior), str(path)], capture_output=True, text=True)
    assert refused.returncode != 0 and 'invalid authored Part projection' in refused.stderr


def test_part25_surface_output_archive_and_previous_codec_refusal(tmp_path):
    document = {"format": "aether-part", "formatVersion": 25, "documentId": "lineage", "name": "Lineage", "units": "millimeter", "features": [
        {"id": "e", "type": "surface-extrude", "profileFeatureId": "b", "outputProfileId": "a", "separateBodies": True,
         "bodyOutputs": ["saved-id"], "profileSelections": [{"profileFeatureId": "b", "profileContourId": "same-name"}]}]}
    data = part_archive(document)
    assert AetherWorkspace.from_bytes(data).part_definitions["lineage"]["feature_document"] == document
    path = tmp_path / "part.aethercad"
    path.write_bytes(data)
    prior = Path(__file__).resolve().parents[2] / "vendor/python/aether_animation-0.1.0-27-py3-none-any.whl"
    script = 'import sys;sys.path.insert(0,sys.argv[1]);from aether_animation.aether_workspace import AetherWorkspace;AetherWorkspace.from_bytes(open(sys.argv[2],"rb").read())'
    refused = subprocess.run([sys.executable, '-I', '-S', '-c', script, str(prior), str(path)], capture_output=True, text=True)
    assert refused.returncode != 0 and 'invalid authored Part projection' in refused.stderr


@native
def test_agent_whole_surface_assigns_persistent_source_curve_ids(tmp_path):
    steps = [
        {"id": "source", "tool": "aether_cad_feature_add", "arguments": {"feature_json": {
            "type": "profile", "name": "Open sketch", "plane": "XY", "offsetMillimeters": 0,
            "profile": {"type": "drawing", "contours": [
                {"type": "path", "start": [x, 0], "segments": [{"type": "line", "end": [x + 5, 0]}]}
                for x in [0, 10]]}}}},
        {"id": "sheet", "tool": "aether_cad_feature_add", "arguments": {"feature_json": {
            "type": "surface-extrude", "operation": "new", "profileFeatureId": {"$ref": "source.feature_id"},
            "profileSelections": [{"profileFeatureId": {"$ref": "source.feature_id"}}], "distanceMillimeters": 4}}},
    ]
    authored = run(tmp_path, empty(), steps)
    saved = json.loads(authored["content"])
    assert all(curve.get("id") for curve in saved["features"][0]["profile"]["contours"])
    feature = saved["features"][-1]
    assert feature["separateBodies"] and len(feature["bodyOutputs"]) == 2
    reopened = invoke(tmp_path, "cad.part.evaluate", authored["content"], {})
    assert "error" not in reopened, reopened
    assert sorted(body["id"] for body in reopened["result"]["evaluated_bodies"]) == sorted(feature["bodyOutputs"])
