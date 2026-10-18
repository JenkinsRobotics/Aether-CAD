"""Patterns repeat exact additive/subtractive features, not display meshes."""

import math
import pytest
from aether_freecad import BuildJob, Feature, FreeCADEngine


@pytest.fixture(scope="module")
def engine():
    with FreeCADEngine() as instance:
        yield instance


def job(kind="linear", **options):
    base = (
        Feature("base", "sketch-rectangle", {"width_mm": 40, "height_mm": 20})
        if kind == "linear"
        else Feature("base", "sketch-circle", {"radius_mm": 10})
    )
    center = (
        [25, 10]
        if options.get("reversed") and kind == "linear"
        else [5, 10]
        if kind == "linear"
        else [5, 0]
    )
    return BuildJob(
        features=[
            base,
            Feature(
                "pad",
                "pad",
                {
                    "profile": "base",
                    "distance_mm": 10,
                    "operation": "new",
                    "body_id": "plate",
                },
            ),
            Feature(
                "center",
                "sketch-circle",
                {"radius_mm": 1, "center_mm": center, "offset_mm": 10},
            ),
            Feature(
                "hole",
                "hole",
                {
                    "profile": "center",
                    "diameter_mm": 2,
                    "depth_mm": 10,
                    "depth_type": "through-all",
                    "body_id": "plate",
                    "operation": "cut",
                },
            ),
            Feature(
                "pattern",
                "pattern",
                {
                    "source": "hole",
                    "body_id": "plate",
                    "pattern_type": kind,
                    "axis": "X" if kind == "linear" else "Z",
                    "count": 3 if kind == "linear" else 4,
                    "spacing_mm": 10,
                    "angle_deg": 360,
                    **options,
                },
            ),
        ]
    )


@pytest.mark.parametrize(
    "kind,reversed",
    [("linear", False), ("linear", True), ("polar", False), ("polar", True)],
)
def test_hole_pattern_exact_volume(engine, kind, reversed):
    result = engine.build(job(kind, reversed=reversed))
    assert result.diagnostics == []
    assert result.bodies[0].id == "plate"
    expected = 8000 - 3 * math.pi * 10 if kind == "linear" else math.pi * 960
    assert result.bodies[0].volume_mm3 == pytest.approx(expected, abs=1e-5)


def test_partial_polar_pattern_includes_both_angular_endpoints(engine):
    result = engine.build(job("polar", count=3, angle_deg=180))
    assert result.diagnostics == []
    assert result.bodies[0].volume_mm3 == pytest.approx(math.pi * 970, abs=1e-5)


@pytest.mark.parametrize(
    "invalid",
    [
        {"source": "missing"},
        {"source": "center"},
        {"count": 1},
        {"count": 2.5},
        {"spacing_mm": 0},
        {"body_id": "missing"},
    ],
)
def test_pattern_invalid_parameters_do_not_export_and_worker_recovers(engine, invalid):
    result = engine.build(job(**invalid))
    assert any(
        d["feature_id"] == "pattern" and d["severity"] == "error"
        for d in result.diagnostics
    )
    assert engine.export(job(**invalid), {"format": "step"})["status"] == "error"
    assert engine.build(job()).diagnostics == []


def test_pattern_step_roundtrip(engine):
    result = engine.export(job("polar"), {"format": "step"})
    assert result["status"] == "ok"
    restored = engine.build(
        BuildJob(
            features=[
                Feature(
                    "import",
                    "import-step",
                    {
                        "data_base64": result["data_base64"],
                        "operation": "new",
                        "body_id": "restored",
                    },
                )
            ]
        )
    )
    assert restored.diagnostics == []
    assert restored.bodies[0].volume_mm3 == pytest.approx(math.pi * 960, abs=1e-4)


def test_additive_pattern_preserves_an_independent_body(engine):
    features = [
        Feature("base", "sketch-rectangle", {"width_mm": 40, "height_mm": 20}),
        Feature(
            "plate",
            "pad",
            {
                "profile": "base",
                "distance_mm": 2,
                "operation": "new",
                "body_id": "plate",
            },
        ),
        Feature(
            "boss-sketch",
            "sketch-circle",
            {"radius_mm": 2, "center_mm": [5, 10], "offset_mm": 2},
        ),
        Feature(
            "boss",
            "pad",
            {
                "profile": "boss-sketch",
                "distance_mm": 5,
                "operation": "add",
                "body_id": "plate",
            },
        ),
        Feature(
            "other-sketch", "sketch-circle", {"radius_mm": 1, "center_mm": [60, 0]}
        ),
        Feature(
            "other",
            "pad",
            {
                "profile": "other-sketch",
                "distance_mm": 3,
                "operation": "new",
                "body_id": "other",
            },
        ),
        Feature(
            "pattern",
            "pattern",
            {
                "source": "boss",
                "body_id": "plate",
                "pattern_type": "linear",
                "axis": "X",
                "count": 3,
                "spacing_mm": 10,
            },
        ),
    ]
    result = engine.build(BuildJob(features=features))
    assert result.diagnostics == []
    volumes = {b.id: b.volume_mm3 for b in result.bodies}
    assert volumes["plate"] == pytest.approx(1600 + 3 * math.pi * 4 * 5, abs=1e-5)
    assert volumes["other"] == pytest.approx(math.pi * 3, abs=1e-5)
    features[-1] = Feature(
        "pattern",
        "pattern",
        {
            "source": "boss",
            "body_id": "other",
            "pattern_type": "linear",
            "axis": "X",
            "count": 3,
            "spacing_mm": 10,
        },
    )
    assert any(
        d["feature_id"] == "pattern" and d["severity"] == "error"
        for d in engine.build(BuildJob(features=features)).diagnostics
    )
