import math
import pytest
from aether_freecad import BuildJob, Feature, FreeCADEngine


@pytest.fixture(scope="module")
def engine():
    with FreeCADEngine() as instance:
        yield instance


def build(engine, features):
    result = engine.build(BuildJob(features=features))
    assert result.status == "ok", result
    assert not [d for d in result.diagnostics if d["severity"] == "error"], (
        result.diagnostics
    )
    return result


def rectangle():
    return [
        Feature(
            "s",
            "sketch-polygon",
            {"points_mm": [[-10, -10], [10, -10], [10, 10], [-10, 10]]},
        ),
        Feature(
            "pad",
            "pad",
            {"profile": "s", "distance_mm": 10, "body_id": "b1", "operation": "new"},
        ),
    ]


def test_sweep_open_path(engine):
    result = build(
        engine,
        [
            Feature("s", "sketch-circle", {"radius_mm": 2}),
            Feature(
                "path",
                "sketch-wire",
                {
                    "plane": "XZ",
                    "start_mm": [0, 0],
                    "segments": [{"type": "line", "end": [0, 20]}],
                },
            ),
            Feature(
                "pipe",
                "sweep",
                {
                    "profile": "s",
                    "path": "path",
                    "body_id": "pipe-body",
                    "operation": "new",
                },
            ),
        ],
    )
    assert result.bodies[0].volume_mm3 == pytest.approx(math.pi * 4 * 20, rel=1e-6)
    assert result.bodies[0].id == "pipe-body"


@pytest.mark.parametrize("opened", [True, False])
def test_shell(engine, opened):
    params = {"thickness_mm": 1, "body_id": "b1"}
    if opened:
        params.update(removed_plane="XY", removed_offset_mm=10)
    result = build(engine, rectangle() + [Feature("shell", "shell", params)])
    assert result.bodies[0].volume_mm3 == pytest.approx(
        4000 - 18 * 18 * (9 if opened else 8), rel=1e-6
    )


def test_regions_create_independent_bodies_then_targeted_cut(engine):
    features = rectangle() + [
        Feature("other", "sketch-circle", {"radius_mm": 2, "center_mm": [30, 0]}),
        Feature(
            "other-pad",
            "pad",
            {"profile": "other", "distance_mm": 6, "body_id": "b2", "operation": "new"},
        ),
        Feature("hole", "sketch-circle", {"radius_mm": 2, "offset_mm": 10}),
        Feature(
            "cut",
            "pocket",
            {"profile": "hole", "depth_mm": 10, "body_id": "b1", "operation": "cut"},
        ),
    ]
    result = build(engine, features)
    assert [b.id for b in result.bodies] == ["b1", "b2"]
    assert result.bodies[0].volume_mm3 == pytest.approx(
        4000 - math.pi * 4 * 10, rel=1e-6
    )
    assert result.bodies[1].volume_mm3 == pytest.approx(math.pi * 4 * 6, rel=1e-6)


def test_semicircle_and_frame(engine):
    result = build(
        engine,
        [
            Feature(
                "s",
                "sketch-wire",
                {
                    "start_mm": [-5, 0],
                    "segments": [
                        {"type": "arc", "middle": [0, 5], "end": [5, 0]},
                        {"type": "line", "end": [-5, 0]},
                    ],
                    "frame": {
                        "originMillimeters": [0, 0, 12],
                        "xDirection": [1, 0, 0],
                        "normal": [0, 0, 1],
                    },
                },
            ),
            Feature(
                "e",
                "pad",
                {"profile": "s", "distance_mm": 4, "body_id": "b", "operation": "new"},
            ),
        ],
    )
    assert result.bodies[0].volume_mm3 == pytest.approx(math.pi * 25 * 2, rel=1e-6)
    assert min(result.bodies[0].vertices[2::3]) == pytest.approx(12)


def test_invalid_finish_is_an_error_even_with_previous_geometry(engine):
    result = engine.build(
        BuildJob(
            features=rectangle()
            + [Feature("f", "fillet", {"radius_mm": 1000, "body_id": "b1"})]
        )
    )
    assert any(
        d["severity"] == "error" and d["feature_id"] == "f" for d in result.diagnostics
    )


def test_cut_from_bottom_can_flip_into_the_body(engine):
    result = build(
        engine,
        rectangle()
        + [
            Feature("hole", "sketch-circle", {"radius_mm": 2}),
            Feature(
                "cut",
                "pocket",
                {
                    "profile": "hole",
                    "depth_mm": 10,
                    "body_id": "b1",
                    "operation": "cut",
                    "reversed": True,
                },
            ),
        ],
    )
    assert result.bodies[0].volume_mm3 == pytest.approx(
        4000 - math.pi * 4 * 10, rel=1e-6
    )
