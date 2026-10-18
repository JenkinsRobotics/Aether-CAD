import math

import pytest
from aether_freecad import BuildJob, Feature, FreeCADEngine


@pytest.fixture(scope="module")
def engine():
    with FreeCADEngine() as instance:
        yield instance


def box(origin=(0, 0, 0)):
    return BuildJob(
        features=[
            Feature(
                "s",
                "sketch-rectangle",
                {
                    "width_mm": 10,
                    "height_mm": 20,
                    "frame": {
                        "originMillimeters": list(origin),
                        "xDirection": [1, 0, 0],
                        "normal": [0, 0, 1],
                    },
                },
            ),
            Feature(
                "p",
                "pad",
                {
                    "profile": "s",
                    "distance_mm": 30,
                    "body_id": "box",
                    "operation": "new",
                },
            ),
        ]
    )


def test_volume_area_center_bounds_without_assuming_a_material(engine):
    result = engine.analyze(box(), {"kind": "properties"})
    assert result["status"] == "ok"
    assert result["bodies"] == []
    item = result["measurements"][0]
    assert item["body_id"] == "box"
    assert item["volume_mm3"] == pytest.approx(6000)
    assert item["area_mm2"] == pytest.approx(2200)
    assert item["center_mm"] == pytest.approx([5, 10, 15])
    assert item["bounds_mm"] == pytest.approx([10, 20, 30])
    assert "mass_kg" not in item and "inertia_kg_m2" not in item


def test_mass_and_centroidal_inertia_are_si_and_translation_invariant(engine):
    for origin in [(0, 0, 0), (100, -50, 80)]:
        result = engine.analyze(
            box(origin), {"kind": "properties", "density_kg_m3": 7850}
        )
        assert result["status"] == "ok"
        item = result["measurements"][0]
        mass = 0.0471
        assert item["mass_kg"] == pytest.approx(mass)
        assert item["center_mm"] == pytest.approx(
            [origin[0] + 5, origin[1] + 10, origin[2] + 15]
        )
        inertia = item["inertia_kg_m2"]
        for i, dimensions in enumerate([(0.02, 0.03), (0.01, 0.03), (0.01, 0.02)]):
            assert inertia[i][i] == pytest.approx(
                mass * sum(d * d for d in dimensions) / 12
            )
            for j in range(3):
                if i != j:
                    assert inertia[i][j] == pytest.approx(0, abs=1e-14)


@pytest.mark.parametrize("density", [0, -1, "bad", True, math.inf])
def test_invalid_density_fails_and_worker_recovers(engine, density):
    assert (
        engine.analyze(box(), {"kind": "properties", "density_kg_m3": density})[
            "status"
        ]
        == "error"
    )
    assert engine.analyze(box(), {"kind": "properties"})["status"] == "ok"


def test_inertia_tracks_rotated_body_axes(engine):
    original = box()
    original.features[0].parameters["frame"]["xDirection"] = [
        math.sqrt(0.5),
        math.sqrt(0.5),
        0,
    ]
    result = engine.analyze(original, {"kind": "properties", "density_kg_m3": 7850})
    assert result["status"] == "ok"
    matrix = result["measurements"][0]["inertia_kg_m2"]
    ix = 0.0471 * (0.02**2 + 0.03**2) / 12
    iy = 0.0471 * (0.01**2 + 0.03**2) / 12
    assert matrix[0][0] == pytest.approx((ix + iy) / 2)
    assert matrix[1][1] == pytest.approx((ix + iy) / 2)
    assert matrix[0][1] == pytest.approx((ix - iy) / 2)


def test_region_cut_compound_keeps_exact_volume_and_centroid(engine):
    job = box()
    job.features.extend([
        Feature("bore", "sketch-circle", {"radius_mm": 2, "center_mm": [5, 10], "offset_mm": 30}),
        Feature("cut", "pocket", {"profile": "bore", "profiles": ["bore"], "profile_regions": ["bore"],
                "region_mode": True, "distance_mm": 30, "operation": "cut", "body_id": "box"}),
    ])
    result = engine.analyze(job, {"kind": "properties", "density_kg_m3": 7850})
    assert result["status"] == "ok", result
    item = result["measurements"][0]
    volume = 6000 - math.pi * 4 * 30
    assert item["volume_mm3"] == pytest.approx(volume)
    assert item["mass_kg"] == pytest.approx(volume * 7850 * 1e-9)
    assert item["center_mm"] == pytest.approx([5, 10, 15])


def test_compound_inertia_uses_volume_centroid_and_parallel_axes(engine):
    job = BuildJob(features=[
        Feature("one", "sketch-rectangle", {"width_mm": 10, "height_mm": 10}),
        Feature("two", "sketch-rectangle", {"width_mm": 10, "height_mm": 10,
                "frame": {"originMillimeters": [20, 20, 0], "xDirection": [1, 0, 0], "normal": [0, 0, 1]}}),
        Feature("both", "pad", {"profile": "one", "profiles": ["one", "two"], "profile_regions": ["one", "two"],
                "region_mode": True, "distance_mm": 10, "operation": "new", "body_id": "compound"}),
    ])
    result = engine.analyze(job, {"kind": "properties", "density_kg_m3": 1000})
    assert result["status"] == "ok", result
    item = result["measurements"][0]
    assert item["volume_mm3"] == pytest.approx(2000)
    assert item["area_mm2"] == pytest.approx(1200)
    assert item["center_mm"] == pytest.approx([15, 15, 5])
    assert item["bounds_mm"] == pytest.approx([30, 30, 10])
    matrix = item["inertia_kg_m2"]
    assert matrix[0][0] == pytest.approx((100000 / 3 + 200000) * 1e-12)
    assert matrix[2][2] == pytest.approx((100000 / 3 + 400000) * 1e-12)
    assert matrix[0][1] == pytest.approx(-200000 * 1e-12)
    assert matrix[1][0] == pytest.approx(matrix[0][1])
