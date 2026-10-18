"""Holes remove exact material from a chosen body and survive failed edits."""

import base64
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
            Feature(
                "plate-profile", "sketch-rectangle", {"width_mm": 20, "height_mm": 20}
            ),
            Feature(
                "plate",
                "pad",
                {
                    "profile": "plate-profile",
                    "distance_mm": 10,
                    "body_id": "plate",
                    "operation": "new",
                },
            ),
            Feature(
                "center",
                "sketch-circle",
                {"radius_mm": 1, "center_mm": [10, 10], "offset_mm": 10},
            ),
            Feature(
                "hole",
                "hole",
                {
                    "profile": "center",
                    "body_id": "plate",
                    "operation": "cut",
                    "diameter_mm": 6,
                    "depth_mm": 5,
                    "depth_type": "blind",
                    "cut_type": "plain",
                    **options,
                },
            ),
        ]
    )


@pytest.mark.parametrize(
    "options,removed",
    [
        ({}, math.pi * 9 * 5),
        ({"depth_type": "through-all"}, math.pi * 9 * 10),
        (
            {
                "cut_type": "counterbore",
                "counter_diameter_mm": 10,
                "counter_depth_mm": 2,
            },
            math.pi * (25 * 2 + 9 * 3),
        ),
        (
            {
                "cut_type": "countersink",
                "counter_diameter_mm": 10,
                "countersink_angle_deg": 90,
            },
            math.pi * (2 / 3 * (25 + 15 + 9) + 9 * 3),
        ),
    ],
)
def test_hole_exact_volume_and_target(engine, options, removed):
    result = engine.build(job(**options))
    assert result.status == "ok", result.message or result.diagnostics
    assert len(result.bodies) == 1
    assert result.bodies[0].id == "plate"
    assert result.bodies[0].volume_mm3 == pytest.approx(4000 - removed, abs=1e-5)


def test_hole_no_material_and_bad_head_fail_then_valid_edit_recovers(engine):
    for options in [
        {"reversed": True},
        {"cut_type": "counterbore", "counter_diameter_mm": 4, "counter_depth_mm": 2},
    ]:
        result = engine.build(job(**options))
        # Builds retain the last valid body for display; diagnostics block commit.
        assert engine.export(job(**options), {"format": "step"})["status"] == "error"
        assert any(
            d["feature_id"] == "hole" and d["severity"] == "error"
            for d in result.diagnostics
        )
    assert engine.build(job(diameter_mm=4)).bodies[0].volume_mm3 == pytest.approx(
        4000 - math.pi * 4 * 5, abs=1e-5
    )


def test_hole_step_roundtrip_preserves_volume(engine):
    source = job(cut_type="counterbore", counter_diameter_mm=10, counter_depth_mm=2)
    exported = engine.export(source, {"format": "step"})
    assert exported["status"] == "ok", exported
    assert base64.b64decode(exported["data_base64"]).startswith(b"ISO-10303-21")
    imported = engine.build(
        BuildJob(
            features=[
                Feature(
                    "import",
                    "import-step",
                    {
                        "data_base64": exported["data_base64"],
                        "body_id": "roundtrip",
                        "operation": "new",
                    },
                )
            ]
        )
    )
    assert imported.status == "ok", imported.diagnostics
    assert imported.bodies[0].volume_mm3 == pytest.approx(
        engine.build(source).bodies[0].volume_mm3, abs=1e-4
    )
