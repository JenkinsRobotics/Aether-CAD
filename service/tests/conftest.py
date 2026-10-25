"""Use CAD's released workspace dependency as the native codec oracle.

The installed worker deliberately bundles this wheel, not an editable sibling
checkout. Comparing its deterministic archives with a different codec version
turns unrelated Animation changes into CAD failures.
"""

import hashlib
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
LOCK = json.loads((ROOT / "vendor/python/workspace-codec.json").read_text())
WHEEL = ROOT / "vendor/python" / LOCK["wheel"]
if hashlib.sha256(WHEEL.read_bytes()).hexdigest() != LOCK["sha256"]:
    raise pytest.UsageError("CAD workspace-codec wheel does not match its pinned hash")

for name, module in tuple(sys.modules.items()):
    if (name == "aether_animation" or name.startswith("aether_animation.")) and not str(
        getattr(module, "__file__", "")
    ).startswith(str(WHEEL) + "/"):
        raise pytest.UsageError("Run CAD tests in a fresh process: another workspace codec is already imported")
sys.path.insert(0, str(WHEEL))
