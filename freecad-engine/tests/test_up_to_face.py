"""An explicit stopping face must rebuild from its source and never fall back."""
import math
import pytest
from aether_freecad import BuildJob, Feature, FreeCADEngine


@pytest.fixture(scope="module")
def engine():
    with FreeCADEngine() as instance:
        yield instance


def job(height=20, end_offset=0, start_offset=0, normal=None, center=None):
    return BuildJob(features=[
        Feature("limit-sketch", "sketch-rectangle", {"width_mm": 20, "height_mm": 20, "offset_mm": height}),
        Feature("limit", "pad", {"profile": "limit-sketch", "distance_mm": 3, "operation": "new", "body_id": "stop"}),
        Feature("circle", "sketch-circle", {"radius_mm": 2, "center_mm": center or [10, 10]}),
        Feature("result", "pad", {"body_id": "result", "operation": "new", "region_mode": True, "profiles": ["circle"], "profile_regions": ["circle"], "distance_mm": 1,
            "end_type": "up-to-face", "starting_offset_mm": start_offset, "end_offset_mm": end_offset,
            "end_reference": {"sourceFeatureId": "limit", "bodyId": "stop", "normal": normal or [0, 0, -1], "label": "Underside"}}),
    ])


@pytest.mark.parametrize("height,end_offset,start_offset", [(20, 0, 0), (35, 2, 0), (20, -2, 0), (20, 0, 3)])
def test_exact_referenced_depth_and_offsets(engine, height, end_offset, start_offset):
    result = engine.build(job(height, end_offset, start_offset))
    assert result.diagnostics == []
    body = next(b for b in result.bodies if b.id == "result")
    assert body.volume_mm3 == pytest.approx(math.pi * 4 * (height - end_offset - start_offset), abs=1e-5)
    assert max(body.vertices[2::3]) == pytest.approx(height - end_offset)
    assert min(body.vertices[2::3]) == pytest.approx(start_offset)


@pytest.mark.parametrize("invalid", [{"height": -10}, {"normal": [1, 0, 0]}, {"end_offset": 25}, {"start_offset": 25}])
def test_rejects_behind_parallel_direction_or_empty_stop(engine, invalid):
    result = engine.build(job(**invalid))
    assert any(d["feature_id"] == "result" and d["severity"] == "error" for d in result.diagnostics)
    assert engine.export(job(**invalid), {"format": "step"})["status"] == "error"
    assert engine.build(job()).diagnostics == []


def test_reference_missing_and_step_roundtrip(engine):
    missing = job()
    missing.features[-1].parameters["end_reference"]["sourceFeatureId"] = "deleted"
    assert any("reference is unavailable" in d["message"] for d in engine.build(missing).diagnostics)
    exported = engine.export(job(), {"format": "step", "body_ids": ["result"]})
    assert exported["status"] == "ok"
    restored = engine.build(BuildJob(features=[Feature("import", "import-step", {"data_base64": exported["data_base64"], "operation": "new", "body_id": "roundtrip"})]))
    assert restored.diagnostics == []
    assert restored.bodies[0].volume_mm3 == pytest.approx(80 * math.pi, abs=1e-4)


def test_referenced_remove_preserves_wall_to_target_bottom_face(engine):
    features = [
        Feature("outline", "sketch-rectangle", {"width_mm": 20, "height_mm": 20}),
        Feature("base", "pad", {"profile": "outline", "distance_mm": 10, "operation": "new", "body_id": "plate"}),
        Feature("circle", "sketch-circle", {"radius_mm": 2, "center_mm": [10, 10], "offset_mm": 10}),
        Feature("bore", "pocket", {"body_id": "plate", "operation": "cut", "region_mode": True, "profiles": ["circle"], "profile_regions": ["circle"], "depth_mm": 1,
            "end_type": "up-to-face", "end_offset_mm": 2,
            "end_reference": {"sourceFeatureId": "base", "bodyId": "plate", "normal": [0, 0, -1], "label": "Bottom"}}),
    ]
    result = engine.build(BuildJob(features=features))
    assert result.diagnostics == []
    assert len(result.bodies) == 1
    assert result.bodies[0].id == "plate"
    assert result.bodies[0].volume_mm3 == pytest.approx(4000 - math.pi * 4 * 8, abs=1e-5)


@pytest.mark.parametrize("center", [[0, 0], [40, 40]])
def test_stop_uses_infinite_plane_outside_face_boundary(engine, center):
    result = engine.build(job(center=center))
    assert result.diagnostics == []
    assert next(b for b in result.bodies if b.id == "result").volume_mm3 == pytest.approx(80 * math.pi, abs=1e-5)


def tilted_job(height=20, center=0, start=0, end=0, reversed=False, slope=0.5):
    c = 1 / math.sqrt(1 + slope * slope)
    normal = [-slope * c, 0, c]
    frame = {"originMillimeters": [0, 0, height], "xDirection": [c, 0, slope * c], "normal": normal}
    return BuildJob(features=[
        Feature("limit-sketch", "sketch-rectangle", {"width_mm": 2, "height_mm": 2, "frame": frame}),
        Feature("limit", "pad", {"profile": "limit-sketch", "distance_mm": 1, "operation": "new", "body_id": "stop"}),
        Feature("circle", "sketch-circle", {"radius_mm": 2, "center_mm": [center, 0], "offset_mm": 40 if reversed else 0}),
        Feature("result", "pad", {"body_id": "result", "operation": "new", "region_mode": True, "profiles": ["circle"], "profile_regions": ["circle"], "distance_mm": 1,
            "end_type": "up-to-face", "starting_offset_mm": start, "end_offset_mm": end, "reversed": reversed,
            "end_reference": {"sourceFeatureId": "limit", "bodyId": "stop", "normal": [-v for v in normal], "label": "Tilted underside"}}),
    ])


@pytest.mark.parametrize("height,center,start,end,reversed,slope", [
    (20, 0, 0, 0, False, 0.5), (30, 10, 3, 2, False, 0.5),
    (20, 0, 0, -2, False, -0.5), (20, 0, 2, 3, True, 0.5),
    (20, 0, 0, 0, False, 2),
])
def test_tilted_infinite_stop_exact_volume_and_vertices(engine, height, center, start, end, reversed, slope):
    result = engine.build(tilted_job(height, center, start, end, reversed, slope))
    assert result.diagnostics == []
    body = next(b for b in result.bodies if b.id == "result")
    distance = (40 - height - slope * center) if reversed else height + slope * center
    assert body.volume_mm3 == pytest.approx(math.pi * 4 * (distance - start - end), abs=1e-5)
    vertices = list(zip(*[iter(body.vertices)] * 3))
    beginning = 40 - start if reversed else start
    end_shift = end if reversed else -end
    assert all(abs(z - beginning) < 1e-5 or abs(z - (height + slope * x + end_shift)) < 1e-5 for x, y, z in vertices)


def test_tilted_stop_crossing_profile_fails_and_recovers(engine):
    invalid = tilted_job(height=0.5)
    result = engine.build(invalid)
    assert any(d["feature_id"] == "result" and "crosses" in d["message"] for d in result.diagnostics)
    assert engine.export(invalid, {"format": "step"})["status"] == "error"
    assert engine.build(tilted_job()).diagnostics == []


def test_tilted_stop_step_roundtrip(engine):
    exported = engine.export(tilted_job(), {"format": "step", "body_ids": ["result"]})
    assert exported["status"] == "ok"
    imported = engine.build(BuildJob(features=[Feature("import", "import-step", {"data_base64": exported["data_base64"], "operation": "new", "body_id": "roundtrip"})]))
    assert imported.diagnostics == []
    assert imported.bodies[0].volume_mm3 == pytest.approx(80 * math.pi, abs=1e-4)


def test_tilted_stop_preserves_nested_profile_hole(engine):
    request = tilted_job()
    request.features.insert(-1, Feature("inner", "sketch-circle", {"radius_mm": 1}))
    request.features[-1].parameters["profile_regions"] = ["circle", "inner"]
    result = engine.build(request)
    assert result.diagnostics == []
    assert next(b for b in result.bodies if b.id == "result").volume_mm3 == pytest.approx(60 * math.pi, abs=1e-5)


def test_tilted_stop_removes_only_material_before_plane(engine):
    request = tilted_job(height=5, center=10, reversed=True)
    # Add a target block; cut from its top at Z=40 to Z=5+X/2.
    request.features[0:0] = [
        Feature("base-outline", "sketch-rectangle", {"width_mm": 20, "height_mm": 20}),
        Feature("base", "pad", {"profile": "base-outline", "distance_mm": 40, "operation": "new", "body_id": "plate"}),
    ]
    request.features[-2].parameters["center_mm"] = [10, 10]
    request.features[-1] = Feature("result", "pocket", request.features[-1].parameters)
    request.features[-1].parameters.update({"body_id": "plate", "operation": "cut", "reversed": False})
    result = engine.build(request)
    assert result.diagnostics == []
    assert next(b for b in result.bodies if b.id == "plate").volume_mm3 == pytest.approx(16000 - math.pi * 4 * 30, abs=1e-5)
