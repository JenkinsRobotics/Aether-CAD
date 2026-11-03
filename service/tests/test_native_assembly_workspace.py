"""Real frozen-worker assembly metadata contract; no host Animation RPC."""
import base64
import io
import json
import subprocess
import sys
from pathlib import Path
import zipfile

import pytest

from test_native_browser import invoke


def call(tmp_path, method, archive=None, **params):
    request = {"operation": "workspace", "method": method, "params": {"handle": "local", **params}}
    if archive is not None:
        request["data_base64"] = archive["data_base64"]
    response = invoke(tmp_path, "assembly", request)
    return response.get("result", response)


def create(tmp_path):
    state = call(tmp_path, "new_workspace", name="Portable")
    assert state["ok"]
    return state["archive"]


def edit(tmp_path, archive, method, **params):
    result = call(tmp_path, method, archive, expected_revision=archive["revision"], **params)
    assert result["ok"], result
    return result


def test_contacts_crud_save_reopen_with_cad_owned_codec(tmp_path):
    archive = create(tmp_path)
    state = edit(tmp_path, archive, "add_part_definition", part_definition={"name": "P", "source": {"kind": "authored", "label": "P"}})
    assembly = state["result"]["assembly"]
    for name in ("A", "B"):
        state = edit(tmp_path, state["archive"], "add_instance", instance={"name": name,
            "parent_assembly_id": assembly["assembly_id"], "definition_kind": "part",
            "definition_id": assembly["part_definitions"][0]["id"],
            "rest_transform": {"position_m": [0, 0, 0], "rotation_quaternion_xyzw": [0, 0, 0, 1]}})
    ids = [instance["id"] for instance in state["result"]["assembly"]["instances"]]
    state = edit(tmp_path, state["archive"], "add_contact_set", contact_set={"name": "Pair", "instance_ids": ids})
    contact_id = state["result"]["assembly"]["contact_sets"][0]["id"]
    state = edit(tmp_path, state["archive"], "set_contacts_enabled", enabled=True)
    raw = base64.b64decode(state["archive"]["data_base64"])
    saved = tmp_path / "contacts.aethercad"
    saved.write_bytes(raw)
    old_wheel = Path(__file__).resolve().parents[2] / "vendor/python/aether_animation-0.1.0-19-py3-none-any.whl"
    old = subprocess.run([sys.executable, "-I", "-S", "-c",
        "import sys; sys.path.insert(0,sys.argv[1]); from aether_animation.aether_workspace import AetherWorkspace; from pathlib import Path; AetherWorkspace.from_bytes(Path(sys.argv[2]).read_bytes())",
        str(old_wheel), str(saved)], capture_output=True, text=True)
    assert old.returncode != 0 and "unsupported semantic graph version" in old.stderr
    with zipfile.ZipFile(io.BytesIO(raw)) as file:
        assert json.loads(file.read("state/graph.json"))["schema_version"] == 2
    opened = call(tmp_path, "load_workspace", state["archive"])
    projection = call(tmp_path, "describe_assembly", opened["archive"], assembly_id=assembly["assembly_id"])["result"]
    assert projection["capabilities"]["can_edit_contacts"] and projection["contacts_enabled"]
    assert projection["contact_sets"][0]["instance_ids"] == ids
    state = edit(tmp_path, opened["archive"], "update_contact_set", contact_set={"id": contact_id, "suppressed": True})
    assert state["result"]["assembly"]["contact_sets"][0]["suppressed"] is True
    state = edit(tmp_path, state["archive"], "remove_contact_set", contact_set_id=contact_id)
    assert state["result"]["assembly"]["contact_sets"] == []
    assert call(tmp_path, "solve_assembly", state["archive"], assembly_id=assembly["assembly_id"])["ok"]
    assert call(tmp_path, "project_bom", state["archive"], assembly_id=assembly["assembly_id"], mode="flattened")["result"]["rows"][0]["quantity"] == 2


def test_failed_and_stale_edits_do_not_change_archive(tmp_path):
    archive = create(tmp_path)
    result = call(tmp_path, "set_contacts_enabled", archive, expected_revision="stale", enabled=True)
    assert result["error"]["code"] == "revision_conflict"
    result = call(tmp_path, "add_contact_set", archive, expected_revision=archive["revision"], contact_set={"name": "Bad", "instance_ids": ["missing", "missing2"]})
    assert result["ok"] is False
    assert call(tmp_path, "load_workspace", archive)["archive"] == archive


@pytest.mark.parametrize("method", ["__dict__", "load_character", "save_workspace", "release"])
def test_nonportable_operations_are_not_a_host_rpc_escape(tmp_path, method):
    result = call(tmp_path, method)
    assert result["error"]["kind"] == "invalid"


def test_paths_and_oversized_or_malformed_archives_refused(tmp_path):
    assert call(tmp_path, "load_workspace", path="/tmp/file")["error"]["kind"] == "invalid"
    assert call(tmp_path, "load_workspace", {"data_base64": "not a zip"})["error"]["kind"] == "invalid"
    assert call(tmp_path, "load_workspace", {"data_base64": "a" * (4 * 1024 * 1024)})["error"]["kind"] == "too_large"

def test_new_workspace_identity_uses_the_editor_handle(tmp_path):
    first = invoke(tmp_path, "assembly", {"operation": "workspace", "method": "new_workspace", "params": {"handle": "first", "name": "First"}})["result"]
    second = invoke(tmp_path, "assembly", {"operation": "workspace", "method": "new_workspace", "params": {"handle": "second", "name": "Second"}})["result"]
    assert first["result"]["workspace_id"] != second["result"]["workspace_id"]
