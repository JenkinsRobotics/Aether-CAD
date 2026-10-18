"""Saved files → isolated packaged JS translator → native Block/ellipse → solid."""

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


def invoke(tmp_path, document):
    run = subprocess.run(
        [
            sys.executable,
            "-I",
            "-S",
            str(ROOT / "service/aether_cad_service/runtime/runner.pyz"),
            shutil.which("node"),
            os.environ.get(
                "AETHER_FREECAD_CMD",
                "/Applications/FreeCAD.app/Contents/Resources/bin/freecadcmd",
            ),
        ],
        input=json.dumps(
            {
                "command": "cad.part.evaluate",
                "content": json.dumps(document),
                "arguments": {},
            }
        ),
        text=True,
        capture_output=True,
        cwd=tmp_path,
        check=False,
        env={
            "HOME": str(tmp_path),
            "TMPDIR": str(tmp_path),
            "QT_QPA_PLATFORM": "offscreen",
        },
        timeout=45,
    )
    assert run.returncode == 0, run.stderr
    assert not run.stderr
    return json.loads(run.stdout)


@pytest.mark.parametrize(
    "shape,reverse", [("circle", False), ("ellipse", False), ("ellipse", True)]
)
def test_packaged_fixed_sketch_reopens_and_builds_exact_solid(tmp_path, shape, reverse):
    doc = json.loads(
        (ROOT / "service/tests/fixtures/automation-part.acpart").read_text()
    )
    doc["formatVersion"] = 14
    if shape == "circle":
        contour = {"type": "circle", "center": [2, 3], "radius": 8}
        ref = {"contour": 0, "kind": "circle"}
        area = math.pi * 64
    else:
        angle = 0.4
        center = [3, -2]
        rx, ry = 5, 12
        start = [center[0] + rx * math.cos(angle), center[1] + rx * math.sin(angle)]
        other = [2 * center[0] - start[0], 2 * center[1] - start[1]]
        contour = {
            "type": "path",
            "start": start,
            "segments": [
                {
                    "type": "ellipse",
                    "radiusX": rx,
                    "radiusY": ry,
                    "rotationDegrees": angle * 180 / math.pi,
                    "largeArc": False,
                    "sweep": not reverse,
                    "end": end,
                }
                for end in [other, start]
            ],
        }
        ref = {"contour": 0, "kind": "contour"}
        area = math.pi * rx * ry
    drawing = {
        "type": "drawing",
        "contours": [contour],
        "constraints": [
            {
                "id": "fixed",
                "kind": "fix",
                "a": ref,
                "fixedGeometry": copy.deepcopy(contour),
            }
        ],
    }
    doc["features"][0]["profile"] = drawing
    content = json.dumps(doc)
    path = tmp_path / "fixed.acpart"
    path.write_text(content)
    first = invoke(tmp_path, json.loads(path.read_text()))
    assert "error" not in first, first
    assert first["result"]["evaluated_bodies"][0]["volume_mm3"] == pytest.approx(
        area * 5, rel=1e-8
    )
    # Re-evaluation after an independent disk reopen preserves body identity and
    # exact volume, with no reliance on a browser's live state.
    second = invoke(tmp_path, json.loads(path.read_text()))
    assert second["result"]["evaluated_bodies"] == first["result"]["evaluated_bodies"]
    assert path.read_text() == content
