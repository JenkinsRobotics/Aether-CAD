"""Drawing metadata shares the CAD adapter without touching its source Part."""
import base64
import copy
import json

from test_native_browser import invoke


def drawing():
    return {"format": "aether-drawing", "formatVersion": 1, "documentId": "drawing", "name": "Drawing", "activeSheetId": "sheet",
            "source": {"format": "aether-part", "formatVersion": 21, "documentId": "part", "name": "Source", "features": []},
            "sourceReference": {"fileId": "library-source", "branch": "experiment"},
            "sheets": [{"id": "sheet", "name": "Sheet", "widthMm": 297, "heightMm": 210, "projection": "third_angle", "views": [], "annotations": []}]}


def payload(doc):
    return {"data_base64": base64.b64encode(json.dumps(doc).encode()).decode()}


def test_drawing_settings_rename_copy_and_properties_preserve_source_and_sheets(tmp_path):
    original = drawing()
    metadata = invoke(tmp_path, "settings-read", payload(original))["result"]
    assert metadata["items"][1] == {"id": "drawing", "kind": "drawing", "name": "Drawing", "description": "", "category": "Drawing"}
    assert metadata["upgradeDocuments"] == {} and not metadata["upgradeNeeded"]
    for operation, data in [("rename", {"name": "New drawing"}), ("copy", {"name": "Drawing copy"}),
                            ("properties", {"item_id": "drawing", "name": "Detailed drawing", "description": "Notes", "category": "Manufacturing", "quantities": {}})]:
        result = invoke(tmp_path, "settings-edit", {**payload(original), "operation": operation, **data})["result"]
        document = json.loads(base64.b64decode(result["data_base64"]))
        assert document["name"] == data["name"]
        for key in ("source", "sourceReference", "sheets", "activeSheetId", "documentId"):
            assert document[key] == original[key]
        assert invoke(tmp_path, "settings-read", result)["result"]["items"][1]["kind"] == "drawing"


def test_drawing_metadata_refuses_unsupported_versions_and_cannot_edit_source_body_properties(tmp_path):
    original = drawing()
    for key, value in [("formatVersion", 6), ("formatVersion", True), ("source", {}), ("sheets", []), ("documentId", "")]:
        bad = copy.deepcopy(original)
        bad[key] = value
        assert invoke(tmp_path, "settings-read", payload(bad)) == {"error": {"kind": "invalid"}}
    assert invoke(tmp_path, "settings-edit", {**payload(original), "operation": "properties", "item_id": "part", "name": "Changed source"}) == {"error": {"kind": "invalid"}}


def test_section_drawing_metadata_retains_new_reader_version_and_cut_intent(tmp_path):
    original = drawing()
    original["formatVersion"] = 2
    original["sheets"][0]["views"] = [{"id": "section", "name": "A-A", "orientation": "top", "originMm": [100, 100], "scale": 1, "hiddenLines": False,
                                       "section": {"offsetMm": 5, "hatchSpacingMm": 2}}]
    result = invoke(tmp_path, "settings-edit", {**payload(original), "operation": "rename", "name": "Section drawing"})["result"]
    document = json.loads(base64.b64decode(result["data_base64"]))
    assert document["formatVersion"] == 2
    assert document["sheets"] == original["sheets"]
    assert document["source"] == original["source"]


def test_new_drawing_metadata_versions_preserve_annotations_and_format(tmp_path):
    # Metadata edits must preserve opaque drawing intent. Canonical TS authoring
    # validates/rebuilds the geometry; settings must not strip unfamiliar fields.
    for version in (3, 4, 5):
        original = drawing()
        original["formatVersion"] = version
        original["sheets"][0]["annotations"] = [{
            "id": "note", "kind": "note", "text": "Manufacturing", "positionMm": [20, 20]
        }]
        if version == 5:
            original["sheets"][0]["views"] = [{"id": "top", "name": "Top", "orientation": "top", "originMm": [80, 60], "scale": 0.5, "hiddenLines": False}]
            original["sheets"][0]["annotations"].append({
                "id": "distance", "kind": "point-distance", "viewId": "top",
                "pointsMm": [[70, 55], [90, 65]], "positionMm": [95, 80], "decimals": 2
            })
        result = invoke(tmp_path, "settings-edit", {**payload(original), "operation": "rename", "name": "Updated"})["result"]
        reopened = json.loads(base64.b64decode(result["data_base64"]))
        assert reopened["formatVersion"] == version
        assert reopened["sheets"] == original["sheets"]
        assert reopened["source"] == original["source"]
        assert invoke(tmp_path, "settings-read", result)["result"]["items"][1]["name"] == "Updated"
