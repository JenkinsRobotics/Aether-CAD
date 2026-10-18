# The module is not installed; put its root on the path so the suite runs from
# the repository root as well as from this directory.
import sys
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def pytest_addoption(parser):
    parser.addoption("--require-freecad", action="store_true", default=False,
                     help="Fail native acceptance when FreeCAD cannot start; never certify skipped tests.")


def pytest_sessionstart(session):
    if not session.config.getoption("--require-freecad"):
        return
    from aether_freecad import FreeCADEngine
    from aether_freecad.protocol import PROTOCOL_VERSION
    try:
        with FreeCADEngine(timeout_seconds=15) as engine:
            result = engine.describe()
        if result.get("protocol") != PROTOCOL_VERSION:
            raise RuntimeError(result.get("message", "Engine did not report ready."))
    except Exception as error:
        raise pytest.UsageError(f"Native FreeCAD acceptance requires a working engine: {error}") from error
