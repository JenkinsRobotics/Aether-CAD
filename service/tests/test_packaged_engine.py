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
        assert not any(name.startswith("aether_freecad/") for name in wheel.namelist())
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
for module in (service,):
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


def test_wheel_contains_the_node_runner_and_its_kernel(installed):
    # The installed wheel builds geometry through the Node runner (Aether engine); the
    # round trip is covered by test_native_program (programs) and test_native_automation.
    run_installed(
        installed,
        """
runtime = Path(service.__file__).with_name("runtime")
assert (runtime / "runner.mjs").is_file()
assert (runtime / "replicad_single.wasm").stat().st_size > 1_000_000
assert (runtime / "runner.pyz").is_file()
""",
    )


@pytest.mark.skipif(
    os.environ.get("AETHER_TEST_NATIVE") != "1", reason="Required native release gate"
)
def test_installed_agent_runtime_edits_using_packaged_native_engine(installed):
    run_installed(
        installed,
        """
import json
from aether_cad_service.automation import execute
from aether_animation.aether_project import edit_project, new_project
from aether_animation.aether_workspace import AetherWorkspace
document = {"format":"aether-part","formatVersion":3,"documentId":"installed","name":"Installed","units":"millimeter","features":[
    {"id":"s","name":"Sketch","type":"profile","plane":"XY","offsetMillimeters":0,"suppressed":False,
     "profile":{"type":"polygon","pointsMillimeters":[[0,0],[10,0],[10,20],[0,20]]}},
    {"id":"pad","name":"Extrude","type":"extrude","profileFeatureId":"s","distanceMillimeters":5,"operation":"new","suppressed":False}
]}
workspace = new_project("Installed"); edit_project(workspace, "add_part", {"name": "Installed", "document": document})
source = workspace.to_bytes()[0]
product = service.CADService()
try:
    result = execute(product, 'cad.extrude.setdepth', source, {'feature_id':'pad','depth_mm':8})
    assert abs(result['result']['evaluated_bodies'][0]['volume_mm3'] - 1600) < 0.001
    saved = next(iter(AetherWorkspace.from_bytes(result['content']).part_definitions.values()))['feature_document']
    assert saved['features'][1]['distanceMillimeters'] == 8
finally:
    for engine in product.engines.values(): engine.close()
""",
    )
