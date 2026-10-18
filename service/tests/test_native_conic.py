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


@pytest.mark.parametrize("case", CASES, ids=lambda c: c["name"])
def test_packaged_exact_conic_splits_trim_and_reversal_form_native_solids(
    tmp_path, case
):
    # Joining a separately authored line also exercises exact region building,
    # curve reversal and its source-link dependencies, not just a single wire.
    features = [
        feature(
            "curve", "sketch-wire", start_mm=case["start"], segments=[case["segment"]]
        ),
        feature(
            "chord",
            "sketch-wire",
            start_mm=case["start"],
            segments=[{"type": "line", "end": case["segment"]["end"]}],
        ),
        feature("region", "sketch-region", profiles=["chord", "curve"]),
        feature(
            "pad",
            "pad",
            operation="new",
            body_id="conic",
            region_mode=True,
            profiles=["region"],
            profile_regions=["region"],
            distance_mm=6,
        ),
    ]
    result = invoke(tmp_path, "geometry", {"features": features, "tolerance_mm": 0.02})
    assert not result["diagnostics"], result["diagnostics"]
    assert len(result["bodies"]) == 1
    assert result["bodies"][0]["volume_mm3"] == pytest.approx(
        case["area"] * 6, rel=1e-8
    )
    assert result["bodies"][0]["triangles"]


def test_packaged_capability_and_part20_exact_conic_rebuild(tmp_path):
    assert "sketch-conic" in invoke(tmp_path, "engine", {})["capabilities"]
    document = joined_part()
    document["formatVersion"] = 20
    document["features"][0]["profile"] = {
        "type": "drawing",
        "contours": [
            {
                "type": "path",
                "start": [0, 0],
                "segments": [
                    {"type": "conic", "end": [20, 0], "control": [10, 20], "rho": 0.5},
                    {"type": "line", "end": [0, 0]},
                ],
            },
        ],
    }
    document["features"][1] = {
        "id": "e",
        "type": "extrude",
        "name": "Extrude",
        "suppressed": False,
        "profileFeatureId": "s",
        "operation": "new",
        "distanceMillimeters": 6,
    }
    # An independent equivalent cubic parabola must give the same solid.
    drawing = document["features"][0]["profile"]
    conic = drawing["contours"][0]["segments"][0]
    drawing["contours"][0]["segments"][0] = {
        "type": "bezier",
        "controls": [[20 / 3, 40 / 3], [40 / 3, 40 / 3]],
        "end": [20, 0],
    }
    valid = invoke_document(tmp_path, document)
    assert valid["result"]["evaluated_bodies"][0]["volume_mm3"] == pytest.approx(800)
    drawing["contours"][0]["segments"][0] = conic
    result = invoke_document(tmp_path, document)
    assert result["result"]["evaluated_bodies"][0]["volume_mm3"] == pytest.approx(800)


def test_packaged_invalid_conic_rho_fails_without_a_partial_body(tmp_path):
    features = [
        feature(
            "curve",
            "sketch-wire",
            start_mm=[0, 0],
            segments=[
                {"type": "conic", "end": [20, 0], "control": [10, 20], "rho": 1},
                {"type": "line", "end": [0, 0]},
            ],
        ),
        feature(
            "pad",
            "pad",
            profile="curve",
            operation="new",
            body_id="conic",
            distance_mm=6,
        ),
    ]
    result = invoke(tmp_path, "geometry", {"features": features})
    assert not result["bodies"]
    assert result["diagnostics"][0]["feature_id"] == "curve"
