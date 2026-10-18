import math
import pytest
from aether_freecad import BuildJob, Feature, FreeCADEngine


def supported_job(depth):
    return BuildJob(features=[
        Feature("base-profile", "sketch-rectangle", {"width_mm": 20, "height_mm": 20}),
        Feature("base", "pad", {"profile": "base-profile", "operation": "new", "body_id": "block", "distance_mm": depth}),
        Feature("hole", "sketch-circle", {"radius_mm": 2, "source_profile_id": "hole", "support": {
            "sourceFeatureId": "base", "bodyId": "block", "normal": [0, 0, 1], "xDirection": [1, 0, 0]},
            "frame": {"originMillimeters": [999, 999, 999], "normal": [0, 0, 1], "xDirection": [1, 0, 0]}}),
        Feature("cut", "pocket", {"operation": "cut", "body_id": "block", "region_mode": True, "profiles": ["hole"], "profile_regions": ["hole"], "end_type": "through-all", "distance_mm": 1}),
    ])


def test_attached_circle_and_through_cut_follow_changed_base_depth():
    with FreeCADEngine() as engine:
        for depth in [12, 42]:
            result = engine.build(supported_job(depth))
            assert not result.diagnostics, result.diagnostics
            assert result.sketch_frames["hole"]["originMillimeters"] == pytest.approx([10, 10, depth])
            assert result.bodies[0].volume_mm3 == pytest.approx((400 - math.pi * 4) * depth)


def test_missing_or_changed_support_fails_instead_of_using_saved_frame():
    with FreeCADEngine() as engine:
        for change in [{"bodyId": "missing"}, {"normal": [1, 1, 1]}]:
            job = supported_job(12)
            job.features[2].parameters["support"].update(change)
            result = engine.build(job)
            assert result.diagnostics
            assert result.diagnostics[0]["feature_id"] == "hole"
            assert "support" in result.diagnostics[0]["message"].lower()


def test_two_parallel_support_faces_are_rejected_as_ambiguous():
    job = supported_job(12)
    job.features[:2] = [
        Feature("a", "sketch-circle", {"radius_mm": 10}),
        Feature("b", "sketch-circle", {"radius_mm": 10, "center_mm": [30, 0]}),
        Feature("base", "pad", {"region_mode": True, "profiles": ["a", "b"], "profile_regions": ["a", "b"], "operation": "new", "body_id": "block", "distance_mm": 12}),
    ]
    with FreeCADEngine() as engine:
        result = engine.build(job)
        assert result.diagnostics[0]["feature_id"] == "hole"
        assert "ambiguous" in result.diagnostics[0]["message"]
        assert not result.sketch_frames
