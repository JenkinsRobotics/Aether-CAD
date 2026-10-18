"""Saved production curvature gestures rebuild through the packaged native worker."""

import json
from pathlib import Path

import pytest
from test_native_connected_profile import bodies, invoke

FIXTURES = json.loads(
    (Path(__file__).parent / "fixtures/conic-manipulation.json").read_text()
)


@pytest.mark.parametrize("case", FIXTURES, ids=lambda case: case["name"])
def test_curvature_gesture_reopens_with_exact_native_volume(tmp_path, case):
    path = tmp_path / (case["name"] + ".acpart")
    content = json.dumps(case["document"])
    path.write_text(content)
    document = json.loads(path.read_text())
    assert document["formatVersion"] == 20
    drawing = document["features"][0]["profile"]
    assert len(drawing["contours"]) == 1
    segment = drawing["contours"][0]["segments"][0]
    assert segment["type"] == "conic"
    assert [c["value"] for c in drawing["constraints"] if c["kind"] == "conic-rho"] == [
        segment["rho"]
    ]
    assert not any(c.get("id", "").startswith("drag-") for c in drawing["constraints"])
    first = bodies(invoke(tmp_path, document))
    assert len(first) == 1
    # Analytic circular, parabolic and hyperbolic segment areas are independent
    # of the browser rational-curve evaluator and its display tessellation.
    assert first[0]["volume_mm3"] == pytest.approx(case["volume"], rel=1e-8)
    assert bodies(invoke(tmp_path, json.loads(path.read_text()))) == first
    assert path.read_text() == content
