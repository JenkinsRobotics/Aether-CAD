"""The isolated settings codec must retain existing CAD document semantics."""
import base64
import hashlib
import io
import json
import tarfile
from pathlib import Path

import pytest
from aether_cad_service.document import UNITS, CADDocument
from aether_cad_service.part_format import PART_DOCUMENT_VERSION
from test_native_browser import invoke
from test_native_projects import created


@pytest.mark.parametrize("operation,data", [
    ("details", {"description": "Drawing notes", "revisionManaged": False}),
    ("units", {"units": {k: {"unit": v["default"], "decimals": 5} for k, v in UNITS.items()}}),
    ("rename", {"name": "Renamed"}),
    ("copy", {"name": "Copy"}),
    ("properties", {"item_id": "workspace", "name": "Design", "description": "Notes", "category": "Workspace", "quantities": {}}),
    ("delete_item", {}), ("restore_item", {}),
])
def test_isolated_settings_match_existing_codec(tmp_path, operation, data):
    original = created(tmp_path)
    data = dict(data)
    canonical = CADDocument(base64.b64decode(original["data_base64"]))
    if operation in ("delete_item", "restore_item"):
        data["item_id"] = original["project"]["parts"][0]["id"]
        if operation == "restore_item":
            canonical.edit("delete_item", data)
            original["data_base64"] = base64.b64encode(canonical.bytes()).decode()
    canonical.edit("rename" if operation == "copy" else operation, data)
    result = invoke(tmp_path, "settings-edit", {**original, **data, "operation": operation})["result"]
    assert base64.b64decode(result["data_base64"]) == canonical.bytes()
    for key, value in canonical.projection().items():
        assert result[key] == value
    read = invoke(tmp_path, "settings-read", result)["result"]
    assert "data_base64" not in read
    assert read["settings"] == result["settings"]


def test_standalone_parts_and_original_example_are_read_without_changes(tmp_path):
    root = Path(__file__).resolve().parents[2]
    original = (root / "examples/Train-Cart-Wheel.acad").read_bytes()
    part = json.dumps({"format": "aether-part", "formatVersion": 3, "documentId": "fixture", "name": "Wheel", "features": []}).encode()
    for raw in (original, part):
        read = invoke(tmp_path, "settings-read", {"data_base64": base64.b64encode(raw).decode()})["result"]
        for key, value in CADDocument(raw).projection().items():
            assert read[key] == value
    assert (root / "examples/Train-Cart-Wheel.acad").read_bytes() == original


def test_units_resource_is_exactly_the_pinned_shared_asset():
    root = Path(__file__).resolve().parents[2]
    lock = json.loads((root / "service/aether_cad_service/compatibility.json").read_text())["shared_packages"]["@aether/assets"]
    raw = (root / lock["archive"]).read_bytes()
    assert hashlib.sha256(raw).hexdigest() == lock["sha256"]
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:gz") as archive:
        assert (root / "service/aether_cad_service/data/units.json").read_bytes() == archive.extractfile("package/cad/units.json").read()


def test_invalid_units_and_documents_do_not_produce_output(tmp_path):
    original = created(tmp_path)
    for args in ({**original, "operation": "units", "units": {}}, {"data_base64": "bad", "operation": "rename", "name": "X"}, {**original, "operation": "unknown"}):
        assert invoke(tmp_path, "settings-edit", args) == {"error": {"kind": "invalid"}}


def test_move_preserves_canonical_bytes_and_update_upgrades_part(tmp_path):
    original = created(tmp_path)
    canonical = CADDocument(base64.b64decode(original["data_base64"]))
    moved = invoke(tmp_path, "settings-edit", {**original, "operation": "move"})["result"]
    assert base64.b64decode(moved["data_base64"]) == canonical.bytes()
    old = {"format": "aether-part", "formatVersion": 2, "documentId": "fixture", "name": "Wheel", "features": []}
    new = {**old, "formatVersion": PART_DOCUMENT_VERSION}
    request = {"data_base64": base64.b64encode(json.dumps(old).encode()).decode(), "operation": "update", "parts": [], "upgraded_documents": {"part": new}}
    updated = invoke(tmp_path, "settings-edit", request)["result"]
    assert json.loads(base64.b64decode(updated["data_base64"]))["formatVersion"] == PART_DOCUMENT_VERSION
    assert not updated["upgradeNeeded"]
    request["upgraded_documents"] = {}
    assert invoke(tmp_path, "settings-edit", request) == {"error": {"kind": "invalid"}}


def test_link_refresh_matches_canonical_and_rejects_wrong_sources(tmp_path):
    from aether_animation.aether_project import edit_project

    original = created(tmp_path)
    canonical = CADDocument(base64.b64decode(original["data_base64"]))
    old = {"format": "aether-part", "formatVersion": 3, "documentId": "fixture", "name": "Wheel", "features": []}
    edit_project(canonical.workspace, "link_part", {"document": old, "source_label": "Source", "source_ref": "library:source@1"})
    original["data_base64"] = base64.b64encode(canonical.bytes()).decode()
    key = list(canonical.workspace.part_definitions)[-1]
    new = {**old, "name": "Revised wheel"}
    source = {"data_base64": base64.b64encode(json.dumps(new).encode()).decode(), "source_label": "New", "source_ref": "library:source@2"}
    request = {**original, "operation": "update", "parts": [key], "resolved_sources": {key: source}}
    expected = CADDocument(base64.b64decode(original["data_base64"]))
    edit_project(expected.workspace, "update_link", {"part_id": key, "document": new, "source_label": "New", "source_ref": "library:source@2"})
    actual = invoke(tmp_path, "settings-edit", request)["result"]
    assert base64.b64decode(actual["data_base64"]) == expected.bytes()
    for invalid in ({**source, "source_ref": "library:other@2"}, {**source, "data_base64": original["data_base64"]}):
        assert invoke(tmp_path, "settings-edit", {**request, "resolved_sources": {key: invalid}}) == {"error": {"kind": "invalid"}}
    assert invoke(tmp_path, "settings-edit", {**request, "parts": [key, key]}) == {"error": {"kind": "invalid"}}
