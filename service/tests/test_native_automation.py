"""Installed zipapp uses real CAD semantics with no Studio/Python site imports."""

import hashlib
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
from aether_freecad import locate_freecad

ROOT = Path(__file__).resolve().parents[1] / "aether_cad_service"
RUNTIME = ROOT / "runtime"
FIXTURE = Path(__file__).with_name("fixtures") / "automation-part.acpart"


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


def invoke(tmp_path, command, content, arguments, *, freecad=None):
    run = subprocess.run(
        [
            sys.executable,
            "-I",
            "-S",
            str(RUNTIME / "runner.pyz"),
            shutil.which("node"),
            freecad or locate_freecad(),
        ],
        input=json.dumps(
            {"command": command, "content": content, "arguments": arguments}
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
    return json.loads(run.stdout)


def test_bundle_is_self_contained_and_catalog_matches_legacy():
    manifest = json.loads((RUNTIME / "native-worker.json").read_text())
    assert manifest["commands"] == [c.public() for c in COMMANDS]
    assert (
        manifest["sha256"]
        == hashlib.sha256((RUNTIME / "runner.pyz").read_bytes()).hexdigest()
    )
    with zipfile.ZipFile(RUNTIME / "runner.pyz") as archive:
        assert "ATTRIBUTION.md" in archive.namelist()
        assert "aether_freecad/worker.py" in archive.namelist()
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
    os.environ.get("AETHER_TEST_FREECAD") != "1", reason="Required native release gate"
)
@pytest.mark.parametrize("command,kind,arguments", CASES)
def test_all_commands_match_legacy_native_engine(tmp_path, command, kind, arguments):
    content = source(kind)
    actual = invoke(tmp_path, "cad." + command, content, arguments)
    assert "error" not in actual, actual
    service = CADService()
    try:
        expected = execute(service, "cad." + command, content.encode(), arguments)
    finally:
        for engine in service.engines.values():
            engine.close()
    actual["result"].pop("build_seconds", None)
    expected["result"].pop("build_seconds", None)
    if "content" in expected:
        expected["content"] = expected["content"].decode()
    assert actual == expected


@pytest.mark.skipif(
    os.environ.get("AETHER_TEST_FREECAD") != "1", reason="Required native release gate"
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


def test_unavailable_native_engine_is_not_reported_as_invalid_geometry(tmp_path):
    # Ordinary Python cannot import FreeCAD. This deterministically exercises
    # failure of the operator-supplied native dependency without a fake result.
    result = invoke(
        tmp_path, "cad.part.evaluate", source("plain"), {}, freecad=sys.executable
    )
    assert result == {"error": {"kind": "unavailable"}}
