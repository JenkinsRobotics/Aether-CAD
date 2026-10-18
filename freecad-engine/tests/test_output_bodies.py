import base64
import math

import pytest
from aether_freecad import BuildJob, Feature, FreeCADEngine


def features(order, depth=6):
    sketches = {
        "outer": Feature("outer", "sketch-circle", {"radius_mm": 10}),
        "inner": Feature("inner", "sketch-circle", {"radius_mm": 5}),
        "other": Feature("other", "sketch-circle", {"radius_mm": 2, "center_mm": [30, 0]}),
    }
    return [sketches[key] for key in order] + [Feature("pad", "pad", {
        "operation": "new", "body_id": "regions", "region_mode": True,
        "separate_bodies": True, "profiles": [key for key in order if key != "inner"],
        "profile_regions": order, "profile_keys": {key: key for key in order},
        "distance_mm": depth,
    })]


def test_separate_bodies_keep_identity_and_target_only_one_solid():
    with FreeCADEngine() as engine:
        original = engine.build(BuildJob(features=features(["outer", "inner", "other"])))
        assert not original.diagnostics, original.diagnostics
        assert len(original.bodies) == 2
        ids = {body.id for body in original.bodies}
        assert set(original.body_outputs["pad"]) == ids
        ring = max(original.bodies, key=lambda body: body.volume_mm3)
        disk = min(original.bodies, key=lambda body: body.volume_mm3)
        assert ring.volume_mm3 == pytest.approx(math.pi * 75 * 6)
        assert disk.volume_mm3 == pytest.approx(math.pi * 4 * 6)
        exported = engine.export(BuildJob(features=features(["outer", "inner", "other"])), {"format": "step", "body_ids": [disk.id]})
        assert exported["status"] == "ok", exported
        assert exported["body_count"] == 1
        assert base64.b64decode(exported["data_base64"]).startswith(b"ISO-10303-21;")
        section = engine.analyze(BuildJob(features=features(["outer", "inner", "other"])), {"kind": "section", "plane": "XY", "offset_mm": 3})
        assert section["status"] == "ok", section
        assert {body["id"] for body in section["bodies"]} == ids
        assert sum(body["volume_mm3"] for body in section["bodies"]) == pytest.approx(math.pi * 79 * 3)
        reordered = features(["other", "inner", "outer"], depth=12)
        updated = engine.build(BuildJob(features=reordered))
        assert not updated.diagnostics, updated.diagnostics
        assert {body.id for body in updated.bodies} == ids
        cut = engine.build(BuildJob(features=reordered + [
            Feature("hole", "sketch-circle", {"radius_mm": 1, "center_mm": [30, 0]}),
            Feature("cut", "pocket", {"operation": "cut", "body_id": disk.id,
                "region_mode": True, "profiles": ["hole"], "profile_regions": ["hole"],
                "distance_mm": 12, "reversed": True}),
        ]))
        assert not cut.diagnostics, cut.diagnostics
        assert set(cut.body_outputs["pad"]) == ids
        volumes = {body.id: body.volume_mm3 for body in cut.bodies}
        assert volumes[ring.id] == pytest.approx(math.pi * 75 * 12)
        assert volumes[disk.id] == pytest.approx(math.pi * 3 * 12)


def test_filled_nested_regions_produce_one_body():
    job = features(["outer", "inner", "other"])
    job[-1].parameters["profiles"] = ["outer", "inner"]
    with FreeCADEngine() as engine:
        result = engine.build(BuildJob(features=job))
        assert not result.diagnostics, result.diagnostics
        assert len(result.bodies) == 1
        assert result.bodies[0].volume_mm3 == pytest.approx(math.pi * 100 * 6)


def test_twenty_disconnected_circle_regions_have_complete_independent_meshes():
    keys = [f"circle-{index}" for index in range(20)]
    sketches = [Feature(key, "sketch-circle", {"radius_mm": 4, "center_mm": [index * 12, 0]}) for index, key in enumerate(keys)]
    with FreeCADEngine() as engine:
        result = engine.build(BuildJob(features=sketches + [Feature("pad", "pad", {
            "operation": "new", "body_id": "plate-array", "region_mode": True,
            "separate_bodies": True, "profiles": keys, "profile_regions": keys,
            "distance_mm": 10,
        })]))
        assert not result.diagnostics, result.diagnostics
        assert len(result.bodies) == len(set(result.body_outputs["pad"])) == 20
        for body in result.bodies:
            assert body.volume_mm3 == pytest.approx(math.pi * 16 * 10)
            assert body.face_count == 3
            assert sum(face["count"] for face in body.face_ranges) * 3 == len(body.triangles)
