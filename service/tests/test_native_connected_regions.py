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
         shutil.which("node")],
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


# The joined-spline rebuild is covered by test_native_connected_profile through saved documents;
# the host geometry service these helpers addressed is retired (the editor builds in-process).
