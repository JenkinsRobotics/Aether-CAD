"""Oblique extrusion distance is travel along a unit vector, not normal depth."""
import math
from dataclasses import replace

import pytest
from aether_freecad import BuildJob, Feature, FreeCADEngine
from test_extrusion_ends import cone, limits, part
from test_up_to_face import tilted_job


@pytest.fixture(scope="module")
def engine():
    with FreeCADEngine() as instance:
        yield instance


@pytest.mark.parametrize("mode,offset,reversed", [("blind", 0, False), ("blind", 3, True), ("symmetric", -2, False)])
def test_oblique_travel_preserves_sketch_and_exact_volume(engine, mode, offset, reversed):
    model = part(direction_vector=[.6, 0, .8], end_type=mode, starting_offset_mm=offset, reversed=reversed)
    result = engine.build(model)
    assert not result.diagnostics, result.diagnostics
    body = result.bodies[0]
    assert body.volume_mm3 == pytest.approx(math.pi * 100 * 10 * .8)
    low = offset - (5 if mode == "symmetric" else 0)
    high = offset + (5 if mode == "symmetric" else 10)
    if reversed:
        low, high = -high, -low
    assert min(body.vertices[2::3]) == pytest.approx(low * .8)
    assert max(body.vertices[2::3]) == pytest.approx(high * .8)
    assert min(body.vertices[0::3]) == pytest.approx(low * .6 - 10, abs=.03)
    assert max(body.vertices[0::3]) == pytest.approx(high * .6 + 10, abs=.03)


@pytest.mark.parametrize("end", ["up-to-face", "up-to-next"])
def test_oblique_stopping_face_offsets_and_upstream_move(engine, end):
    model = part(direction_vector=[.6, 0, .8], end_type=end, end_offset_mm=2, starting_offset_mm=1,
        end_reference={"sourceFeatureId": "top", "bodyId": "top", "normal": [0, 0, -1]})
    model.features[0].parameters["center_mm"] = [50, 50]
    model.features[:0] = limits()
    for height in [30, 40]:
        model.features[2].parameters["offset_mm"] = height
        result = engine.build(model)
        assert not result.diagnostics, result.diagnostics
        body = result.bodies[-1]
        assert body.volume_mm3 == pytest.approx(math.pi * 100 * (height - 3 * .8))
        assert min(body.vertices[2::3]) == pytest.approx(.8)
        assert max(body.vertices[2::3]) == pytest.approx(height - 2 * .8)


def test_oblique_path_to_tilted_infinite_plane_and_step(engine):
    model = tilted_job(height=10, slope=.5)
    model.features[-1].parameters.update(direction_vector=[.6, 0, .8], end_offset_mm=2)
    result = engine.build(model)
    assert not result.diagnostics, result.diagnostics
    expected = math.pi * 4 * .8 * (10 / (.8 - .5 * .6) - 2)
    body = next(b for b in result.bodies if b.id == "result")
    # OCCT integrates trimmed oblique circular surfaces numerically (within 10 ppm).
    assert body.volume_mm3 == pytest.approx(expected, rel=1e-5)
    # All tessellation points remain before the actual tilted cap (axial offset).
    assert all(z <= 10 + .5 * x - 2 * (.8 - .5 * .6) + 1e-5 for x, y, z in zip(*[iter(body.vertices)] * 3))
    exported = engine.export(model, {"format": "step", "body_ids": ["result"]})
    assert exported["status"] == "ok"
    restored = engine.build(BuildJob(features=[Feature("i", "import-step", {"body_id": "restored", "operation": "new", "data_base64": exported["data_base64"]})]))
    assert not restored.diagnostics
    assert restored.bodies[0].volume_mm3 == pytest.approx(expected, rel=1e-5)
    assert restored.bodies[0].volume_mm3 == pytest.approx(body.volume_mm3, abs=1e-4)


@pytest.mark.parametrize("draft", [0, 5, -3])
def test_symmetric_through_all_independent_of_direction_and_scoped_parts(engine, draft):
    model = BuildJob(features=limits() + [Feature("s", "sketch-circle", {"radius_mm": 10, "center_mm": [50, 50]}),
        Feature("cut", "pocket", {"body_id": "bottom", "target_body_ids": ["bottom", "top"], "operation": "cut", "region_mode": True,
            "profiles": ["s"], "profile_regions": ["s"], "end_type": "symmetric-through-all", "distance_mm": 1, "draft_angle_deg": draft})], preview_feature_id="cut")
    for reversed in [False, True]:
        model.features[-1].parameters["reversed"] = reversed
        result = engine.build(model)
        assert not result.diagnostics, result.diagnostics
        expected = [cone(10, 3, draft, 20), cone(10, 3, draft, 30)]
        assert [b.id for b in result.bodies] == ["bottom", "top"]
        for body, removed in zip(result.bodies, expected):
            assert body.volume_mm3 == pytest.approx(30000 - removed)
        assert sum(b["volume_mm3"] for b in result.preview["removed"]) == pytest.approx(sum(expected))


@pytest.mark.parametrize("operation,end", [("cut", "through-all"), ("intersect", "through-all"), ("cut", "symmetric-through-all")])
def test_oblique_through_all_keeps_hole_section_and_scoped_preview(engine, operation, end):
    model = BuildJob(features=limits() + [Feature("s", "sketch-circle", {"radius_mm": 2, "center_mm": [50, 50]}),
        Feature("cut", "pad", {"body_id": "top", "operation": operation, "region_mode": True,
            "profiles": ["s"], "profile_regions": ["s"], "end_type": end, "distance_mm": 1,
            "direction_vector": [.6, 0, .8], "reversed": operation == "cut"})], preview_feature_id="cut")
    result = engine.build(model)
    assert not result.diagnostics, result.diagnostics
    body = next(b for b in result.bodies if b.id == "top")
    # Oblique extrusion of a horizontal circle retains a circular XY section.
    removed = 12 * math.pi
    # The retained large solid and the small removed tool have different
    # native mass-property integration error; check the removed tool directly.
    assert body.volume_mm3 == pytest.approx(30000 - removed if operation == "cut" else removed, rel=1e-6, abs=1e-4)
    if operation == "cut":
        assert sum(b["volume_mm3"] for b in result.preview["removed"]) == pytest.approx(removed, abs=1e-4)


@pytest.mark.parametrize("extra", [
    {"direction_vector": [1, 0, 0]}, {"direction_vector": [1, 0, 1]},
    {"direction_vector": [float("nan"), 0, 1]}, {"direction_vector": [False, 0, 1]},
    {"direction_vector": [.6, 0, .8], "draft_angle_deg": 5},
    {"direction_vector": [.6, 0, .8], "second_end": {"end_type": "blind", "distance_mm": 5, "draft_angle_deg": 5}},
    {"end_type": "symmetric-through-all", "second_end": {"end_type": "blind", "distance_mm": 5}},
])
def test_invalid_direction_fails_and_recovers(engine, extra):
    model = replace(part(**extra), preview_feature_id="e")
    result = engine.build(model)
    assert result.diagnostics and not result.bodies and result.preview is None
    assert engine.export(model, {"format": "step"})["status"] == "error"
    assert not engine.build(part()).diagnostics


def test_oblique_polygon_to_tilted_plane_matches_analytic_volume(engine):
    model = tilted_job(height=10, slope=.5)
    model.features[-2] = Feature("circle", "sketch-polygon", {"points_mm": [[-2,-2],[2,-2],[2,2],[-2,2]]})
    model.features[-1].parameters.update(direction_vector=[.6, 0, .8], end_offset_mm=2)
    result = engine.build(model)
    assert not result.diagnostics, result.diagnostics
    assert result.bodies[-1].volume_mm3 == pytest.approx(16 * .8 * 18, abs=1e-6)


def test_oblique_ring_on_relocated_yz_sketch_and_independent_depths(engine):
    frame = {"originMillimeters": [7, 11, 20], "normal": [1, 0, 0], "xDirection": [0, 1, 0]}
    model = BuildJob(features=[Feature("outer", "sketch-circle", {"radius_mm": 5, "frame": frame}),
        Feature("inner", "sketch-circle", {"radius_mm": 2, "frame": frame}),
        Feature("e", "pad", {"body_id": "ring", "operation": "new", "region_mode": True,
            "profiles": ["outer"], "profile_regions": ["outer", "inner"], "distance_mm": 10,
            "direction_vector": [.8, 0, .6], "starting_offset_mm": 2,
            "second_end": {"end_type": "blind", "distance_mm": 3}})])
    result = engine.build(model)
    assert not result.diagnostics, result.diagnostics
    assert result.bodies[0].volume_mm3 == pytest.approx(math.pi * 21 * 13 * .8)
    assert min(result.bodies[0].vertices[0::3]) == pytest.approx(7 - .8)
    assert max(result.bodies[0].vertices[0::3]) == pytest.approx(7 + 12 * .8)


def test_next_does_not_reject_tilted_geometry_after_the_first_complete_stop(engine):
    model = tilted_job(height=20)
    model.features[:0] = [Feature("near-s", "sketch-rectangle", {"width_mm": 30, "height_mm": 30, "offset_mm": 5}),
        Feature("near", "pad", {"profile": "near-s", "operation": "new", "body_id": "near", "distance_mm": 2})]
    model.features[-2].parameters["center_mm"] = [3, 3]
    model.features[-1].parameters.update(end_type="up-to-next", direction_vector=[.6, 0, .8])
    result = engine.build(model)
    assert not result.diagnostics, result.diagnostics
    assert result.bodies[-1].volume_mm3 == pytest.approx(math.pi * 4 * 5)


def test_symmetric_through_all_intersect_retains_both_sides_of_one_part(engine):
    model = BuildJob(features=[Feature("base-s", "sketch-rectangle", {"width_mm": 20, "height_mm": 20, "offset_mm": -5}),
        Feature("base", "pad", {"profile": "base-s", "operation": "new", "body_id": "part", "distance_mm": 10}),
        Feature("s", "sketch-circle", {"radius_mm": 2, "center_mm": [10, 10]}),
        Feature("e", "pad", {"body_id": "part", "operation": "intersect", "region_mode": True, "profiles": ["s"], "profile_regions": ["s"],
            "end_type": "symmetric-through-all", "distance_mm": 1, "starting_offset_mm": 1})])
    result = engine.build(model)
    assert not result.diagnostics, result.diagnostics
    assert result.bodies[0].volume_mm3 == pytest.approx(40 * math.pi)
    assert min(result.bodies[0].vertices[2::3]) == pytest.approx(-5)
    assert max(result.bodies[0].vertices[2::3]) == pytest.approx(5)
