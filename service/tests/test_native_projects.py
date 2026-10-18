"""Exercise the installed container codec without Studio, NumPy or site packages."""
import base64
import io
import json
import zipfile

import pytest
from aether_animation.aether_project import edit_project, project_projection
from aether_animation.aether_workspace import AetherWorkspace
from test_native_browser import invoke


def created(tmp_path, packaging="project"):
    return invoke(tmp_path, "project-create", {"name": "Fixture", "operation_id": "fixed-request", "packaging": packaging})["result"]


@pytest.mark.parametrize("packaging,count", [("project", 1), ("assembly", 0)])
def test_create_is_portable_deterministic_and_legacy_readable(tmp_path, packaging, count):
    a = created(tmp_path, packaging)
    assert a == created(tmp_path, packaging)
    workspace = AetherWorkspace.from_bytes(base64.b64decode(a["data_base64"]))
    assert project_projection(workspace) == a["project"]
    assert len(a["project"]["parts"]) == count
    assert invoke(tmp_path, "project-read", a)["result"]["project"] == a["project"]


@pytest.mark.parametrize("operation", ["add_part", "add_assembly", "save_part", "insert_part", "link_part", "update_link"])
def test_edits_match_canonical_project_operations(tmp_path, operation):
    a = created(tmp_path)
    workspace = AetherWorkspace.from_bytes(base64.b64decode(a["data_base64"]))
    doc = {"format": "aether-part", "formatVersion": 3, "name": "Linked", "features": []}
    args = {"name": "Added", "part_id": a["project"]["parts"][0]["id"], "assembly_id": a["project"]["assemblies"][0]["id"], "document": doc, "source_ref": "library:source@1", "source_label": "Source.acpart"}
    if operation == "update_link":
        edit_project(workspace, "link_part", args)
        args["part_id"] = list(workspace.part_definitions)[-1]
        a["data_base64"] = base64.b64encode(workspace.to_bytes()[0]).decode()
    edit_project(workspace, operation, args)
    result = invoke(tmp_path, "project-edit", {**a, **args, "operation": operation})["result"]
    assert result["project"] == project_projection(workspace)
    assert base64.b64decode(result["data_base64"]) == workspace.to_bytes()[0]


def test_corrupt_and_expanding_archives_are_rejected(tmp_path):
    a = created(tmp_path)
    corrupt = io.BytesIO()
    with zipfile.ZipFile(corrupt, "w", compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr("manifest.json", "x" * (6 * 1024 * 1024 + 1))
    for data in ["not-base64", base64.b64encode(b"not a zip").decode(), base64.b64encode(corrupt.getvalue()).decode()]:
        assert invoke(tmp_path, "project-read", {"data_base64": data}) == {"error": {"kind": "invalid"}}
    raw = io.BytesIO(base64.b64decode(a["data_base64"]))
    tampered = io.BytesIO()
    with zipfile.ZipFile(raw) as old, zipfile.ZipFile(tampered, "w") as new:
        for name in old.namelist():
            data = old.read(name)
            if name == "state/graph.json":
                graph = json.loads(data)
                graph["name"] = "Tampered"
                data = json.dumps(graph).encode()
            new.writestr(name, data)
    assert invoke(tmp_path, "project-read", {"data_base64": base64.b64encode(tampered.getvalue()).decode()}) == {"error": {"kind": "invalid"}}
