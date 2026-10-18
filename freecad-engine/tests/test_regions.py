import math
import pytest
from aether_freecad import BuildJob, Feature, FreeCADEngine


@pytest.mark.parametrize(
    "selected,area",
    [
        (["outer"], math.pi * 75),
        (["inner"], math.pi * 25),
        (["outer", "inner"], math.pi * 100),
        (["outer", "other"], math.pi * 79),
    ],
)
def test_nested_and_multiple_regions(selected, area):
    with FreeCADEngine() as engine:
        sketches = [
            Feature("outer", "sketch-circle", {"radius_mm": 10}),
            Feature("inner", "sketch-circle", {"radius_mm": 5}),
            Feature("other", "sketch-circle", {"radius_mm": 2, "center_mm": [30, 0]}),
        ]
        result = engine.build(
            BuildJob(
                features=sketches
                + [
                    Feature(
                        "pad",
                        "pad",
                        {
                            "operation": "new",
                            "body_id": "regions",
                            "region_mode": True,
                            "profiles": selected,
                            "profile_regions": ["outer", "inner", "other"],
                            "distance_mm": 6,
                        },
                    )
                ]
            )
        )
        assert not result.diagnostics, result.diagnostics
        assert result.bodies[0].volume_mm3 == pytest.approx(area * 6)


def test_multiple_sketch_groups_preserve_holes_and_body_identity():
    sketches = [
        Feature("outer", "sketch-circle", {"radius_mm": 10}),
        Feature("inner", "sketch-circle", {"radius_mm": 5}),
        Feature("other", "sketch-circle", {"radius_mm": 2, "center_mm": [30, 0], "offset_mm": 20}),
    ]
    groups = [dict(profiles=["outer"], profile_regions=["outer", "inner"], profile_keys={"outer": "ring"})]
    parameters = dict(operation="new", body_id="parts", region_mode=True,
                      separate_bodies=True, profile_groups=groups, distance_mm=6)
    with FreeCADEngine() as engine:
        first = engine.build(BuildJob(features=sketches + [Feature("pad", "pad", parameters)]))
        assert not first.diagnostics, first.diagnostics
        ring_id = first.bodies[0].id
        groups.append(dict(profiles=["other"], profile_regions=["other"], profile_keys={"other": "sketch2:disk"}))
        result = engine.build(BuildJob(features=sketches + [Feature("pad", "pad", parameters)]))
        assert not result.diagnostics, result.diagnostics
        assert len(result.bodies) == 2
        ring = next(body for body in result.bodies if body.id == ring_id)
        disk = next(body for body in result.bodies if body.id != ring_id)
        assert ring.volume_mm3 == pytest.approx(math.pi * 75 * 6)
        assert disk.volume_mm3 == pytest.approx(math.pi * 4 * 6)
        assert min(disk.vertices[2::3]) == pytest.approx(20)
        assert max(disk.vertices[2::3]) == pytest.approx(26)
