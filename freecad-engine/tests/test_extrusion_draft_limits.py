"""Drafted limits measured against analytic conic sections, not display meshes."""
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


def oblique_cone(radius, height, angle, slope=0, low=0):
    t = math.tan(math.radians(angle))
    # Integrating the cone from the sketch to z=height+slope*x.
    return math.pi / (3 * t) * (radius**3 - (radius - t * height)**3 / (1 - (slope * t)**2)**1.5) - cone(radius, low, angle)


@pytest.mark.parametrize("angle,height,slope,start,end,reversed", [
    (3, 20, .5, 0, 0, False), (-3, 20, .5, 0, 0, False),
    (4, 20, -.5, 2, 3, True), (3, 20, 2, -1, -2, False),
    (5, 22.8, 2, 0, 0, False), # valid stop close to apex: initial tool guess collapses
    (5, 10, 0, 2, 1, False),
])
def test_plane_draft_analytic_volume_and_actual_cap(engine, angle, height, slope, start, end, reversed):
    job = tilted_job(height=height, slope=slope, start=start, end=end, reversed=reversed)
    job.features[-1].parameters["draft_angle_deg"] = angle
    result = engine.build(job)
    assert not result.diagnostics, result.diagnostics
    body = next(b for b in result.bodies if b.id == "result")
    h = (40 - height if reversed else height) - end
    assert body.volume_mm3 == pytest.approx(oblique_cone(2, h, angle, slope, start), abs=1e-5)
    beginning = 40 - start if reversed else start
    shift = end if reversed else -end
    vertices = list(zip(*[iter(body.vertices)] * 3))
    sign = -1 if reversed else 1
    assert all(sign * (z - beginning) >= -1e-5 and sign * (z - height - slope * x - shift) <= 1e-5 for x, y, z in vertices)
    assert sum(abs(z - height - slope * x - shift) < 1e-5 for x, y, z in vertices) >= 3


def test_tilted_drafted_hole_and_step(engine):
    job = tilted_job(height=5)
    job.features.insert(-1, Feature("hole", "sketch-circle", {"radius_mm": 1}))
    job.features[-1].parameters.update(draft_angle_deg=3, profile_regions=["circle", "hole"])
    expected = oblique_cone(2, 5, 3, .5) - oblique_cone(1, 5, -3, .5)
    result = engine.build(job)
    assert not result.diagnostics, result.diagnostics
    assert next(b for b in result.bodies if b.id == "result").volume_mm3 == pytest.approx(expected, abs=1e-5)
    exported = engine.export(job, {"format": "step", "body_ids": ["result"]})
    assert exported["status"] == "ok", exported
    after = engine.build(BuildJob(features=[Feature("import", "import-step", {"data_base64": exported["data_base64"], "operation": "new", "body_id": "restored"})]))
    assert not after.diagnostics
    assert after.bodies[0].volume_mm3 == pytest.approx(expected, abs=1e-4)


@pytest.mark.parametrize("end_type", ["up-to-face", "up-to-next"])
def test_independent_drafted_stops_update_and_preview(engine, end_type):
    model = part(end_type=end_type, end_offset_mm=2, draft_angle_deg=5,
        end_reference={"sourceFeatureId": "top", "bodyId": "top", "normal": [0, 0, -1]},
        second_end={"end_type": end_type, "distance_mm": 1, "draft_angle_deg": -3, "end_offset_mm": 1,
                    "end_reference": {"sourceFeatureId": "bottom", "bodyId": "bottom", "normal": [0, 0, 1]}})
    model.features[0].parameters["center_mm"] = [50, 50]
    model.features[:0] = limits()
    model = replace(model, preview_feature_id="e")
    for z in [-23, -33]:
        model.features[0].parameters["offset_mm"] = z
        result = engine.build(model)
        assert not result.diagnostics, result.diagnostics
        expected = cone(10, 28, 5) + cone(10, -z - 4, -3)
        assert next(b for b in result.bodies if b.id == "part").volume_mm3 == pytest.approx(expected)
        assert sum(b["volume_mm3"] for b in result.preview["added"]) == pytest.approx(expected)


@pytest.mark.parametrize("operation", ["cut", "intersect"])
def test_through_all_draft_near_apex_and_preview(engine, operation):
    # Old 1 mm tool overshoot would cross the apex (22.86 mm), despite a sound cut.
    height = 22.8
    model = BuildJob(features=[Feature("base-s", "sketch-rectangle", {"width_mm": 20, "height_mm": 20}),
        Feature("base", "pad", {"profile": "base-s", "distance_mm": height, "operation": "new", "body_id": "plate"}),
        Feature("s", "sketch-circle", {"radius_mm": 2, "center_mm": [10, 10]}),
        Feature("result", "pad", {"body_id": "plate", "operation": operation, "region_mode": True,
            "profiles": ["s"], "profile_regions": ["s"], "distance_mm": 1, "end_type": "through-all", "draft_angle_deg": 5, "reversed": operation == "cut"})], preview_feature_id="result")
    result = engine.build(model)
    assert not result.diagnostics, result.diagnostics
    tool = cone(2, height, 5)
    assert result.bodies[0].volume_mm3 == pytest.approx(400 * height - tool if operation == "cut" else tool)
    assert sum(b["volume_mm3"] for b in result.preview["removed"]) == pytest.approx(tool if operation == "cut" else 400 * height - tool)


@pytest.mark.parametrize("height,slope,angle", [(.5, .5, 5), (24, .5, 5), (20, 20, -5)])
def test_invalid_stop_fails_atomically_and_recovers(engine, height, slope, angle):
    job = tilted_job(height=height, slope=slope)
    job.features[-1].parameters["draft_angle_deg"] = angle
    result = engine.build(job)
    assert result.diagnostics and [b.id for b in result.bodies] == ["stop"]
    assert engine.export(job, {"format": "step"})["status"] == "error"
    assert not engine.build(part(draft_angle_deg=5)).diagnostics


@pytest.mark.parametrize("radius,angle,valid", [(5, 5, True), (4, -5, False), (5, 0, False)])
def test_next_face_covers_actual_tapered_section(engine, radius, angle, valid):
    model = BuildJob(features=[
        Feature("stop-s", "sketch-rectangle", {"width_mm": 8.4, "height_mm": 8.4, "offset_mm": 10}),
        Feature("stop", "pad", {"profile": "stop-s", "distance_mm": 2, "operation": "new", "body_id": "stop"}),
        Feature("s", "sketch-circle", {"radius_mm": radius, "center_mm": [4.2, 4.2]}),
        Feature("e", "pad", {"body_id": "part", "operation": "new", "region_mode": True,
            "profiles": ["s"], "profile_regions": ["s"], "distance_mm": 1, "end_type": "up-to-next", "draft_angle_deg": angle})])
    result = engine.build(model)
    if valid:
        assert not result.diagnostics, result.diagnostics
        assert result.bodies[-1].volume_mm3 == pytest.approx(cone(radius, 10, angle))
    else:
        assert result.diagnostics and [b.id for b in result.bodies] == ["stop"]
        assert "cover" in result.diagnostics[0]["message"]


def test_next_never_skips_a_tilted_obstacle_for_a_later_parallel_stop(engine):
    job = tilted_job(height=5)
    job.features[0] = Feature("limit-sketch", "sketch-polygon", {"points_mm": [[-50,-50],[50,-50],[50,50],[-50,50]], "frame": job.features[0].parameters["frame"]})
    job.features[:0] = [Feature("far-s", "sketch-rectangle", {"width_mm": 20, "height_mm": 20, "offset_mm": 10}),
        Feature("far", "pad", {"profile": "far-s", "distance_mm": 2, "operation": "new", "body_id": "far"})]
    job.features[-1].parameters.update(end_type="up-to-next", draft_angle_deg=3)
    result = engine.build(job)
    assert not result.diagnostics, result.diagnostics
    assert result.bodies[-1].volume_mm3 == pytest.approx(oblique_cone(2,5,3,.5),abs=1e-5)
    assert [b.id for b in result.bodies] == ["far", "stop", "result"]

def test_scoped_through_all_uses_independent_draft_on_both_sides(engine):
    model = BuildJob(features=limits() + [Feature("s", "sketch-circle", {"radius_mm": 10, "center_mm": [50, 50]}),
        Feature("cut", "pocket", {"body_id": "bottom", "target_body_ids": ["bottom", "top"], "operation": "cut", "region_mode": True,
            "profiles": ["s"], "profile_regions": ["s"], "end_type": "through-all", "distance_mm": 1, "draft_angle_deg": 5, "reversed": True,
            "second_end": {"end_type": "through-all", "distance_mm": 1, "draft_angle_deg": -3}})], preview_feature_id="cut")
    result = engine.build(model)
    assert not result.diagnostics, result.diagnostics
    removed = [cone(10, 3, -3, 20), cone(10, 3, 5, 30)]
    for body, volume in zip(result.bodies, removed):
        assert body.volume_mm3 == pytest.approx(30000 - volume)
    assert sum(b["volume_mm3"] for b in result.preview["removed"]) == pytest.approx(sum(removed))
    assert "extrude-drafted-limits" in engine.describe()["capabilities"]
