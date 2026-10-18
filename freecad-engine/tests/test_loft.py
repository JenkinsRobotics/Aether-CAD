"""Loft acceptance uses exact frustum volumes, target isolation and recovery."""

import math
import pytest
from aether_freecad import BuildJob, Feature, FreeCADEngine


@pytest.fixture(scope="module")
def engine():
    with FreeCADEngine() as instance:
        yield instance


def profiles():
    return [
        Feature("bottom", "sketch-circle", {"radius_mm": 4}),
        Feature("top", "sketch-circle", {"radius_mm": 2, "offset_mm": 10}),
    ]


@pytest.mark.parametrize("ruled", [False, True])
def test_new_loft_exact_volume_and_sections(engine, ruled):
    result = engine.build(
        BuildJob(
            features=[
                *profiles(),
                Feature(
                    "loft",
                    "loft",
                    {
                        "sections": ["bottom", "top"],
                        "body_id": "cone",
                        "operation": "new",
                        "ruled": ruled,
                    },
                ),
            ]
        )
    )
    assert result.diagnostics == []
    assert result.bodies[0].id == "cone"
    assert result.bodies[0].volume_mm3 == pytest.approx(
        math.pi * 10 * (16 + 8 + 4) / 3, abs=1e-4
    )


@pytest.mark.parametrize("operation", ["add", "cut"])
def test_loft_boolean_target_and_other_body_are_preserved(engine, operation):
    z = 10 if operation == "add" else 0
    features = [
        Feature("plate", "sketch-circle", {"radius_mm": 10}),
        Feature(
            "pad",
            "pad",
            {
                "profile": "plate",
                "distance_mm": 10,
                "operation": "new",
                "body_id": "plate",
            },
        ),
        Feature("other", "sketch-circle", {"radius_mm": 2, "center_mm": [30, 0]}),
        Feature(
            "other-pad",
            "pad",
            {
                "profile": "other",
                "distance_mm": 3,
                "operation": "new",
                "body_id": "other",
            },
        ),
        Feature("bottom", "sketch-circle", {"radius_mm": 4, "offset_mm": z}),
        Feature("top", "sketch-circle", {"radius_mm": 2, "offset_mm": z + 10}),
        Feature(
            "loft",
            "loft",
            {"sections": ["bottom", "top"], "operation": operation, "body_id": "plate"},
        ),
    ]
    result = engine.build(BuildJob(features=features))
    assert result.diagnostics == []
    volumes = {b.id: b.volume_mm3 for b in result.bodies}
    assert volumes["other"] == pytest.approx(math.pi * 4 * 3, abs=1e-4)
    assert volumes["plate"] == pytest.approx(
        math.pi * 100 * 10 + (1 if operation == "add" else -1) * math.pi * 10 * 28 / 3,
        abs=1e-4,
    )


@pytest.mark.parametrize(
    "sections", [["bottom"], ["bottom", "missing"], ["bottom", "bottom"]]
)
def test_loft_rejects_invalid_sections_then_recovers(engine, sections):
    def job(ids):
        return BuildJob(
            features=[
                *profiles(),
                Feature(
                    "loft",
                    "loft",
                    {"sections": ids, "body_id": "cone", "operation": "new"},
                ),
            ]
        )

    result = engine.build(job(sections))
    assert any(
        d["feature_id"] == "loft" and d["severity"] == "error"
        for d in result.diagnostics
    )
    assert engine.build(job(["bottom", "top"])).diagnostics == []


def test_three_ordered_sections_and_step_export(engine):
    job = BuildJob(
        features=[
            Feature("bottom", "sketch-circle", {"radius_mm": 4}),
            Feature("middle", "sketch-circle", {"radius_mm": 3, "offset_mm": 5}),
            Feature("top", "sketch-circle", {"radius_mm": 2, "offset_mm": 10}),
            Feature(
                "loft",
                "loft",
                {
                    "sections": ["bottom", "middle", "top"],
                    "operation": "new",
                    "body_id": "loft",
                    "ruled": True,
                },
            ),
        ]
    )
    result = engine.build(job)
    assert result.diagnostics == []
    assert result.bodies[0].volume_mm3 == pytest.approx(math.pi * 10 * 28 / 3, abs=1e-4)
    exported = engine.export(job, {"format": "step"})
    assert exported["status"] == "ok"
    imported = engine.build(
        BuildJob(
            features=[
                Feature(
                    "import",
                    "import-step",
                    {
                        "data_base64": exported["data_base64"],
                        "body_id": "restored",
                        "operation": "new",
                    },
                )
            ]
        )
    )
    assert imported.diagnostics == []
    assert imported.bodies[0].volume_mm3 == pytest.approx(
        result.bodies[0].volume_mm3, abs=1e-4
    )
