"""Saved Part19 groups use original exact sketch curves through the real zipapp."""

import copy
import json
import math
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


def joined_part(height=10):
    drawing = {
        "type": "drawing",
        "contours": [
            {"id": "curve", "type": "path", "start": [0, 0], "segments": [
                {"type": "bezier", "controls": [[10/3, 2*height/3], [20/3, height]], "end": [10, height]},
                {"type": "bezier", "controls": [[40/3, height], [50/3, 2*height/3]], "end": [20, 0]},
            ]},
            {"id": "base", "type": "path", "start": [20, 0], "segments": [{"type": "line", "end": [0, 0]}]},
        ],
        "constraints": [{"id": "shape", "kind": "spline-shape", "a": {"kind": "contour", "contour": 0}, "splineFreeEnds": ["start", "end"]}],
    }
    selection = {"profileFeatureId": "s", "profileRegion": {"contourIds": ["curve", "base"]}}
    return {
        "format": "aether-part", "formatVersion": 19, "documentId": "joined-region", "name": "Joined spline profile", "units": "millimeter",
        "features": [
            {"id": "s", "type": "profile", "name": "Sketch", "plane": "XY", "offsetMillimeters": 0, "suppressed": False, "profile": drawing},
            {"id": "e", "type": "extrude", "name": "Extrude", "suppressed": False, **selection,
             "profileSelections": [copy.deepcopy(selection)], "regionMode": "faces", "separateBodies": True,
             "operation": "new", "distanceMillimeters": 6},
        ],
    }


def invoke(tmp_path, document, command="cad.part.evaluate", arguments=None):
    run = subprocess.run(
        [sys.executable, "-I", "-S", str(ROOT / "service/aether_cad_service/runtime/runner.pyz"), shutil.which("node"),
         os.environ.get("AETHER_FREECAD_CMD", "/Applications/FreeCAD.app/Contents/Resources/bin/freecadcmd")],
        input=json.dumps({"command": command, "content": json.dumps(document), "arguments": arguments or {}}),
        text=True, capture_output=True, cwd=tmp_path, timeout=60, check=False,
        env={"HOME": str(tmp_path), "TMPDIR": str(tmp_path), "QT_QPA_PLATFORM": "offscreen"},
    )
    assert run.returncode == 0, run.stderr
    assert not run.stderr
    return json.loads(run.stdout)


def bodies(response):
    assert "error" not in response, response
    return response["result"]["evaluated_bodies"]


@pytest.mark.parametrize("height", [10, 15])
def test_saved_joined_spline_reopens_reorders_and_rebuilds_exact_volume(tmp_path, height):
    document = joined_part(height)
    path = tmp_path / "joined.acpart"
    path.write_text(json.dumps(document))
    first = bodies(invoke(tmp_path, json.loads(path.read_text())))
    # Integral of h*x*(20-x)/100 from0 to20, times6mm depth.
    assert len(first) == 1
    assert first[0]["volume_mm3"] == pytest.approx(80*height, rel=1e-8)
    assert bodies(invoke(tmp_path, json.loads(path.read_text()))) == first
    reordered = json.loads(path.read_text())
    drawing = reordered["features"][0]["profile"]
    drawing["contours"].reverse()
    drawing["constraints"][0]["a"]["contour"] = 1
    rebuilt = bodies(invoke(tmp_path, reordered))
    assert rebuilt[0]["id"] == first[0]["id"]
    assert rebuilt[0]["volume_mm3"] == pytest.approx(first[0]["volume_mm3"], rel=1e-8)
    assert json.loads(path.read_text()) == document


def test_depth_edit_preserves_group_and_cancelled_failure_has_no_candidate_bytes(tmp_path):
    source = joined_part()
    edited = invoke(tmp_path, source, "cad.extrude.setdepth", {"feature_id": "e", "depth_mm": 9})
    candidate = json.loads(edited["content"])
    assert candidate["formatVersion"] == 21
    assert candidate["features"][0] == source["features"][0]
    assert candidate["features"][1]["profileRegion"] == source["features"][1]["profileRegion"]
    assert candidate["features"][1]["profileSelections"] == source["features"][1]["profileSelections"]
    assert bodies(invoke(tmp_path, candidate))[0]["volume_mm3"] == pytest.approx(1200, rel=1e-8)
    broken = copy.deepcopy(source)
    broken["features"][0]["profile"]["contours"][1]["segments"][0]["end"] = [-1, 0]
    failed = invoke(tmp_path, broken, "cad.extrude.setdepth", {"feature_id": "e", "depth_mm": 9})
    # The process boundary deliberately redacts document/native error text;
    # the feature translator separately verifies the actionable repair message.
    assert failed["error"] == {"kind": "invalid"}
    assert "content" not in failed
    assert source["features"][1]["distanceMillimeters"] == 6


@pytest.mark.parametrize("kind", ["revolve", "sweep", "loft"])
def test_all_solid_profile_consumers_rebuild_saved_groups(tmp_path, kind):
    part = joined_part()
    corners = [[5, 2], [25, 2], [25, 12], [5, 12]]
    ids = [f"edge-{i}" for i in range(4)]
    part["features"][0]["profile"] = {"type": "drawing", "contours": [
        {"id": ids[i], "type": "path", "start": start, "segments": [{"type": "line", "end": corners[(i+1) % 4]}]}
        for i, start in enumerate(corners)
    ]}
    selection = {"profileFeatureId": "s", "profileRegion": {"contourIds": ids}}
    solid = {"id": "solid", "type": kind, "name": kind, "suppressed": False, "operation": "new", **selection}
    part["features"].pop()
    expected = 4000
    if kind == "revolve":
        solid.update(axis="X", angleDegrees=90)
        expected = 700*math.pi
    elif kind == "sweep":
        part["features"].append({"id": "path", "type": "profile", "name": "Spine", "plane": "XZ", "offsetMillimeters": 0, "suppressed": False,
                                 "profile": {"type": "drawing", "contours": [{"id": "spine", "type": "path", "start": [0, 0], "segments": [{"type": "line", "end": [0, 20]}]}]}})
        solid.update(pathFeatureId="path", pathContourId="spine")
    else:
        top = copy.deepcopy(part["features"][0])
        top.update(id="top", offsetMillimeters=20)
        part["features"].append(top)
        solid.pop("profileFeatureId")
        solid.pop("profileRegion")
        solid.update(ruled=False, sections=[selection, {**selection, "profileFeatureId": "top"}])
    part["features"].append(solid)
    path = tmp_path / f"{kind}.acpart"
    path.write_text(json.dumps(part))
    result = bodies(invoke(tmp_path, json.loads(path.read_text())))
    assert len(result) == 1
    assert result[0]["volume_mm3"] == pytest.approx(expected, rel=1e-8)
