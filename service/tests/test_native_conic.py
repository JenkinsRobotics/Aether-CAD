"""Packaged geometry and Part20 preserve exact conics.

Fixtures come from actual browser conic split/trim/reversal operations. Their
areas use independent analytic circular/parabolic/hyperbolic segment equations.
Authoring UI acceptance is verified separately from these native contracts.
"""

import json
from pathlib import Path

import pytest
from test_native_connected_profile import invoke as invoke_document
from test_native_connected_profile import joined_part
from test_native_connected_regions import feature, invoke

CASES = json.loads((Path(__file__).parent / "fixtures/conic-geometry.json").read_text())
AUTHORED = json.loads((Path(__file__).parent / "fixtures/conic-authored.json").read_text())


@pytest.mark.parametrize("case", AUTHORED, ids=lambda c: c["name"])
def test_authored_saved_conic_reopens_with_native_volume(tmp_path, case):
    path = tmp_path / (case["name"] + ".acpart")
    path.write_text(json.dumps(case["document"]))
    document = json.loads(path.read_text())
    assert document["formatVersion"] == 20
    result = invoke_document(tmp_path, document)
    assert "error" not in result, result
    bodies = result["result"]["evaluated_bodies"]
    assert len(bodies) == 1
    assert bodies[0]["volume_mm3"] == pytest.approx(case["volume"], rel=1e-7)
    assert json.loads(path.read_text()) == case["document"]


# Exact conic splits, capability and rho refusals are proven by the engine oracle fixtures
# (conic-ellipse / conic-parabola / conic-hyperbola against FreeCAD) and the sketch tests;
# the host geometry service those packaged tests drove is retired.
