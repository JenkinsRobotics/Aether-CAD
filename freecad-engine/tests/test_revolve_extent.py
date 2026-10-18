"""Exact angular extent acceptance against the replaceable native engine."""

import math

import pytest
from aether_freecad import BuildJob, Feature, FreeCADEngine


def job(**options):
    return BuildJob(
        features=[
            Feature(
                "s",
                "sketch-polygon",
                {"points_mm": [[5, 2], [25, 2], [25, 12], [5, 12]], "plane": "XY"},
            ),
            Feature(
                "r",
                "revolve",
                {
                    "profile": "s",
                    "axis": "X",
                    "angle_deg": 90,
                    "body_id": "ring",
                    "operation": "new",
                    **options,
                },
            ),
        ]
    )


@pytest.mark.parametrize(
    "options,total,zmin,zmax",
    [
        ({}, 90, 0, 12),
        ({"reversed": True}, 90, -12, 0),
        ({"symmetric": True}, 90, -12 / math.sqrt(2), 12 / math.sqrt(2)),
        ({"second_angle_deg": 30}, 120, -6, 12),
        ({"second_angle_deg": 30, "reversed": True}, 120, -12, 6),
    ],
)
def test_exact_revolve_extents_and_step(options, total, zmin, zmax):
    with FreeCADEngine() as engine:
        source = job(**options)
        result = engine.build(source)
        assert not result.diagnostics, result.diagnostics
        body = result.bodies[0]
        assert body.id == "ring"
        assert body.volume_mm3 == pytest.approx(2800 * math.pi * total / 360, rel=1e-6)
        assert min(body.vertices[2::3]) == pytest.approx(zmin, abs=0.01)
        assert max(body.vertices[2::3]) == pytest.approx(zmax, abs=0.01)
        exported = engine.export(source, {"format": "step"})
        assert exported["status"] == "ok", exported
        imported = engine.build(
            BuildJob(
                features=[
                    Feature(
                        "i",
                        "import-step",
                        {
                            "data_base64": exported["data_base64"],
                            "operation": "new",
                            "body_id": "ring",
                        },
                    )
                ]
            )
        )
        assert not imported.diagnostics
        assert imported.bodies[0].volume_mm3 == pytest.approx(body.volume_mm3)


@pytest.mark.parametrize(
    "options",
    [
        {"angle_deg": 300, "second_angle_deg": 90},
        {"second_angle_deg": -1},
        {"symmetric": True, "second_angle_deg": 30},
        {"reversed": "yes"},
    ],
)
def test_bad_extents_refuse_export_then_recover(options):
    with FreeCADEngine() as engine:
        failed = engine.build(job(**options))
        assert failed.diagnostics
        assert engine.export(job(**options), {"format": "step"})["status"] == "error"
        assert not engine.build(job(symmetric=True)).diagnostics


def test_groove_two_angles_removes_exact_material_and_keeps_target():
    with FreeCADEngine() as engine:
        source = job(angle_deg=360)
        source.features.append(
            Feature(
                "cut",
                "revolve",
                {
                    "profile": "s",
                    "axis": "X",
                    "angle_deg": 90,
                    "second_angle_deg": 30,
                    "cut": True,
                    "operation": "cut",
                    "body_id": "ring",
                },
            )
        )
        result = engine.build(source)
        assert not result.diagnostics, result.diagnostics
        assert result.bodies[0].id == "ring"
        assert result.bodies[0].volume_mm3 == pytest.approx(2800 * math.pi * 240 / 360)
