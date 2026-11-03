"""Saved workspace intent must match the CAD worker's actual assembly poses.

The test launcher pins the packaged codec, never an editable sibling checkout.
"""
import json
import math
from pathlib import Path

import pytest
from aether_animation.aether_workspace import AetherWorkspace
from aether_cad_service.automation_runtime import worker

ROOT = Path(__file__).resolve().parents[2]


def mutate(workspace, method, **params):
    return workspace.mutate(method, params, workspace.revision, "joint-pose-test")


def workspace_with_mate(kind, rotated):
    workspace = AetherWorkspace.new(1)
    mutate(workspace, "add_part_definition", part_definition={"name": "P", "source": {"kind": "authored", "label": "P"}})
    part_id = next(iter(workspace.part_definitions))
    document = json.loads((ROOT / "examples/Train-Cart-Wheel.part.json").read_text())
    document["documentId"] = part_id
    mutate(workspace, "update_part_definition", part_definition={**workspace.part_definitions[part_id], "feature_document": document})
    for name in ("A", "B", "C"):
        mutate(workspace, "add_instance", instance={"parent_assembly_id": workspace.root_assembly_id,
            "definition_kind": "part", "definition_id": part_id, "name": name, "grounded": name == "A",
            "rest_transform": {"position_m": [.017, -.023, .009], "rotation_quaternion_xyzw": [0, 0, math.sin(.2), math.cos(.2)]}})
    for name, origin, normal, x in (("first", [.03, .02, .01], [0, 1, 0], [0, 0, 1]), ("second", [-.007, .003, .004], [1, 0, 0], [0, 1, 0])):
        mutate(workspace, "add_connector", connector={"part_definition_id": part_id, "name": name,
            "frame_part_local": {"origin_m": origin if rotated else [0, 0, 0], "primary_axis_xyz": normal if rotated else [0, 0, 1], "secondary_axis_xyz": x if rotated else [1, 0, 0]}, "provenance": {"kind": "manual"}})
    a, b, _ = workspace.instances
    ca, cb = workspace.connector_definitions
    mutate(workspace, "add_mate", mate={"name": kind, "type_id": kind,
        "endpoint_a": {"instance_id": a, "connector_definition_id": ca}, "endpoint_b": {"instance_id": b, "connector_definition_id": cb}})
    mate = workspace.projection(workspace.root_assembly_id)["mates"][0]
    for i, dof in enumerate(mate["dofs"]):
        mutate(workspace, "set_dof_value", dof_id=dof["id"], **({"value_rad": .2 + .1 * i} if dof["kind"] == "rotation" else {"value_m": .01 + .01 * i}))
    return workspace


def compare_saved_poses(workspace):
    archive, _ = workspace.to_bytes()
    reopened = AetherWorkspace.from_bytes(archive)
    projection = reopened.projection(reopened.root_assembly_id)
    translation = worker({"phase": "assembly", "projection": projection, "template_ids": []})
    assert translation["complete"], translation
    result = worker({"phase": "assembly_solve", "job": translation["job"]})
    assert result["status"] == "ok", result
    for instance in projection["instances"]:
        actual = next(item for item in result["instances"] if item["id"] == instance["id"])
        expected = instance["solved_world_transform"]
        assert actual["placement_mm"] == pytest.approx([v * 1000 for v in expected["position_m"]], abs=1e-5)
        dot = sum(x * y for x, y in zip(actual["rotation"], expected["rotation_quaternion_xyzw"]))
        assert abs(dot) == pytest.approx(1, abs=1e-8)


@pytest.mark.parametrize("kind", ["fastened", "revolute", "prismatic", "cylindrical", "ball", "planar", "pin_slot", "parallel"])
@pytest.mark.parametrize("rotated", [False, True])
@pytest.mark.parametrize("ground_second", [False, True])
def test_nonzero_saved_mates_match_worker_pose(kind, rotated, ground_second):
    workspace = workspace_with_mate(kind, rotated)
    if ground_second:
        a, b, _ = workspace.instances
        mutate(workspace, "set_instance_grounded", instance_id=a, grounded=False)
        mutate(workspace, "set_instance_grounded", instance_id=b, grounded=True)
    compare_saved_poses(workspace)


@pytest.mark.parametrize("slot_driver", [False, True])
@pytest.mark.parametrize("rotation", [False, True])
def test_signed_relations_with_pin_slot_and_offsets(slot_driver, rotation):
    workspace = workspace_with_mate("pin_slot", True)
    a, _, c = workspace.instances
    ca, cb = workspace.connector_definitions
    mutate(workspace, "add_mate", mate={"name": "Other", "type_id": "revolute" if rotation else "prismatic",
        "endpoint_a": {"instance_id": a, "connector_definition_id": ca}, "endpoint_b": {"instance_id": c, "connector_definition_id": cb}})
    first, second = workspace.projection(workspace.root_assembly_id)["mates"]
    first_dof = next(d for d in first["dofs"] if d["kind"] == ("rotation" if rotation else "translation"))
    second_dof = second["dofs"][0]
    mutate(workspace, "set_dof_value", dof_id=second_dof["id"], **({"value_rad": .3} if rotation else {"value_m": .014}))
    driver, driven = (first_dof, second_dof) if slot_driver else (second_dof, first_dof)
    mutate(workspace, "add_relation", relation={"kind": "gear" if rotation else "linear",
        "driver_dof_id": driver["id"], "driven_dof_id": driven["id"], "ratio": -2, "reversed": True,
        **({"offset_rad": .1} if rotation else {"offset_m": .005})})
    compare_saved_poses(workspace)


@pytest.mark.parametrize("kind", ["revolute", "ball"])
def test_out_of_order_signed_relation_chain_matches_saved_worker_pose(kind):
    workspace = workspace_with_mate(kind, True)
    a, _, c = workspace.instances
    ca, cb = workspace.connector_definitions
    mutate(workspace, "add_mate", mate={"name":"Second", "type_id":kind,
        "endpoint_a":{"instance_id":a,"connector_definition_id":ca}, "endpoint_b":{"instance_id":c,"connector_definition_id":cb}})
    mutate(workspace, "add_instance", instance={"name":"D", "parent_assembly_id":workspace.root_assembly_id,
        "definition_kind":"part","definition_id":next(iter(workspace.part_definitions))})
    d = list(workspace.instances)[-1]
    mutate(workspace, "add_mate", mate={"name":"Third", "type_id":kind,
        "endpoint_a":{"instance_id":a,"connector_definition_id":ca}, "endpoint_b":{"instance_id":d,"connector_definition_id":cb}})
    x,y,z = [m["dofs"][0]["id"] for m in workspace.projection(workspace.root_assembly_id)["mates"]]
    mutate(workspace,"add_relation",relation={"kind":"gear","driver_dof_id":y,"driven_dof_id":z,"ratio":-.5,"offset_rad":.1,"reversed":True})
    mutate(workspace,"add_relation",relation={"kind":"gear","driver_dof_id":x,"driven_dof_id":y,"ratio":3,"offset_rad":.2})
    mutate(workspace,"set_dof_value",dof_id=x,value_rad=4*math.pi+.2)
    compare_saved_poses(workspace)


def test_floating_pair_with_separate_ground_keeps_canonical_reference_pose():
    workspace=workspace_with_mate("revolute",True)
    _, b, c=workspace.instances
    mate=next(iter(workspace.mates.values()))
    mutate(workspace,"update_mate",mate={**mate,
        "endpoint_a":{**mate["endpoint_a"],"instance_id":b},
        "endpoint_b":{**mate["endpoint_b"],"instance_id":c}})
    compare_saved_poses(workspace)
