"""Native planar footprint extrusion, exact exchange and recoverable failures."""
import pytest
from aether_freecad import BuildJob, Feature, FreeCADEngine


@pytest.fixture(scope="module")
def engine():
    with FreeCADEngine() as instance:
        yield instance


def job(**changes):
    return BuildJob(features=[
        Feature("outline", "sketch-rectangle", {"width_mm": 10, "height_mm": 20}),
        Feature("pad", "pad", {"profile": "outline", "distance_mm": 10, "operation": "new", "body_id": "base"}),
        Feature("pull", "face-extrude", {"body_id": "base", "source_feature_id": "pad", "normal": [0, 0, 1], "distance_mm": 5, **changes}),
    ])


@pytest.mark.parametrize("normal,distance,volume", [([0, 0, 1], 5, 3000), ([0, 0, 1], -3, 1400), ([0, 0, -1], 5, 3000), ([1, 0, 0], 5, 3000)])
def test_exact_signed_face_extrusion(engine, normal, distance, volume):
    result = engine.build(job(normal=normal, distance_mm=distance))
    assert result.diagnostics == []
    assert result.bodies[0].id == "base"
    assert result.bodies[0].volume_mm3 == pytest.approx(volume, abs=1e-5)


@pytest.mark.parametrize("invalid", [
    {"source_feature_id": "deleted"}, {"body_id": "missing"},
    {"distance_mm": 0}, {"distance_mm": -20}, {"normal": [0, 0, 2]},
    {"normal": [0.6, 0.8, 0]},
])
def test_failed_reference_or_distance_blocks_export_and_worker_recovers(engine, invalid):
    result = engine.build(job(**invalid))
    assert any(d["feature_id"] == "pull" and d["severity"] == "error" for d in result.diagnostics)
    assert engine.export(job(**invalid), {"format": "step"})["status"] == "error"
    assert engine.build(job()).diagnostics == []


def test_step_roundtrip_and_imported_face_edit(engine):
    exported = engine.export(job(), {"format": "step"})
    assert exported["status"] == "ok"
    imported = Feature("import", "import-step", {"data_base64": exported["data_base64"], "operation": "new", "body_id": "imported"})
    restored = engine.build(BuildJob(features=[imported]))
    assert restored.diagnostics == []
    assert restored.bodies[0].volume_mm3 == pytest.approx(3000, abs=1e-4)
    changed = engine.build(BuildJob(features=[imported, Feature("edit", "face-extrude", {"body_id": "imported", "source_feature_id": "import", "normal": [0, 0, 1], "distance_mm": -2})]))
    assert changed.diagnostics == []
    assert changed.bodies[0].volume_mm3 == pytest.approx(2600, abs=1e-4)


def test_rejects_ambiguous_coplanar_direction(engine):
    stepped = job().features[:2] + [
        Feature("upper", "sketch-rectangle", {"width_mm": 5, "height_mm": 20, "offset_mm": 10}),
        Feature("step", "pad", {"profile": "upper", "distance_mm": 5, "operation": "add", "body_id": "base"}),
        Feature("pull", "face-extrude", {"body_id": "base", "source_feature_id": "step", "normal": [0, 0, 1], "distance_mm": 2}),
    ]
    result = engine.build(BuildJob(features=stepped))
    assert any(d["feature_id"] == "pull" and "ambiguous" in d["message"] for d in result.diagnostics), result.diagnostics
