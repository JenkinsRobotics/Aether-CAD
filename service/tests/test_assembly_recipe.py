import copy
import math

import pytest
from aether_animation.aether_workspace import AetherWorkspace
from aether_cad_service.assembly_recipe import prepare


def recipe():
    return {"version": 1, "parts": [{"key": "block", "name": "Block", "document": {
        "format": "aether-part", "formatVersion": 3, "documentId": "input", "name": "Block", "features": []}}],
        "instances": [{"key": "base", "part": "block", "position_mm": [30, 0, 0], "grounded": True}]}


def create(value=None):
    workspace = AetherWorkspace.new(1)
    before = workspace.to_bytes()[0]
    candidate, ids = prepare(workspace, workspace.root_assembly_id, value or recipe())
    assert workspace.to_bytes()[0] == before
    assert candidate.revision_number == workspace.revision_number + 1
    restored = AetherWorkspace.from_bytes(candidate.to_bytes()[0])
    assert restored.graph() == candidate.graph()
    return candidate, ids


def test_template_is_saved_once_and_instances_reuse_it():
    spec = recipe()
    spec["instances"].append({"key": "other", "part": "block", "position_mm": [40, 0, 0]})
    workspace, ids = create(spec)
    assert len(workspace.part_definitions) == 1
    assert {v["definition_id"] for v in workspace.instances.values()} == {ids["parts"]["block"]}
    assert workspace.instances[ids["instances"]["base"]]["rest_transform"]["position_m"] == [.03, 0, 0]
    spec["parts"] = [{"key": "block", "part_id": ids["parts"]["block"]}]
    again, _ = prepare(workspace, workspace.root_assembly_id, spec)
    assert len(again.part_definitions) == 1
    assert len(again.instances) == 4


def test_part_template_can_be_defined_before_placing_instances():
    spec = recipe()
    spec["instances"] = []
    workspace, ids = create(spec)
    assert len(workspace.part_definitions) == 1 and not workspace.instances
    spec = recipe()
    spec["parts"] = [{"key": "block", "part_id": ids["parts"]["block"]}]
    placed, _ = prepare(workspace, workspace.root_assembly_id, spec)
    assert len(placed.part_definitions) == 1 and len(placed.instances) == 1


@pytest.mark.parametrize("kind", ["fastened", "revolute", "prismatic"])
def test_mates_save_actual_connectors_and_canonical_degrees_of_freedom(kind):
    spec = recipe()
    spec["instances"].append({"key": "moving", "part": "block"})
    spec["mates"] = [{"key": "joint", "kind": kind, "a": {"instance": "base"}, "b": {"instance": "moving"}}]
    workspace, _ = create(spec)
    mate = next(iter(workspace.mates.values()))
    assert mate["type_id"] == kind
    assert len(mate["dofs"]) == (0 if kind == "fastened" else 1)
    assert len(workspace.connector_definitions) == 2


@pytest.mark.parametrize("rotate", [True, False])
def test_circular_arrays_rotate_about_the_requested_center(rotate):
    spec = recipe()
    spec["patterns"] = [{"key": "ring", "source": "base", "kind": "circular", "count": 4,
                         "axis_xyz": [0, 0, 2], "center_mm": [10, 0, 0], "step_degrees": 90, "rotate": rotate}]
    workspace, ids = create(spec)
    second = workspace.instances[ids["instances"]["ring:2"]]["rest_transform"]
    assert second["position_m"] == pytest.approx([.01, .02, 0], abs=1e-12)
    assert second["rotation_quaternion_xyzw"] == pytest.approx([0, 0, math.sqrt(.5), math.sqrt(.5)] if rotate else [0, 0, 0, 1])


def test_linear_array_count_includes_source_and_keeps_grounding():
    spec = recipe()
    spec["patterns"] = [{"key": "row", "source": "base", "kind": "linear", "count": 4, "step_mm": [0, -20, 0]}]
    workspace, ids = create(spec)
    assert len(workspace.instances) == 4
    fourth = workspace.instances[ids["instances"]["row:4"]]
    assert fourth["grounded"]
    assert fourth["rest_transform"]["position_m"] == pytest.approx([.03, -.06, 0])


@pytest.mark.parametrize("change", [
    lambda r: r.update(version=True),
    lambda r: r.update(unknown=1),
    lambda r: r["parts"][0].update(part_id="missing"),
    lambda r: r["parts"].append(copy.deepcopy(r["parts"][0])),
    lambda r: r["instances"].append(copy.deepcopy(r["instances"][0])),
    lambda r: r["instances"][0].update(grounded=False),
    lambda r: r["instances"][0].update(grounded="yes"),
    lambda r: r["instances"][0].update(position_mm=[float("nan"), 0, 0]),
    lambda r: r["instances"][0].update(rotation_xyzw=[0, 0, 0, 2]),
    lambda r: r["instances"][0].update(part="missing"),
    lambda r: r.update(patterns=[{"key": "row", "source": "base", "kind": "linear", "count": 513, "step_mm": [10, 0, 0]}]),
    lambda r: r.update(patterns=[{"key": "row", "source": "base", "kind": "linear", "count": 2, "step_mm": [0, 0, 0]}]),
    lambda r: r.update(patterns=[{"key": "ring", "source": "base", "kind": "circular", "count": 5, "axis_xyz": [0, 0, 1], "center_mm": [0, 0, 0], "step_degrees": 90}]),
    lambda r: r.update(mates=[{"key": "joint", "kind": "ball", "a": {"instance": "base"}, "b": {"instance": "base"}}]),
])
def test_invalid_recipes_never_mutate_source(change):
    spec = recipe()
    change(spec)
    workspace = AetherWorkspace.new(1)
    before = workspace.to_bytes()[0]
    with pytest.raises((ValueError, RuntimeError)):
        prepare(workspace, workspace.root_assembly_id, spec)
    assert workspace.to_bytes()[0] == before
