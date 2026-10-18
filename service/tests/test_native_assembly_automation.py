"""Saved assembly archives through the exact isolated native agent worker."""

import base64
import copy
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
from aether_animation.aether_project import edit_project, new_project
from aether_cad_service.project_runtime import decode
from aether_freecad import locate_freecad

ROOT = Path(__file__).resolve().parents[2]
NATIVE = pytest.mark.skipif(
    os.environ.get("AETHER_TEST_FREECAD") != "1",
    reason="Real native qualification required",
)


def source():
    workspace = new_project("Saved assembly")
    part = json.loads(
        (ROOT / "service/tests/fixtures/automation-part.acpart").read_text()
    )
    edit_project(workspace, "add_part", {"name": "Keep this Part", "document": part})
    return workspace.to_bytes()[0]


def invoke(
    tmp_path, command, content, arguments=None, *, native=False, encoding="base64"
):
    process = subprocess.run(
        [
            sys.executable,
            "-I",
            "-S",
            str(ROOT / "service/aether_cad_service/runtime/runner.pyz"),
            shutil.which("node"),
            locate_freecad() if native else "/usr/bin/false",
        ],
        input=json.dumps(
            {
                "command": command,
                "content_encoding": encoding,
                "content": base64.b64encode(content).decode(),
                "arguments": arguments or {},
            }
        ),
        text=True,
        capture_output=True,
        cwd=tmp_path,
        timeout=60,
        check=False,
        env={
            "HOME": str(tmp_path),
            "TMPDIR": str(tmp_path),
            "QT_QPA_PLATFORM": "offscreen",
        },
    )
    assert process.returncode == 0 and not process.stderr, process.stderr
    return json.loads(process.stdout)


def test_inspection_preserves_archive_and_discovers_real_example_without_engine(
    tmp_path,
):
    content = source()
    value = invoke(tmp_path, "cad.assembly.inspect", content, {"section": "parts"})
    assert "error" not in value and "content" not in value, value
    assert value["result"]["counts"] == {
        "parts": 1,
        "instances": 0,
        "mates": 0,
        "assemblies": 1,
    }
    assert value["result"]["items"][0]["name"] == "Keep this Part"
    assert (
        value["result"]["example"]["parts"][0]["part_id"]
        == value["result"]["items"][0]["id"]
    )
    assert value["result"]["capabilities"]["can_edit_nested_assemblies"] is False
    assert decode(base64.b64encode(content).decode()).to_bytes()[0] == content


@NATIVE
def test_preview_compose_mate_and_reopen_keep_unrelated_parts(tmp_path):
    content = source()
    before = decode(base64.b64encode(content).decode()).graph()
    inspected = invoke(tmp_path, "cad.assembly.inspect", content)["result"]
    recipe = inspected["example"]
    recipe["patterns"][0]["count"] = 22
    args = {"assembly_id": inspected["assembly_id"], "recipe_json": json.dumps(recipe)}
    preview = invoke(tmp_path, "cad.assembly.preview", content, args, native=True)
    assert "error" not in preview and "content" not in preview, preview
    assert preview["result"]["instance_count"] == 22
    assert preview["result"]["evaluated_parts"][0]["volume_mm3"] == pytest.approx(1000)
    assert preview["result"]["preview_only"] is True
    applied = invoke(tmp_path, "cad.assembly.compose", content, args, native=True)
    assert "error" not in applied, applied
    archive = base64.b64decode(applied["content"], validate=True)
    after = decode(applied["content"]).graph()
    assert after["part_definitions"] == before["part_definitions"]
    assert len(after["instances"]) == 22
    assert applied["result"]["preview_only"] is False
    first = invoke(tmp_path, "cad.assembly.inspect", archive)["result"]
    second = invoke(
        tmp_path, "cad.assembly.inspect", archive, {"offset": first["next_offset"]}
    )["result"]
    assert len(first["items"]) == 20 and len(second["items"]) == 2
    assert second["next_offset"] is None
    assert second["items"][-1]["position_mm"] == pytest.approx([420, 0, 0])
    # A normal mate recipe reuses the same template and appends actual connectors.
    mate_recipe = copy.deepcopy(recipe)
    mate_recipe.pop("patterns")
    mate_recipe["instances"].append({"key": "moving", "part": "block"})
    mate_recipe["mates"] = [
        {
            "key": "joint",
            "kind": "revolute",
            "a": {"instance": "Block:1"},
            "b": {"instance": "moving"},
        }
    ]
    mated = invoke(
        tmp_path,
        "cad.assembly.compose",
        archive,
        {"recipe_json": json.dumps(mate_recipe)},
        native=True,
    )
    assert "error" not in mated, mated
    reopened = decode(mated["content"])
    assert len(reopened.instances) == 24 and len(reopened.mates) == 1
    assert next(iter(reopened.mates.values()))["type_id"] == "revolute"
    assert decode(base64.b64encode(content).decode()).graph() == before


@NATIVE
def test_geometry_failure_returns_no_candidate(tmp_path):
    content = source()
    recipe = invoke(tmp_path, "cad.assembly.inspect", content)["result"]["example"]
    part = json.loads(
        (ROOT / "service/tests/fixtures/automation-part.acpart").read_text()
    )
    part["features"][1]["distanceMillimeters"] = 0
    recipe["parts"] = [{"key": "block", "name": "Invalid", "document": part}]
    value = invoke(
        tmp_path,
        "cad.assembly.compose",
        content,
        {"recipe_json": json.dumps(recipe)},
        native=True,
    )
    assert "error" in value and "content" not in value


@pytest.mark.parametrize(
    "args",
    [
        {"offset": -1},
        {"offset": True},
        {"section": "unknown"},
        {"assembly_id": "missing"},
    ],
)
def test_bad_inspection_is_refused(tmp_path, args):
    assert "error" in invoke(tmp_path, "cad.assembly.inspect", source(), args)


@pytest.mark.parametrize(
    "command,encoding",
    [("cad.assembly.inspect", "utf8"), ("cad.part.inspect", "base64")],
)
def test_encoding_cannot_be_switched_by_a_request(tmp_path, command, encoding):
    assert "error" in invoke(tmp_path, command, source(), encoding=encoding)


def test_invalid_archive_and_oversized_recipe_are_refused(tmp_path):
    assert "error" in invoke(tmp_path, "cad.assembly.inspect", b"not a zip")
    result = invoke(
        tmp_path,
        "cad.assembly.compose",
        source(),
        {"recipe_json": " " * (2 * 1024 * 1024 + 1)},
    )
    assert "error" in result and "content" not in result


def test_unavailable_engine_is_distinct_from_invalid_geometry(tmp_path):
    content = source()
    recipe = invoke(tmp_path, "cad.assembly.inspect", content)["result"]["example"]
    result = invoke(
        tmp_path, "cad.assembly.compose", content, {"recipe_json": json.dumps(recipe)}
    )
    assert result == {"error": {"kind": "unavailable"}}


def test_empty_project_part_gets_a_buildable_example(tmp_path):
    workspace = new_project("Empty project")
    edit_project(
        workspace,
        "add_part",
        {
            "name": "Blank",
            "document": {"format": "aether-part", "formatVersion": 3, "features": []},
        },
    )
    value = invoke(tmp_path, "cad.assembly.inspect", workspace.to_bytes()[0])
    template = value["result"]["example"]["parts"][0]
    assert "part_id" not in template
    assert len(template["document"]["features"]) == 2
