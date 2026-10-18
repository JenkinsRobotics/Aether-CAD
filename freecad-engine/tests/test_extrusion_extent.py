import math
import pytest
from aether_freecad import BuildJob, Feature, FreeCADEngine


@pytest.mark.parametrize(
    "mode,offset,second,zmin,zmax",
    [("symmetric", 0, 0, -5, 5), ("blind", 3, 4, -1, 13), ("symmetric", 3, 0, -2, 8)],
)
def test_extrusion_interval(mode, offset, second, zmin, zmax):
    with FreeCADEngine() as engine:
        result = engine.build(
            BuildJob(
                features=[
                    Feature("s", "sketch-circle", {"radius_mm": 2}),
                    Feature(
                        "e",
                        "pad",
                        {
                            "body_id": "b",
                            "operation": "new",
                            "region_mode": True,
                            "profiles": ["s"],
                            "profile_regions": ["s"],
                            "distance_mm": 10,
                            "end_type": mode,
                            "starting_offset_mm": offset,
                            "second_distance_mm": second,
                        },
                    ),
                ]
            )
        )
        assert not result.diagnostics, result.diagnostics
        body = result.bodies[0]
        assert min(body.vertices[2::3]) == pytest.approx(zmin)
        assert max(body.vertices[2::3]) == pytest.approx(zmax)
        assert body.volume_mm3 == pytest.approx(math.pi * 4 * (zmax - zmin))


@pytest.mark.parametrize("height,reversed", [(10, False), (40, False), (40, True)])
def test_through_all_rebuilds_from_current_target(height, reversed):
    with FreeCADEngine() as engine:
        result = engine.build(
            BuildJob(
                features=[
                    Feature("s", "sketch-rectangle", {"width_mm": 20, "height_mm": 20}),
                    Feature(
                        "base",
                        "pad",
                        {
                            "profile": "s",
                            "distance_mm": height,
                            "body_id": "b",
                            "operation": "new",
                        },
                    ),
                    Feature(
                        "hole",
                        "sketch-circle",
                        {
                            "radius_mm": 2,
                            "center_mm": [10, 10],
                            "offset_mm": 0 if reversed else height,
                        },
                    ),
                    Feature(
                        "cut",
                        "pocket",
                        {
                            "operation": "cut",
                            "body_id": "b",
                            "region_mode": True,
                            "profiles": ["hole"],
                            "profile_regions": ["hole"],
                            "depth_mm": 1,
                            "end_type": "through-all",
                            "reversed": reversed,
                        },
                    ),
                ]
            )
        )
        assert not result.diagnostics, result.diagnostics
        assert result.bodies[0].volume_mm3 == pytest.approx(
            (400 - math.pi * 4) * height
        )


@pytest.mark.parametrize("height", [10, 30])
def test_up_to_next_uses_current_exact_face(height):
    features = [
        Feature("limit-sketch", "sketch-rectangle", {"width_mm": 20, "height_mm": 20, "frame": {"originMillimeters": [0, 0, height], "normal": [0, 0, 1], "xDirection": [1, 0, 0]}}),
        Feature("limit", "pad", {"profile": "limit-sketch", "distance_mm": 3, "body_id": "limit", "operation": "new"}),
        Feature("s", "sketch-circle", {"radius_mm": 2, "center_mm": [10, 10]}),
        Feature("pad", "pad", {"body_id": "result", "operation": "new", "region_mode": True,
            "profiles": ["s"], "profile_regions": ["s"], "distance_mm": 1, "end_type": "up-to-next"}),
    ]
    with FreeCADEngine() as engine:
        result = engine.build(BuildJob(features=features))
        assert not result.diagnostics, result.diagnostics
        body = next(b for b in result.bodies if b.id == "result")
        assert body.volume_mm3 == pytest.approx(math.pi * 4 * height)
        assert max(body.vertices[2::3]) == pytest.approx(height)
        features[2].parameters["center_mm"] = [0, 0]
        partial = engine.build(BuildJob(features=features))
        assert any("does not cover" in str(d) for d in partial.diagnostics), partial.diagnostics
        features[2].parameters["center_mm"] = [50, 50]
        missed = engine.build(BuildJob(features=features))
        assert any("No next face" in str(d) for d in missed.diagnostics), missed.diagnostics


@pytest.mark.parametrize("height,end_offset,start_offset", [(10, 2, 0), (30, 2, 0), (10, -2, 0), (10, 0, 1)])
def test_next_face_offset_recomputes_from_exact_geometry(height, end_offset, start_offset):
    features = [
        Feature("limit-sketch", "sketch-rectangle", {"width_mm": 20, "height_mm": 20, "frame": {"originMillimeters": [0, 0, height], "normal": [0, 0, 1], "xDirection": [1, 0, 0]}}),
        Feature("limit", "pad", {"profile": "limit-sketch", "distance_mm": 3, "body_id": "limit", "operation": "new"}),
        Feature("s", "sketch-circle", {"radius_mm": 2, "center_mm": [10, 10]}),
        Feature("pad", "pad", {"body_id": "result", "operation": "new", "region_mode": True,
            "profiles": ["s"], "profile_regions": ["s"], "distance_mm": 1, "end_type": "up-to-next",
            "end_offset_mm": end_offset, "starting_offset_mm": start_offset}),
    ]
    with FreeCADEngine() as engine:
        valid = BuildJob(features=features)
        result = engine.build(valid)
        assert not result.diagnostics, result.diagnostics
        body = next(b for b in result.bodies if b.id == "result")
        assert body.volume_mm3 == pytest.approx(math.pi * 4 * (height - end_offset - start_offset))
        assert max(body.vertices[2::3]) == pytest.approx(height - end_offset)
        exported = engine.export(valid, {"format": "step", "body_ids": ["result"]})
        assert exported["status"] == "ok", exported
        restored = engine.build(BuildJob(features=[Feature("import", "import-step", {"body_id":"restored", "operation":"new", "data_base64":exported["data_base64"]})]))
        assert not restored.diagnostics and restored.bodies[0].volume_mm3 == pytest.approx(body.volume_mm3)
        features[-1].parameters["end_offset_mm"] = height
        failed = engine.build(BuildJob(features=features))
        assert any("end offset" in str(d) for d in failed.diagnostics)
        assert engine.export(BuildJob(features=features), {"format": "step"})["status"] == "error"
        features[-1].parameters["end_offset_mm"] = end_offset
        assert not engine.build(BuildJob(features=features)).diagnostics
