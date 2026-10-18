import pytest
from aether_freecad import FreeCADEngine, BuildJob, Feature


def solid(id, size, origin):
    return [
        Feature(
            id + "s",
            "sketch-rectangle",
            {
                "width_mm": size,
                "height_mm": size,
                "frame": {
                    "originMillimeters": origin,
                    "xDirection": [1, 0, 0],
                    "normal": [0, 0, 1],
                },
            },
        ),
        Feature(
            id,
            "pad",
            {
                "profile": id + "s",
                "distance_mm": size,
                "body_id": id,
                "operation": "new",
            },
        ),
    ]


def test_exact_sections_and_contained_interference():
    with FreeCADEngine() as engine:
        job = BuildJob(
            features=solid("outer", 10, [0, 0, 0]) + solid("inside", 2, [2, 2, 2])
        )
        overlap = engine.analyze(job, {"kind": "interference"})
        assert overlap["status"] == "ok", overlap
        assert overlap["measurements"] == [
            {
                "first_body_id": "outer",
                "second_body_id": "inside",
                "volume_mm3": pytest.approx(8),
            }
        ]
        section = engine.analyze(
            job, {"kind": "section", "plane": "XY", "offset_mm": 5}
        )
        assert section["status"] == "ok", section
        assert [b["volume_mm3"] for b in section["bodies"]] == pytest.approx([500, 8])
        assert section["bodies"][0]["face_count"] == 6  # native cap included
        reverse = engine.analyze(
            job, {"kind": "section", "plane": "XY", "offset_mm": 5, "reverse": True}
        )
        assert [b["volume_mm3"] for b in reverse["bodies"]] == pytest.approx([500])
        touching = engine.analyze(
            BuildJob(features=solid("a", 10, [0, 0, 0]) + solid("b", 2, [10, 0, 0])),
            {"kind": "interference"},
        )
        assert touching["measurements"] == []
        bad = engine.analyze(job, {"kind": "section", "plane": "bad"})
        assert bad["status"] == "error"
