"""Tapered extrusion acceptance against analytic geometry and exact exchange."""
import math
from dataclasses import replace

import pytest
from aether_freecad import BuildJob, Feature, FreeCADEngine


@pytest.fixture(scope="module")
def engine():
    with FreeCADEngine() as instance:
        yield instance


def cone_volume(radius, depth, angle, offset=0):
    slope = math.tan(math.radians(angle))
    low, high = offset, offset + depth
    return math.pi * (radius**2 * depth - radius * slope * (high**2 - low**2)
                      + slope**2 * (high**3 - low**3) / 3)


def job(angle=5, offset=0, reversed=False, shape="circle", **extra):
    sketch = Feature("s", "sketch-circle", {"radius_mm": 10})
    if shape == "rectangle":
        sketch = Feature("s", "sketch-rectangle", {"width_mm": 20, "height_mm": 20})
    sketches = [sketch]
    if shape == "ring":
        sketches.append(Feature("inner", "sketch-circle", {"radius_mm": 3}))
    parameters = {"body_id": "part", "operation": "new", "region_mode": True, "profiles": ["s"],
                  "profile_regions": [s.id for s in sketches], "distance_mm": 10,
                  "draft_angle_deg": angle, "starting_offset_mm": offset, "reversed": reversed}
    parameters.update(extra)
    return BuildJob(features=sketches + [Feature("extrude", "pad", parameters)])


@pytest.mark.parametrize("shape", ["circle", "rectangle", "ring"])
@pytest.mark.parametrize("angle,offset,reversed", [(5, 0, False), (-5, 0, False), (5, 3, False), (5, -3, True)])
def test_neutral_sketch_plane_and_material_boundaries(engine, shape, angle, offset, reversed):
    result = engine.build(job(angle, offset, reversed, shape))
    assert not result.diagnostics, result.diagnostics
    assert [b.id for b in result.bodies] == ["part"]
    slope = math.tan(math.radians(angle))
    low, high = offset, offset + 10
    expected = cone_volume(10, 10, angle, offset)
    if shape == "ring":
        expected -= cone_volume(3, 10, -angle, offset)
    elif shape == "rectangle":
        expected = 4000 - 40 * slope * (high**2 - low**2) + 4 * slope**2 * (high**3 - low**3) / 3
    body = result.bodies[0]
    assert body.volume_mm3 == pytest.approx(expected)
    assert min(body.vertices[2::3]) == pytest.approx(-high if reversed else low)
    assert max(body.vertices[2::3]) == pytest.approx(-low if reversed else high)


def test_tilted_sketch_and_upstream_edit_keep_identity(engine):
    model = job()
    model.features[0].parameters["frame"] = {"originMillimeters": [7, 11, 20], "normal": [0, 1, 0], "xDirection": [1, 0, 0]}
    first = engine.build(model)
    assert not first.diagnostics, first.diagnostics
    assert min(first.bodies[0].vertices[1::3]) == pytest.approx(11)
    assert max(first.bodies[0].vertices[1::3]) == pytest.approx(21)
    model.features[0].parameters["radius_mm"] = 12
    edited = engine.build(model)
    assert not edited.diagnostics, edited.diagnostics
    assert edited.bodies[0].id == first.bodies[0].id
    assert edited.bodies[0].volume_mm3 == pytest.approx(cone_volume(12, 10, 5))


@pytest.mark.parametrize("operation", ["add", "cut", "intersect"])
def test_exact_boolean_and_colored_preview(engine, operation):
    model = job()
    base = [Feature("base-s", "sketch-rectangle", {"width_mm": 20, "height_mm": 20}),
            Feature("base", "pad", {"profile": "base-s", "body_id": "part", "operation": "new", "distance_mm": 10}),
            Feature("other-s", "sketch-circle", {"radius_mm": 2, "center_mm": [40, 0]}),
            Feature("other", "pad", {"profile": "other-s", "body_id": "other", "operation": "new", "distance_mm": 10})]
    model.features[0].parameters.update(radius_mm=4, center_mm=[10, 10], offset_mm=0 if operation == "intersect" else 10)
    model.features[-1].parameters.update(operation=operation)
    if operation == "cut":
        model.features[-1] = Feature("extrude", "pocket", model.features[-1].parameters)
    model = replace(model, features=base + model.features, preview_feature_id="extrude")
    result = engine.build(model)
    assert not result.diagnostics, result.diagnostics
    assert [b.id for b in result.bodies] == ["part", "other"]
    assert result.bodies[1].volume_mm3 == pytest.approx(40 * math.pi)
    tool = cone_volume(4, 10, 5)
    expected = {"add": 4000 + tool, "cut": 4000 - tool, "intersect": tool}[operation]
    assert result.bodies[0].volume_mm3 == pytest.approx(expected)
    volumes = {role: sum(b["volume_mm3"] for b in result.preview[role]) for role in ("added", "removed")}
    assert volumes["added"] == pytest.approx(tool if operation == "add" else 0)
    assert volumes["removed"] == pytest.approx(0 if operation == "add" else 4000 - expected)


@pytest.mark.parametrize("angle,shape,extra", [
    (70, "circle", {}), (70, "rectangle", {}), (30, "ring", {}), (-30, "ring", {}),
    (5, "circle", {"starting_offset_mm": 120}),
    (5, "circle", {"end_type": "up-to-next"}),
    (90, "circle", {}), (float("nan"), "circle", {}), (True, "circle", {}),
])
def test_invalid_tapers_never_leave_partial_geometry_and_worker_recovers(engine, angle, shape, extra):
    model = job(angle=angle, shape=shape, **extra)
    model = replace(model, preview_feature_id="extrude")
    result = engine.build(model)
    assert result.diagnostics and result.diagnostics[0]["feature_id"] == "extrude"
    assert result.bodies == [] and result.preview is None
    assert engine.export(model, {"format": "step"})["status"] == "error"
    assert engine.build(job()).diagnostics == []


def test_step_roundtrip_and_zero_draft_compatibility(engine):
    assert "extrude-draft" in engine.describe()["capabilities"]
    model = job(angle=-8, offset=2, shape="ring")
    body = engine.build(model).bodies[0]
    exported = engine.export(model, {"format": "step", "body_ids": [body.id]})
    assert exported["status"] == "ok", exported
    restored = engine.build(BuildJob(features=[Feature("import", "import-step", {
        "body_id": "restored", "operation": "new", "data_base64": exported["data_base64"]})]))
    assert not restored.diagnostics, restored.diagnostics
    assert restored.bodies[0].volume_mm3 == pytest.approx(body.volume_mm3)
    assert engine.build(job(angle=0, end_type="symmetric")).bodies[0].volume_mm3 == pytest.approx(math.pi * 1000)


def test_old_prism_route_cannot_silently_drop_draft(engine):
    result = engine.build(BuildJob(features=[Feature("s", "sketch-circle", {"radius_mm": 10}),
        Feature("e", "pad", {"profile": "s", "operation": "new", "distance_mm": 10, "draft_angle_deg": 5})]))
    assert result.bodies == []
    assert "region-aware" in result.diagnostics[0]["message"]


def test_scoped_draft_cut_uses_one_neutral_plane_for_both_parts(engine):
    features = []
    for name, height in [("lower", 0), ("upper", 10), ("other", 30)]:
        features.extend([Feature(name + "-s", "sketch-rectangle", {"width_mm": 20, "height_mm": 20, "offset_mm": height}),
                         Feature(name, "pad", {"profile": name + "-s", "operation": "new", "body_id": name, "distance_mm": 5})])
    features.extend([Feature("bore", "sketch-circle", {"radius_mm": 4, "center_mm": [10, 10], "offset_mm": 15}),
                     Feature("cut", "pocket", {"operation": "cut", "body_id": "lower", "target_body_ids": ["lower", "upper"],
                         "region_mode": True, "profiles": ["bore"], "profile_regions": ["bore"], "distance_mm": 15, "draft_angle_deg": 5})])
    result = engine.build(BuildJob(features=features, preview_feature_id="cut"))
    assert not result.diagnostics, result.diagnostics
    assert [b.id for b in result.bodies] == ["lower", "upper", "other"]
    removed = [cone_volume(4, 5, 5, 10), cone_volume(4, 5, 5), 0]
    for body, volume in zip(result.bodies, removed):
        assert body.volume_mm3 == pytest.approx(2000 - volume)
    assert sum(b["volume_mm3"] for b in result.preview["removed"]) == pytest.approx(sum(removed))


@pytest.mark.parametrize('radius',[.1,1,3])
@pytest.mark.parametrize('angle',[3,-3])
def test_small_circular_draft_uses_exact_radius_in_a_tilted_plane(engine,radius,angle):
    model=job(angle,offset=radius*.3)
    model.features[0].parameters.update(radius_mm=radius,frame={'originMillimeters':[7,11,20],'normal':[0,1,0],'xDirection':[1,0,0]})
    model.features[-1].parameters['distance_mm']=2*radius
    result=engine.build(model)
    assert not result.diagnostics,result.diagnostics
    assert result.bodies[0].volume_mm3==pytest.approx(cone_volume(radius,2*radius,angle,radius*.3),rel=1e-6)
