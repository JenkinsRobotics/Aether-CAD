"""Release checks must import the installed adapter, not a nearby checkout."""

import os
import subprocess
import sys
import zipfile
from pathlib import Path

import pytest


@pytest.fixture(scope="module")
def installed(tmp_path_factory):
    root = tmp_path_factory.mktemp("cad-wheel")
    repo = Path(__file__).resolve().parents[2]
    subprocess.run(
        [
            sys.executable,
            "-m",
            "pip",
            "wheel",
            "--no-deps",
            "--no-build-isolation",
            str(repo),
            "--wheel-dir",
            str(root),
        ],
        check=True,
        capture_output=True,
    )
    target = root / "installed"
    with zipfile.ZipFile(next(root.glob("*.whl"))) as wheel:
        assert any(name.endswith("/ATTRIBUTION.md") for name in wheel.namelist())
        assert "aether_freecad/worker.py" in wheel.namelist()
        assert "aether_cad_service/runtime/runner.mjs" in wheel.namelist()
        assert "aether_cad_service/AGENT_ACCESS.md" in wheel.namelist()
        wheel.extractall(target)
    return target


def run_installed(installed, code):
    result = subprocess.run(
        [
            sys.executable,
            "-I",
            "-c",
            """
import sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
import aether_cad_service.service as service
assert service.CADService.compatibility["product"] == "cad"
adapter = service.freecad_engine_module()
for module in (service, adapter):
    assert Path(module.__file__).is_relative_to(sys.argv[1]), module.__file__
"""
            + code,
            str(installed),
        ],
        cwd=installed.parent,
        capture_output=True,
        text=True,
        check=False,
        timeout=180,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_wheel_contains_replaceable_adapter_and_worker(installed):
    run_installed(
        installed,
        """
from aether_freecad.engine import WORKER
assert WORKER.is_file()
assert WORKER.is_relative_to(sys.argv[1])
assert adapter.PROTOCOL_VERSION
""",
    )


@pytest.mark.skipif(
    os.environ.get("AETHER_TEST_FREECAD") != "1",
    reason="Set AETHER_TEST_FREECAD=1 for the required native release gate",
)
def test_installed_native_rebuild_recovery_and_step_round_trip(installed):
    run_installed(
        installed,
        """
import math
from aether_freecad import BuildJob, Feature
with adapter.FreeCADEngine() as engine:
    def job(depth):
        return BuildJob(features=[
            Feature('s', 'sketch-rectangle', {'width_mm': 40, 'height_mm': 20}),
            Feature('p', 'pad', {'profile': 's', 'distance_mm': depth}),
        ])
    for depth in (10, 20):
        result = engine.build(job(depth))
        assert not result.diagnostics, result.diagnostics
        assert math.isclose(result.bodies[0].volume_mm3, 800 * depth)
    bad = engine.build(BuildJob(features=[Feature('p', 'pad', {'profile': 'missing', 'distance_mm': 10})]))
    assert bad.diagnostics
    exported = engine.export(job(20), {'format': 'step'})
    assert exported['status'] == 'ok', exported
    imported = engine.build(BuildJob(features=[Feature('import', 'import-step', {
        'data_base64': exported['data_base64'], 'body_id': 'saved', 'operation': 'new',
    })]))
    assert not imported.diagnostics, imported.diagnostics
    assert math.isclose(imported.bodies[0].volume_mm3, 16000)
    assert imported.bodies[0].id == 'saved'
""",
    )


@pytest.mark.skipif(
    os.environ.get("AETHER_TEST_FREECAD") != "1", reason="Required native release gate"
)
def test_installed_agent_runtime_edits_using_packaged_native_engine(installed):
    run_installed(
        installed,
        """
import json
from aether_cad_service.automation import execute
source = json.dumps({"format":"aether-part","formatVersion":3,"documentId":"installed","name":"Installed","units":"millimeter","features":[
    {"id":"s","name":"Sketch","type":"profile","plane":"XY","offsetMillimeters":0,"suppressed":False,
     "profile":{"type":"polygon","pointsMillimeters":[[0,0],[10,0],[10,20],[0,20]]}},
    {"id":"pad","name":"Extrude","type":"extrude","profileFeatureId":"s","distanceMillimeters":5,"operation":"new","suppressed":False}
]}).encode()
product = service.CADService()
try:
    result = execute(product, 'cad.extrude.setdepth', source, {'feature_id':'pad','depth_mm':8})
    assert abs(result['result']['evaluated_bodies'][0]['volume_mm3'] - 1600) < 0.001
    assert json.loads(result['content'])['features'][1]['distanceMillimeters'] == 8
finally:
    for engine in product.engines.values(): engine.close()
""",
    )
