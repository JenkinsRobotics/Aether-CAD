"""Part18 clamped cubic → packaged reader/solver → exact native sweep."""

import json
import math
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


def spline_part(height):
    # y = height*x*(20-x)/100. Two exact degree-elevated quadratic spans.
    # The independently specified end handles differ from natural spline ends.
    profile = {
        "type": "drawing",
        "contours": [{
            "type": "path", "start": [0, 0],
            "segments": [
                {"type": "bezier", "controls": [[10/3, 2*height/3], [20/3, height]], "end": [10, height]},
                {"type": "bezier", "controls": [[40/3, height], [50/3, 2*height/3]], "end": [20, 0]},
            ],
        }],
        "constraints": [{"id": "shape", "kind": "spline-shape", "a": {"kind": "contour", "contour": 0}, "splineFreeEnds": ["start", "end"]}],
    }
    slope = height / 5
    normal = [1/math.sqrt(1+slope*slope), slope/math.sqrt(1+slope*slope), 0]
    return {
        "format": "aether-part", "formatVersion": 18, "documentId": "spline-tangents", "name": "Clamped spline pipe", "units": "millimeter",
        "features": [
            {"id": "path", "type": "profile", "name": "Spline path", "plane": "XY", "offsetMillimeters": 0, "suppressed": False, "profile": profile},
            {"id": "section", "type": "profile", "name": "Pipe section", "plane": "XY", "offsetMillimeters": 0, "suppressed": False,
             "frame": {"originMillimeters": [0, 0, 0], "normal": normal, "xDirection": [0, 0, 1]},
             "profile": {"type": "circle", "centerMillimeters": [0, 0], "radiusMillimeters": 0.5}},
            {"id": "pipe", "type": "sweep", "name": "Sweep", "profileFeatureId": "section", "pathFeatureId": "path", "operation": "new", "suppressed": False},
        ],
    }


def invoke(tmp_path, document):
    run = subprocess.run(
        [sys.executable, "-I", "-S", str(ROOT / "service/aether_cad_service/runtime/runner.pyz"), shutil.which("node"),
         os.environ.get("AETHER_FREECAD_CMD", "/Applications/FreeCAD.app/Contents/Resources/bin/freecadcmd")],
        input=json.dumps({"command": "cad.part.evaluate", "content": json.dumps(document), "arguments": {}}),
        text=True, capture_output=True, cwd=tmp_path, timeout=60, check=False,
        env={"HOME": str(tmp_path), "TMPDIR": str(tmp_path), "QT_QPA_PLATFORM": "offscreen"},
    )
    assert run.returncode == 0, run.stderr
    assert not run.stderr
    result = json.loads(run.stdout)
    assert "error" not in result, result
    return result


@pytest.mark.parametrize("height", [10, 15])
def test_native_end_tangent_spline_retains_exact_curve_after_disk_reopen(tmp_path, height):
    document = spline_part(height)
    path = tmp_path / "clamped-spline.acpart"
    content = json.dumps(document)
    path.write_text(content)
    result = invoke(tmp_path, json.loads(path.read_text()))
    slope = height/5
    # Exact integral of sqrt(1 + (height/5-height*x/50)^2) from x=0 to20.
    length = 10*(math.sqrt(1+slope*slope)+math.asinh(slope)/slope)
    assert result["result"]["evaluated_bodies"][0]["volume_mm3"] == pytest.approx(math.pi*0.25*length, rel=2e-5)
    reopened = invoke(tmp_path, json.loads(path.read_text()))
    assert reopened["result"]["evaluated_bodies"] == result["result"]["evaluated_bodies"]
    assert path.read_text() == content
