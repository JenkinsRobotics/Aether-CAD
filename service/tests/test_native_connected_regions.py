"""Isolated packaged-worker acceptance for the new exact region boundary.

This is the geometry-job contract, not yet the saved Part/UI selection contract.
"""

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


def invoke(tmp_path, action, arguments):
    result = subprocess.run(
        [sys.executable, "-I", "-S", str(ROOT / "service/aether_cad_service/runtime/runner.pyz"),
         shutil.which("node"), os.environ.get("AETHER_FREECAD_CMD", "/Applications/FreeCAD.app/Contents/Resources/bin/freecadcmd")],
        input=json.dumps({"service": "/api/cad/" + action, "arguments": arguments}),
        text=True, capture_output=True, cwd=tmp_path, timeout=45, check=False,
        env={"HOME": str(tmp_path), "TMPDIR": str(tmp_path), "QT_QPA_PLATFORM": "offscreen"},
    )
    assert result.returncode == 0, result.stderr
    assert not result.stderr
    value = json.loads(result.stdout)
    assert "result" in value and "error" not in value, value
    return value["result"]


def feature(key, kind, **parameters):
    return {"id": key, "kind": kind, "parameters": parameters}


@pytest.mark.parametrize("height", [12, 18])
def test_packaged_worker_rebuilds_joined_spline_and_preserves_body_identity(tmp_path, height):
    info = invoke(tmp_path, "engine", {})
    assert "sketch-connected-region" in info["capabilities"]
    features = [
        feature("spline", "sketch-wire", start_mm=[0, 0], segments=[{"type": "bezier", "controls": [[20/3, 4*height/3], [40/3, 4*height/3]], "end": [20, 0]}]),
        feature("base", "sketch-wire", start_mm=[0, 0], segments=[{"type": "line", "end": [20, 0]}]),
        feature("region", "sketch-region", profiles=["spline", "base"]),
        feature("pad", "pad", operation="new", body_id="connected", region_mode=True, profiles=["region"], profile_regions=["region"], distance_mm=6),
    ]
    result = invoke(tmp_path, "geometry", {"features": features})
    assert not result["diagnostics"], result["diagnostics"]
    assert result["bodies"][0]["volume_mm3"] == pytest.approx(80 * height, rel=1e-8)
    identity = result["bodies"][0]["id"]
    # Reorder contributors, not their identities; then break a source endpoint.
    features[2]["parameters"]["profiles"].reverse()
    rebuilt = invoke(tmp_path, "geometry", {"features": features})
    assert not rebuilt["diagnostics"], rebuilt["diagnostics"]
    assert rebuilt["bodies"][0]["id"] == identity
    assert rebuilt["bodies"][0]["volume_mm3"] == pytest.approx(80 * height, rel=1e-8)
    features[1]["parameters"]["start_mm"] = [1, 0]
    broken = invoke(tmp_path, "geometry", {"features": features})
    assert broken["diagnostics"] and not broken["bodies"]
    assert broken["diagnostics"][0]["feature_id"] == "region"
