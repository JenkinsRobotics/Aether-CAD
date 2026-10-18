"""Sketch-line directions resolve in native frames before building exact tools."""
import math
from dataclasses import replace

import pytest
from aether_freecad import BuildJob, Feature, FreeCADEngine
from test_extrusion_ends import limits, part


@pytest.fixture(scope="module")
def engine():
    with FreeCADEngine() as instance:
        yield instance


def reference(local=None, frame=None, **extra):
    return {"kind": "sketch-line", "local_vector": local or [3, 4],
            "frame": frame or {"originMillimeters": [0, 0, 0],
                "xDirection": [1, 0, 0], "normal": [0, -1, 0]}, **extra}


@pytest.mark.parametrize("end,reversed", [("blind", False), ("blind", True), ("symmetric", False)])
def test_reference_vector_preserves_travel_and_upstream_line_changes(engine, end, reversed):
    for local, nz in [([3, 4], .8), ([4, 3], .6), ([-3, -4], -.8)]:
        job = part(direction_reference=reference(local), end_type=end, reversed=reversed)
        built = engine.build(job)
        assert not built.diagnostics, built.diagnostics
        assert built.bodies[0].volume_mm3 == pytest.approx(math.pi * 100 * 10 * abs(nz))
    exported = engine.export(job, {"format": "step"})
    assert exported["status"] == "ok"
    reopened = engine.build(BuildJob(features=[Feature("i", "import-step", {
        "body_id": "restored", "operation": "new", "data_base64": exported["data_base64"]})]))
    assert not reopened.diagnostics
    assert reopened.bodies[0].volume_mm3 == pytest.approx(built.bodies[0].volume_mm3, abs=1e-5)


@pytest.mark.parametrize("end", ["up-to-next", "up-to-face"])
def test_direction_reference_works_with_moving_stops(engine, end):
    model = part(direction_reference=reference(), end_type=end, end_offset_mm=2,
                 end_reference={"sourceFeatureId": "top", "bodyId": "top", "normal": [0, 0, -1]})
    model.features[0].parameters["center_mm"] = [50, 50]
    model.features[:0] = limits()
    for height in (30, 40):
        model.features[2].parameters["offset_mm"] = height
        result = engine.build(model)
        assert not result.diagnostics, result.diagnostics
        assert result.bodies[-1].volume_mm3 == pytest.approx(math.pi * 100 * (height - 1.6))


@pytest.mark.parametrize("operation", ["cut", "intersect"])
def test_direction_reference_is_shared_by_scoped_through_all(engine, operation):
    job = BuildJob(features=limits() + [Feature("s", "sketch-circle", {"radius_mm": 2, "center_mm": [50, 50]}),
        Feature("e", "pad", {"body_id": "bottom", "target_body_ids": ["bottom", "top"], "operation": operation,
            "region_mode": True, "profiles": ["s"], "profile_regions": ["s"], "distance_mm": 1,
            "end_type": "symmetric-through-all", "direction_reference": reference()})], preview_feature_id="e")
    result = engine.build(job)
    assert not result.diagnostics, result.diagnostics
    for body in result.bodies:
        assert body.volume_mm3 == pytest.approx(30000 - 12 * math.pi if operation == 'cut' else 12 * math.pi, rel=1e-6, abs=1e-4)
    assert result.preview is not None


def test_native_support_overrides_stale_cached_direction_frame(engine):
    job = part(direction_reference=reference([0, 1], frame={"normal": [0, 0, 1], "xDirection": [1, 0, 0]}, support={
        "sourceFeatureId": "top", "bodyId": "top", "normal": [0, -1, 0], "xDirection": [1, 0, 0]}))
    job.features[:0] = limits()
    result = engine.build(job)
    assert not result.diagnostics, result.diagnostics
    assert result.bodies[-1].volume_mm3 == pytest.approx(math.pi * 1000)
    job.features[-1].parameters['direction_reference']['support']['sourceFeatureId'] = 'missing'
    failed = engine.build(job)
    assert any('support body is unavailable' in d["message"] for d in failed.diagnostics)


@pytest.mark.parametrize("ref", [None, {}, reference([0, 0]), reference([True, 1]), reference([float('inf'), 1]),
    reference([1, 2, 3]), reference(frame={'normal': [0, 0, 1], 'xDirection': [0, 0, 1]}),
    reference(frame={'normal': [0, 0, 2], 'xDirection': [1, 0, 0]}), reference(kind='edge'),
    reference(support=None), reference(support={}), reference(support=False)])
def test_invalid_reference_fails_without_publishing_preview_and_recovers(engine, ref):
    job = part(direction_reference=ref)
    job = replace(job, preview_feature_id='e')
    result = engine.build(job)
    assert result.diagnostics and not result.bodies and result.preview is None
    assert not engine.build(part()).diagnostics


@pytest.mark.parametrize("extra", [{'direction_vector': [0, 0, 1]}, {'region_mode': False},
    {'draft_angle_deg': 5}, {'second_end': {'end_type': 'blind', 'distance_mm': 3, 'draft_angle_deg': 4}}])
def test_ambiguous_or_unsupported_reference_modes_are_refused(engine, extra):
    result = engine.build(part(direction_reference=reference(), **extra))
    assert result.diagnostics and not result.bodies
