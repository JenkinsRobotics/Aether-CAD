"""Installed zipapp uses real CAD semantics with no Studio/Python site imports."""

import hashlib
import base64
import json
import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

import pytest
from aether_cad_service.automation import COMMANDS, execute
from aether_cad_service.service import CADService

ROOT = Path(__file__).resolve().parents[1] / "aether_cad_service"
RUNTIME = ROOT / "runtime"
from documents import part_archive, part_of, part_text, request_content

FIXTURE = Path(__file__).with_name("fixtures") / "automation-part.part.json"


def source(kind):
    part = json.loads(FIXTURE.read_text())
    if kind == "revolve":
        part["features"][0]["profile"]["pointsMillimeters"] = [
            [5, 2],
            [25, 2],
            [25, 12],
            [5, 12],
        ]
        part["features"][1] = {
            "id": "rev",
            "type": "revolve",
            "name": "Revolve",
            "profileFeatureId": "profile",
            "axis": "X",
            "angleDegrees": 90,
            "operation": "new",
            "bodyId": "ring",
            "suppressed": False,
        }
    if kind == "offset":
        part["features"][0]["offsetMillimeters"] = 10
        part["features"][1].update(bodyId="limit", distanceMillimeters=3)
        part["features"].extend(
            [
                {
                    "id": "circle",
                    "name": "Circle",
                    "type": "profile",
                    "plane": "XY",
                    "offsetMillimeters": 0,
                    "suppressed": False,
                    "profile": {
                        "type": "circle",
                        "radiusMillimeters": 2,
                        "centerMillimeters": [5, 10],
                    },
                },
                {
                    "id": "post",
                    "name": "Post",
                    "type": "extrude",
                    "profileFeatureId": "circle",
                    "distanceMillimeters": 1,
                    "operation": "new",
                    "bodyId": "post",
                    "endType": "up-to-next",
                    "suppressed": False,
                },
            ]
        )
    if kind == "move":
        part["features"].append(
            {
                "id": "other",
                "name": "Other",
                "type": "profile",
                "plane": "XY",
                "offsetMillimeters": 0,
                "suppressed": False,
                "profile": {
                    "type": "circle",
                    "radiusMillimeters": 1,
                    "centerMillimeters": [0, 0],
                },
            }
        )
    return json.dumps(part)


def invoke(tmp_path, command, content, arguments):
    run = subprocess.run(
        [
            sys.executable,
            "-I",
            "-S",
            str(RUNTIME / "runner.pyz"),
            shutil.which("node"),
        ],
        input=json.dumps(
            {"command": command, "content": request_content(content), "content_encoding": "base64", "arguments": arguments}
        ),
        text=True,
        capture_output=True,
        check=False,
        cwd=tmp_path,
        env={
            "HOME": str(tmp_path),
            "TMPDIR": str(tmp_path),
            "QT_QPA_PLATFORM": "offscreen",
        },
        timeout=60,
    )
    assert run.returncode == 0, run.stderr
    assert not run.stderr
    return part_text(json.loads(run.stdout))


def test_bundle_is_self_contained_and_catalog_matches_legacy():
    manifest = json.loads((RUNTIME / "native-worker.json").read_text())
    assert manifest["commands"] == [c.public() for c in COMMANDS]
    assert (
        manifest["sha256"]
        == hashlib.sha256((RUNTIME / "runner.pyz").read_bytes()).hexdigest()
    )
    with zipfile.ZipFile(RUNTIME / "runner.pyz") as archive:
        assert "ATTRIBUTION.md" in archive.namelist()
        assert "aether_cad_service/runtime/replicad_single.wasm" in archive.namelist()
        assert "aether_cad_service/runtime/opencascade.wasm" in archive.namelist()
        assert not any(name.startswith("aether_freecad/") for name in archive.namelist())
        for name in ["__main__.py", "aether_cad_service/automation_runtime.py"]:
            assert b"core.host" not in archive.read(name)


CASES = [
    ("part.inspect", "plain", {}),
    ("part.evaluate", "plain", {}),
    ("part.topology", "plain", {"body_id": "agent-part:body-1"}),
    ("extrude.preview", "plain", {"feature_id": "pad", "depth_mm": 8}),
    ("extrude.setdepth", "plain", {"feature_id": "pad", "depth_mm": 8}),
    ("extrude.previewoffset", "offset", {"feature_id": "post", "end_offset_mm": 2}),
    ("extrude.setoffset", "offset", {"feature_id": "post", "end_offset_mm": -2}),
    (
        "revolve.preview",
        "revolve",
        {
            "feature_id": "rev",
            "angle_deg": 90,
            "second_angle_deg": 30,
            "symmetric": False,
            "reversed": True,
        },
    ),
    (
        "revolve.setextent",
        "revolve",
        {
            "feature_id": "rev",
            "angle_deg": 90,
            "second_angle_deg": 30,
            "symmetric": False,
            "reversed": True,
        },
    ),
    ("feature.suppress", "plain", {"feature_id": "pad", "action": "suppress"}),
    ("feature.move", "move", {"feature_id": "other", "direction": -1}),
]


@pytest.mark.skipif(
    os.environ.get("AETHER_TEST_NATIVE") != "1", reason="Required native release gate"
)
@pytest.mark.parametrize("command,kind,arguments", CASES)
def test_all_commands_match_legacy_native_engine(tmp_path, command, kind, arguments):
    content = source(kind)
    actual = invoke(tmp_path, "cad." + command, content, arguments)
    assert "error" not in actual, actual
    service = CADService()
    try:
        expected = execute(service, "cad." + command, part_archive(json.loads(content)), arguments)
    finally:
        for engine in service.engines.values():
            engine.close()
    actual["result"].pop("build_seconds", None)
    expected["result"].pop("build_seconds", None)
    if "content" in expected:
        expected["content"] = json.dumps(part_of(expected["content"]))
    assert actual == expected


@pytest.mark.skipif(
    os.environ.get("AETHER_TEST_NATIVE") != "1", reason="Required native release gate"
)
def test_noop_and_invalid_geometry_preserve_document(tmp_path):
    content = source("plain")
    noop = invoke(
        tmp_path, "cad.extrude.setdepth", content, {"feature_id": "pad", "depth_mm": 5}
    )
    assert noop["unchanged"] is True and "content" not in noop
    invalid = json.loads(content)
    invalid["features"][1].update(operation="intersect", targetBodyId="missing")
    rejected = invoke(
        tmp_path,
        "cad.extrude.setdepth",
        json.dumps(invalid),
        {"feature_id": "pad", "depth_mm": 8},
    )
    assert list(rejected) == ["error"]
    assert str(tmp_path) not in json.dumps(rejected)
    recovered = invoke(tmp_path, "cad.part.evaluate", content, {})
    assert recovered["result"]["evaluated_bodies"][0]["volume_mm3"] == pytest.approx(
        1000
    )


# Geometry builds in the Node runner with the Aether engine: no separately installed native
# engine exists whose absence could be mistaken for invalid geometry.

@pytest.mark.parametrize("name", ["transform-scale-xyz", "extrude-up-to-cone"])
def test_installed_runner_loads_full_kernel_on_demand(tmp_path, name):
    oracle = ROOT.parents[1] / "aether-engine/src/kernel/oracle"
    fixtures = json.loads((oracle / "fixtures.json").read_text())
    references = json.loads((oracle / "freecad-references.json").read_text())[name]
    document = next(fixture for fixture in fixtures if fixture["name"] == name)
    answer = invoke(tmp_path, "cad.part.evaluate", json.dumps(document), {})
    assert "error" not in answer, answer
    bodies = answer["result"]["evaluated_bodies"]
    assert len(bodies) == len(references)
    for expected in references:
        body = next(body for body in bodies if body["id"] == expected["id"])
        assert body["volume_mm3"] == pytest.approx(expected["volume_mm3"], rel=1e-7)
