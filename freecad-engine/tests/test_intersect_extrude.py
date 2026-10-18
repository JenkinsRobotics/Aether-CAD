"""Intersection uses the saved extrusion tool, not another mutable target body."""

import pytest
from aether_freecad import BuildJob, Feature, FreeCADEngine


@pytest.fixture(scope="module")
def engine():
    with FreeCADEngine() as value:
        yield value


def job(*, x=4, target="target", depth=6, **options):
    features = []
    for key, offset in [("target", 0), ("other", 30)]:
        features += [
            Feature(
                key + "-sketch",
                "sketch-polygon",
                {
                    "points_mm": [
                        [offset - 5, -5],
                        [offset + 5, -5],
                        [offset + 5, 5],
                        [offset - 5, 5],
                    ]
                },
            ),
            Feature(
                key + "-pad",
                "pad",
                {
                    "profile": key + "-sketch",
                    "distance_mm": 10,
                    "body_id": key,
                    "operation": "new",
                },
            ),
        ]
    features += [
        Feature(
            "mask",
            "sketch-polygon",
            {"points_mm": [[x - 4, -5], [x + 4, -5], [x + 4, 5], [x - 4, 5]]},
        ),
        Feature(
            "intersect",
            "pad",
            {
                "profiles": ["mask"],
                "profile_regions": ["mask"],
                "region_mode": True,
                "distance_mm": depth,
                "operation": "intersect",
                "body_id": target,
                **options,
            },
        ),
    ]
    return BuildJob(features=features)


@pytest.mark.parametrize(
    "extent,volume",
    [
        ({}, 300),
        ({"end_type": "symmetric"}, 150),
        ({"end_type": "through-all"}, 500),
        ({"starting_offset_mm": 3}, 300),
        ({"starting_offset_mm": 3, "reversed": True}, 0),
        ({"second_distance_mm": 4}, 300),
    ],
)
def test_native_extents_and_independent_body_identity(engine, extent, volume):
    result = engine.build(job(**extent))
    if not volume:
        assert any(d["feature_id"] == "intersect" for d in result.diagnostics)
        return
    assert not result.diagnostics, result.diagnostics
    bodies = {b.id: b for b in result.bodies}
    assert set(bodies) == {"target", "other"}
    assert bodies["target"].volume_mm3 == pytest.approx(volume)
    assert bodies["other"].volume_mm3 == pytest.approx(1000)


@pytest.mark.parametrize(
    "changes",
    [{"x": 50}, {"target": "missing"}, {"region_mode": False}, {"distance_mm": -2}],
)
def test_invalid_intersection_cannot_export_and_same_worker_recovers(engine, changes):
    invalid = job(**changes)
    result = engine.build(invalid)
    assert any(d["feature_id"] == "intersect" for d in result.diagnostics)
    assert engine.export(invalid, {"format": "step"})["status"] == "error"
    assert not engine.build(job()).diagnostics


def test_exact_step_export_reimport_and_upstream_edit(engine):
    exported = engine.export(job(), {"format": "step", "body_ids": ["target"]})
    assert exported["status"] == "ok", exported
    imported = engine.build(
        BuildJob(
            features=[
                Feature(
                    "import",
                    "import-step",
                    {
                        "body_id": "restored",
                        "data_base64": exported["data_base64"],
                        "operation": "new",
                    },
                )
            ]
        )
    )
    assert not imported.diagnostics, imported.diagnostics
    assert imported.bodies[0].volume_mm3 == pytest.approx(300)
    assert engine.build(job(depth=8)).bodies[0].volume_mm3 == pytest.approx(400)
