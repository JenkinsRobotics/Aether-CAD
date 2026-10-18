"""Draft exact geometry, stable target, neutral plane and failed-reference recovery."""

import math
import pytest
from aether_freecad import BuildJob, Feature, FreeCADEngine


@pytest.fixture(scope="module")
def engine():
    with FreeCADEngine() as instance:
        yield instance


def job(**options):
    return BuildJob(
        features=[
            Feature("outline", "sketch-rectangle", {"width_mm": 20, "height_mm": 20}),
            Feature(
                "pad",
                "pad",
                {
                    "profile": "outline",
                    "distance_mm": 10,
                    "operation": "new",
                    "body_id": "plate",
                },
            ),
            Feature(
                "draft",
                "draft",
                {
                    "body_id": "plate",
                    "face_plane": "XZ",
                    "face_offset_mm": 20,
                    "neutral_plane": "XY",
                    "neutral_offset_mm": 0,
                    "angle_deg": 5,
                    **options,
                },
            ),
        ]
    )


@pytest.mark.parametrize("reverse,sign", [(False, -1), (True, 1)])
def test_draft_exact_wedge_volume(engine, reverse, sign):
    result = engine.build(job(reversed=reverse))
    assert result.diagnostics == []
    assert result.bodies[0].id == "plate"
    assert result.bodies[0].volume_mm3 == pytest.approx(
        4000 + sign * 1000 * math.tan(math.radians(5)), abs=1e-5
    )


def test_offset_neutral_plane_can_change_shape_without_changing_volume(engine):
    result = engine.build(job(neutral_offset_mm=5))
    assert result.diagnostics == []
    assert result.bodies[0].volume_mm3 == pytest.approx(4000, abs=1e-5)
    assert max(result.bodies[0].vertices[1::3]) == pytest.approx(
        20 + 5 * math.tan(math.radians(5)), abs=1e-5
    )


@pytest.mark.parametrize(
    "invalid",
    [
        {"face_offset_mm": 99},
        {"angle_deg": 0},
        {"angle_deg": 90},
        {"body_id": "missing"},
    ],
)
def test_draft_invalid_reference_or_angle_cannot_export_and_recovers(engine, invalid):
    result = engine.build(job(**invalid))
    assert any(
        d["feature_id"] == "draft" and d["severity"] == "error"
        for d in result.diagnostics
    )
    assert engine.export(job(**invalid), {"format": "step"})["status"] == "error"
    assert engine.build(job(angle_deg=3)).diagnostics == []


def test_draft_step_roundtrip(engine):
    result = engine.export(job(), {"format": "step"})
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
    assert restored.bodies[0].volume_mm3 == pytest.approx(
        engine.build(job()).bodies[0].volume_mm3, abs=1e-4
    )
