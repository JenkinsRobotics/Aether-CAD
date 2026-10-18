"""Exact thin-wall geometry is checked against independent analytic volumes."""
import math
from dataclasses import replace

import pytest
from aether_freecad import BuildJob, Feature, FreeCADEngine


@pytest.fixture(scope="module")
def engine():
    with FreeCADEngine() as instance:
        yield instance


def profile(kind="line", **placement):
    if kind == "circle":
        return Feature("s", "sketch-circle", {"radius_mm": 10, **placement})
    if kind == "rectangle":
        return Feature("s", "sketch-polygon", {"points_mm": [[0, 0], [20, 0], [20, 10], [0, 10]], **placement})
    points = {"line": [[0, 0], [20, 0]], "L": [[0, 0], [20, 0], [20, 10]],
              "reverse-L": [[20, 10], [20, 0], [0, 0]]}
    if kind == "arc":
        return Feature("s", "sketch-wire", {"start_mm": [10, 0], "segments": [
            {"type": "arc", "middle": [math.sqrt(50), math.sqrt(50)], "end": [0, 10]}], **placement})
    p = points[kind]
    return Feature("s", "sketch-wire", {"start_mm": p[0], "segments": [
        {"type": "line", "end": q} for q in p[1:]], **placement})


def part(kind="line", thin=None, **parameters):
    return BuildJob(features=[profile(kind), Feature("e", "pad", {
        "body_id": "wall", "operation": "new", "region_mode": True,
        "profiles": ["s"], "profile_regions": ["s"], "distance_mm": 10,
        "thin": {"thickness_1_mm": 2, "thickness_2_mm": 1} if thin is None else thin,
        **parameters})], preview_feature_id="e")


@pytest.mark.parametrize("kind,area", [("line", 60), ("L", 93), ("reverse-L", 87),
    ("arc", 15.75 * math.pi), ("circle", 63 * math.pi), ("rectangle", 192)])
def test_exact_open_closed_and_curved_wall_profiles(engine, kind, area):
    job = part(kind)
    result = engine.build(job)
    assert not result.diagnostics, result.diagnostics
    assert result.bodies[0].id == "wall"
    assert result.bodies[0].volume_mm3 == pytest.approx(area * 10, rel=1e-7)
    assert result.preview is not None
    exported = engine.export(job, {"format": "step"})
    assert exported["status"] == "ok"
    imported = engine.build(BuildJob(features=[Feature("import", "import-step", {
        "body_id": "restored", "operation": "new", "data_base64": exported["data_base64"]})]))
    assert not imported.diagnostics
    assert imported.bodies[0].volume_mm3 == pytest.approx(area * 10, abs=1e-5)


@pytest.mark.parametrize("thin,area,center", [
    ({"thickness_1_mm": 2, "thickness_2_mm": 1}, 60, -.5),
    ({"thickness_1_mm": 2, "thickness_2_mm": 1, "flipped": True}, 60, .5),
    ({"thickness_1_mm": 2, "thickness_2_mm": 0}, 40, -1),
    ({"thickness_1_mm": 0, "thickness_2_mm": 2}, 40, 1),
    ({"thickness_1_mm": 2, "thickness_2_mm": 1, "midplane": True, "midplane_thickness_mm": 4}, 80, 0),
])
def test_side_control_and_midplane_have_exact_centers(engine, thin, area, center):
    job = part(thin=thin)
    result = engine.analyze(job, {"kind": "properties"})
    assert result["status"] == "ok", result
    measurement = result["measurements"][0]
    assert measurement["volume_mm3"] == pytest.approx(area * 10)
    assert measurement["center_mm"] == pytest.approx([10, center, 5])


@pytest.mark.parametrize("extra,volume", [
    ({"end_type": "symmetric"}, 600), ({"reversed": True}, 600),
    ({"starting_offset_mm": 7}, 600),
    ({"second_end": {"end_type": "blind", "distance_mm": 2}}, 720),
    ({"direction_vector": [.6, 0, .8]}, 480),
    ({"draft_angle_deg": 5}, 600 - 2300 * math.tan(math.radians(5)) + 4000 / 3 * math.tan(math.radians(5)) ** 2),
])
def test_existing_extrusion_extents_and_draft_use_the_wall_face(engine, extra, volume):
    result = engine.build(part(**extra))
    assert not result.diagnostics, result.diagnostics
    assert result.bodies[0].volume_mm3 == pytest.approx(volume, rel=1e-6)


@pytest.mark.parametrize("operation,volume", [("add", 1600), ("cut", 700), ("intersect", 300)])
def test_wall_operations_modify_exact_target_material(engine, operation, volume):
    job = part(operation=operation, body_id="base", reversed=operation == "cut",
               end_type="blind" if operation == "add" else "through-all")
    job.features[0].parameters.update(offset_mm=5 if operation == "add" else 0, start_mm=[0, 5], segments=[{"type": "line", "end": [20, 5]}])
    job.features[:0] = [Feature("base-s", "sketch-polygon", {"points_mm": [[0, 0], [20, 0], [20, 10], [0, 10]]}),
                         Feature("base-e", "pad", {"profile": "base-s", "distance_mm": 5, "body_id": "base", "operation": "new"})]
    result = engine.build(job)
    assert not result.diagnostics, result.diagnostics
    assert result.bodies[0].id == "base"
    assert result.bodies[0].volume_mm3 == pytest.approx(volume)
    assert result.preview is not None


@pytest.mark.parametrize("end", ["up-to-face", "up-to-next"])
def test_wall_follows_moved_stopping_geometry(engine, end):
    job = part(end_type=end, end_offset_mm=2,
               end_reference={"sourceFeatureId": "stop", "bodyId": "stop", "normal": [0, 0, -1]})
    job.features[:0] = [Feature("stop-s", "sketch-polygon", {"points_mm": [[-30, -30], [30, -30], [30, 30], [-30, 30]], "offset_mm": 20}),
                         Feature("stop", "pad", {"profile": "stop-s", "distance_mm": 3, "body_id": "stop", "operation": "new"})]
    for height in [20, 30]:
        job.features[0].parameters["offset_mm"] = height
        result = engine.build(job)
        assert not result.diagnostics, result.diagnostics
        assert result.bodies[-1].volume_mm3 == pytest.approx(60 * (height-2))


@pytest.mark.parametrize("thin", [{}, {"thickness_1_mm": 0, "thickness_2_mm": 0},
    {"thickness_1_mm": -1, "thickness_2_mm": 2}, {"thickness_1_mm": True, "thickness_2_mm": 2},
    {"thickness_1_mm": float("inf"), "thickness_2_mm": 2},
    {"thickness_1_mm": 1, "thickness_2_mm": 2, "midplane": True},
    {"thickness_1_mm": 1, "thickness_2_mm": 2, "flipped": "yes"}])
def test_bad_wall_input_does_not_publish_geometry_and_recovers(engine, thin):
    result = engine.build(part(thin=thin))
    assert result.diagnostics and not result.bodies and result.preview is None
    assert not engine.build(part()).diagnostics


@pytest.mark.parametrize("thickness", [10, 11, 20])
def test_circular_inner_collapse_is_not_silently_filled(engine, thickness):
    result = engine.build(part("circle", {"thickness_1_mm": 2, "thickness_2_mm": thickness}))
    assert result.diagnostics and not result.bodies and result.preview is None


def test_thin_requires_region_path_and_can_be_placed_on_another_plane(engine):
    assert engine.build(part(region_mode=False)).diagnostics
    job = part()
    job.features[0].parameters["frame"] = {"originMillimeters": [50, 60, 70], "xDirection": [1, 0, 0], "normal": [0, -1, 0]}
    properties = engine.analyze(replace(job, preview_feature_id=None), {"kind": "properties"})
    assert properties["status"] == "ok", properties
    assert properties["measurements"][0]["center_mm"] == pytest.approx([60, 55, 69.5])


def test_cubic_curve_wall_matches_integrated_centerline_length(engine):
    job = part(thin={"thickness_1_mm": 2, "thickness_2_mm": 2})
    job.features[0].parameters.update(start_mm=[0, 0], segments=[{
        "type": "bezier", "controls": [[5, 5], [15, 5]], "end": [20, 0]}])
    # Independent Simpson integration of the cubic derivative. Symmetric offset
    # cancels the signed-curvature area term: wall area = width * curve length.
    def speed(t):
        return math.hypot(15 + 30*t - 30*t*t, 15 - 30*t)
    n = 10000
    length = (speed(0)+speed(1)+sum((4 if i % 2 else 2)*speed(i/n) for i in range(1, n))) / (3*n)
    result = engine.build(job)
    assert not result.diagnostics, result.diagnostics
    assert result.bodies[0].volume_mm3 == pytest.approx(40*length, rel=2e-6)
    exported = engine.export(job, {"format": "step"})
    assert exported["status"] == "ok"
    restored = engine.build(BuildJob(features=[Feature("i", "import-step", {
        "body_id": "restored", "operation": "new", "data_base64": exported["data_base64"]})]))
    assert not restored.diagnostics
    assert restored.bodies[0].volume_mm3 == pytest.approx(40*length, rel=2e-6)



def test_disconnected_profiles_keep_stable_output_ids_after_upstream_edit(engine):
    job = part(separate_bodies=True, profile_keys={"s": "first", "other": "second"},
               profiles=["s", "other"], profile_regions=["s", "other"])
    job.features.insert(1, Feature("other", "sketch-wire", {"start_mm": [0, 20], "segments": [{"type": "line", "end": [20, 20]}]}))
    first = engine.build(job)
    assert not first.diagnostics and len(first.bodies) == 2
    job.features[0].parameters["segments"][0]["end"] = [30, 0]
    changed = engine.build(job)
    assert not changed.diagnostics
    assert [b.id for b in changed.bodies] == [b.id for b in first.bodies]
    assert sorted(b.volume_mm3 for b in changed.bodies) == pytest.approx([600, 900])


@pytest.mark.parametrize("operation", ["cut", "intersect"])
def test_scoped_symmetric_through_all_uses_thin_tool_for_every_target(engine, operation):
    features = []
    for key, z in [("lower", -5), ("upper", 5)]:
        features.extend([Feature(key+'s', 'sketch-polygon', {"points_mm": [[0, 0], [20, 0], [20, 10], [0, 10]], "offset_mm": z}),
            Feature(key, 'pad', {"profile": key+'s', "distance_mm": 2, "operation": "new", "body_id": key})])
    job = part(operation=operation, body_id="lower", target_body_ids=["lower", "upper"], end_type="symmetric-through-all")
    job.features[0].parameters.update(start_mm=[0, 5], segments=[{"type": "line", "end": [20, 5]}])
    job.features[:0] = features
    result = engine.build(job)
    assert not result.diagnostics, result.diagnostics
    assert [b.id for b in result.bodies] == ["lower", "upper"]
    assert [b.volume_mm3 for b in result.bodies] == pytest.approx([280, 280] if operation == 'cut' else [120, 120])
    assert result.preview is not None


def test_crossing_open_boundary_fails_without_preview(engine):
    job = part()
    job.features[0].parameters.update(start_mm=[0, 0], segments=[
        {"type": "line", "end": [20, 20]}, {"type": "line", "end": [0, 20]}, {"type": "line", "end": [20, 0]}])
    result = engine.build(job)
    assert result.diagnostics and not result.bodies and result.preview is None


def test_closed_loop_wall_side_is_independent_of_drawing_winding(engine):
    job = part("rectangle")
    job.features[0].parameters["points_mm"].reverse()
    result = engine.build(job)
    assert not result.diagnostics, result.diagnostics
    assert result.bodies[0].volume_mm3 == pytest.approx(1920)
