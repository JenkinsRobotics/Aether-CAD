"""Native body booleans preserve history inputs and publish the right outputs."""

import pytest
from aether_freecad import BuildJob, Feature, FreeCADEngine


@pytest.fixture(scope="module")
def engine():
    with FreeCADEngine() as instance:
        yield instance


def job(operation="union", **options):
    features = []
    for key, x, size in [("target", 0, 10), ("tool", 5, 10), ("other", 30, 5)]:
        features.extend(
            [
                Feature(
                    f"{key}-sketch",
                    "sketch-polygon",
                    {"points_mm": [[x, 0], [x + size, 0], [x + size, size], [x, size]]},
                ),
                Feature(
                    f"{key}-pad",
                    "pad",
                    {
                        "profile": f"{key}-sketch",
                        "distance_mm": size,
                        "operation": "new",
                        "body_id": key,
                    },
                ),
            ]
        )
    features.append(
        Feature(
            "boolean",
            "boolean",
            {
                "body_id": "target",
                "boolean_operation": operation,
                "tool_body_ids": ["tool"],
                "keep_tools": False,
                **options,
            },
        )
    )
    return BuildJob(features=features)


@pytest.mark.parametrize(
    "operation,volume", [("union", 1500), ("cut", 500), ("intersection", 500)]
)
@pytest.mark.parametrize("keep", [False, True])
def test_exact_boolean_result_and_tool_consumption(engine, operation, volume, keep):
    result = engine.build(job(operation, keep_tools=keep))
    assert result.diagnostics == []
    bodies = {body.id: body for body in result.bodies}
    assert set(bodies) == ({"target", "tool", "other"} if keep else {"target", "other"})
    assert bodies["target"].volume_mm3 == pytest.approx(volume)
    assert bodies["other"].volume_mm3 == pytest.approx(125)
    if keep:
        assert bodies["tool"].volume_mm3 == pytest.approx(1000)


@pytest.mark.parametrize(
    "options",
    [
        {"tool_body_ids": []},
        {"tool_body_ids": ["target"]},
        {"tool_body_ids": ["missing"]},
        {"tool_body_ids": ["tool", "tool"]},
        {"body_id": "missing"},
        {"boolean_operation": "unknown"},
    ],
)
def test_bad_boolean_does_not_export_and_worker_recovers(engine, options):
    result = engine.build(job(**options))
    assert any(
        d["severity"] == "error" and d["feature_id"] == "boolean"
        for d in result.diagnostics
    )
    assert engine.export(job(**options), {"format": "step"})["status"] == "error"
    assert engine.build(job()).diagnostics == []


def test_consumed_tool_cannot_be_reused_and_rollback_restores_it(engine):
    original = job()
    reused = BuildJob(
        features=[
            *original.features,
            Feature(
                "reuse",
                "boolean",
                {
                    "body_id": "target",
                    "boolean_operation": "cut",
                    "tool_body_ids": ["tool"],
                },
            ),
        ]
    )
    assert any(d["feature_id"] == "reuse" for d in engine.build(reused).diagnostics)
    assert {
        b.id
        for b in engine.build(BuildJob(features=original.features, rollback=6)).bodies
    } == {"target", "tool", "other"}


def test_boolean_step_roundtrip(engine):
    result = engine.export(job("cut"), {"format": "step", "body_ids": ["target"]})
    assert result["status"] == "ok"
    restored = engine.build(
        BuildJob(
            features=[
                Feature(
                    "restored",
                    "import-step",
                    {
                        "data_base64": result["data_base64"],
                        "operation": "new",
                        "body_id": "restored",
                    },
                )
            ]
        )
    )
    assert restored.diagnostics == []
    assert sum(b.volume_mm3 for b in restored.bodies) == pytest.approx(500)


def test_later_tool_edits_do_not_change_an_earlier_boolean(engine):
    original = job(keep_tools=True)
    edited = BuildJob(
        features=[
            *original.features,
            Feature(
                "grow-tool",
                "pad",
                {
                    "profile": "tool-sketch",
                    "distance_mm": 20,
                    "operation": "add",
                    "body_id": "tool",
                },
            ),
        ]
    )
    result = engine.build(edited)
    assert result.diagnostics == []
    bodies = {b.id: b for b in result.bodies}
    assert bodies["tool"].volume_mm3 == pytest.approx(2000)
    assert bodies["target"].volume_mm3 == pytest.approx(1500)


def test_multiple_cut_tools_and_empty_intersection(engine):
    original = job("cut", tool_body_ids=["tool", "other"])
    original.features[4] = Feature(
        "other-sketch",
        "sketch-polygon",
        {"points_mm": [[1, 1], [3, 1], [3, 3], [1, 3]]},
    )
    original.features[5] = Feature(
        "other-pad",
        "pad",
        {
            "profile": "other-sketch",
            "distance_mm": 2,
            "operation": "new",
            "body_id": "other",
        },
    )
    result = engine.build(original)
    assert result.diagnostics == []
    assert len(result.bodies) == 1
    assert result.bodies[0].volume_mm3 == pytest.approx(492)
    empty = job("intersection", tool_body_ids=["other"])
    assert any(d["feature_id"] == "boolean" for d in engine.build(empty).diagnostics)
    assert engine.export(empty, {"format": "step"})["status"] == "error"
    assert engine.build(original).diagnostics == []
