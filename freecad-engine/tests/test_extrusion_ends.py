"""Independent end conditions, native limits and sketch-neutral draft."""
import math

import pytest
from aether_freecad import BuildJob, Feature, FreeCADEngine


@pytest.fixture(scope="module")
def engine():
    with FreeCADEngine() as instance:
        yield instance


def cone(radius, depth, angle=0, low=0):
    t = math.tan(math.radians(angle))
    high = low + depth
    return math.pi * (radius**2 * depth - radius * t * (high**2 - low**2) + t**2 * (high**3 - low**3) / 3)


def part(**options):
    return BuildJob(features=[Feature("s", "sketch-circle", {"radius_mm": 10}), Feature("e", "pad", {
        "body_id": "part", "operation": "new", "region_mode": True, "profiles": ["s"], "profile_regions": ["s"],
        "distance_mm": 10, **options})])


@pytest.mark.parametrize("first,second,offset,reversed", [(0, 0, 0, False), (5, -7, 0, False), (5, 5, 3, False), (-5, 7, -2, True)])
def test_independent_angles_depth_and_common_start(engine, first, second, offset, reversed):
    result = engine.build(part(draft_angle_deg=first, starting_offset_mm=offset, reversed=reversed,
        second_end={"end_type": "blind", "distance_mm": 5, "draft_angle_deg": second}))
    assert not result.diagnostics, result.diagnostics
    assert [b.id for b in result.bodies] == ["part"]
    body = result.bodies[0]
    assert body.volume_mm3 == pytest.approx(cone(10, 10, first, offset) + cone(10, 5, second, -offset))
    assert min(body.vertices[2::3]) == pytest.approx(-(offset + 10) if reversed else offset - 5)
    assert max(body.vertices[2::3]) == pytest.approx(5 - offset if reversed else offset + 10)


def test_symmetric_draft_and_legacy_opposite_depth(engine):
    symmetric = engine.build(part(end_type="symmetric", draft_angle_deg=5))
    assert not symmetric.diagnostics, symmetric.diagnostics
    assert symmetric.bodies[0].volume_mm3 == pytest.approx(2 * cone(10, 5, 5))
    assert min(symmetric.bodies[0].vertices[2::3]) == pytest.approx(-5)
    assert max(symmetric.bodies[0].vertices[2::3]) == pytest.approx(5)
    legacy = engine.build(part(second_distance_mm=5, draft_angle_deg=5))
    assert not legacy.diagnostics, legacy.diagnostics
    assert legacy.bodies[0].volume_mm3 == pytest.approx(cone(10, 10, 5) + cone(10, 5))


def limits():
    features = []
    for name, z in [("bottom", -23), ("top", 30)]:
        features.extend([Feature(name + "-s", "sketch-rectangle", {"width_mm": 100, "height_mm": 100, "offset_mm": z}),
            Feature(name, "pad", {"profile": name + "-s", "distance_mm": 3, "operation": "new", "body_id": name})])
    return features


@pytest.mark.parametrize("primary,second", [("blind", "up-to-face"), ("up-to-face", "up-to-face"), ("up-to-next", "up-to-next")])
def test_distinct_stopping_planes_offsets_and_rebuild(engine, primary, second):
    model = part(end_type=primary, end_offset_mm=2 if primary != "blind" else 0,
        end_reference={"sourceFeatureId": "top", "bodyId": "top", "normal": [0, 0, -1]},
        second_end={"end_type": second, "distance_mm": 1, "end_offset_mm": 1,
                    "end_reference": {"sourceFeatureId": "bottom", "bodyId": "bottom", "normal": [0, 0, 1]}})
    model.features[0].parameters["center_mm"] = [50, 50]
    model.features[:0] = limits()
    for z in [-23, -33]:
        model.features[0].parameters["offset_mm"] = z
        result = engine.build(model)
        assert not result.diagnostics, result.diagnostics
        body = next(b for b in result.bodies if b.id == "part")
        high = 10 if primary == "blind" else 28
        low = z + 4
        assert body.volume_mm3 == pytest.approx(math.pi * 100 * (high - low))
        assert min(body.vertices[2::3]) == pytest.approx(low)
        assert max(body.vertices[2::3]) == pytest.approx(high)


def test_two_sided_through_all_reaches_parts_on_either_side(engine):
    features = limits() + [Feature("s", "sketch-circle", {"radius_mm": 2, "center_mm": [50, 50]}),
        Feature("cut", "pocket", {"body_id": "bottom", "target_body_ids": ["bottom", "top"], "operation": "cut", "region_mode": True,
            "profiles": ["s"], "profile_regions": ["s"], "end_type": "through-all", "distance_mm": 1,
            "second_end": {"end_type": "through-all", "distance_mm": 1}})]
    result = engine.build(BuildJob(features=features, preview_feature_id="cut"))
    assert not result.diagnostics, result.diagnostics
    assert [b.id for b in result.bodies] == ["bottom", "top"]
    for body in result.bodies:
        assert body.volume_mm3 == pytest.approx(30000 - 12 * math.pi)
    assert sum(b["volume_mm3"] for b in result.preview["removed"]) == pytest.approx(24 * math.pi)


@pytest.mark.parametrize("options", [
    {"second_end": "blind"}, {"second_end": {"end_type": "symmetric", "distance_mm": 4}},
    {"second_end": {"end_type": "blind", "distance_mm": 4}, "second_distance_mm": 2},
    {"second_end": {"end_type": "blind", "distance_mm": 4}, "end_type": "symmetric"},
    {"second_end": {"end_type": "blind", "distance_mm": -1}},
    {"second_end": {"end_type": "blind", "distance_mm": 10, "draft_angle_deg": 70}},
    {"second_end": {"end_type": "up-to-face", "distance_mm": 1}},
    {"second_end": {"end_type": "through-all", "distance_mm": 1}},
])
def test_invalid_second_end_rejects_entire_feature_and_export(engine, options):
    model = part(**options)
    result = engine.build(model)
    assert result.diagnostics and result.bodies == []
    assert engine.export(model, {"format": "step"})["status"] == "error"
    assert not engine.build(part(second_end={"end_type": "blind", "distance_mm": 5})).diagnostics


def test_step_roundtrip_preserves_independent_tapers(engine):
    model = part(draft_angle_deg=5, second_end={"end_type": "blind", "distance_mm": 7, "draft_angle_deg": -8})
    before = engine.build(model)
    assert not before.diagnostics
    exported = engine.export(model, {"format": "step"})
    assert exported["status"] == "ok", exported
    after = engine.build(BuildJob(features=[Feature("import", "import-step", {"data_base64": exported["data_base64"], "operation": "new", "body_id": "restored"})]))
    assert not after.diagnostics
    assert after.bodies[0].volume_mm3 == pytest.approx(before.bodies[0].volume_mm3)
    assert "extrude-independent-ends" in engine.describe()["capabilities"]
