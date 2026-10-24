"""Test the CAD service against the codec version packaged in its native worker.

A Studio development environment can expose a newer editable Animation checkout.
That is not the workspace codec contract this CAD build ships.
"""

import hashlib
import json
import os
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
lock = json.loads((root / "vendor/python/workspace-codec.json").read_text())
wheel = root / "vendor/python" / lock["wheel"]
if hashlib.sha256(wheel.read_bytes()).hexdigest() != lock["sha256"]:
    raise ValueError("Workspace codec archive fingerprint differs")
sys.path[:0] = [str(root / "service"), str(wheel)]
# Historical name of the gate; current geometry is OCCT in the Node runner.
os.environ["AETHER_TEST_FREECAD"] = "1"

import pytest

raise SystemExit(pytest.main([str(root / "service/tests"), *sys.argv[1:]]))
