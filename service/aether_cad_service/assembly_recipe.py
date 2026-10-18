"""Declarative assembly editing over the existing canonical workspace codec.

Recipes are input commands, not a second saved document. Arrays create ordinary
instances sharing one Part definition; they are deliberately not parametric features.
All work happens on a clone; callers must qualify the candidate before committing.
"""
import copy
import math

from .part_format import validate_part_header


def obj(value, fields, required=()):
    if not isinstance(value, dict) or set(value) - set(fields) or set(required) - set(value):
        raise ValueError("Unknown or missing assembly recipe fields")
    return value


def label(value):
    if not isinstance(value, str) or not value.strip() or len(value) > 180:
        raise ValueError("Assembly keys and names require 1–180 characters")
    return value.strip()


def vector(value, size=3):
    if (not isinstance(value, list) or len(value) != size or
            any(type(v) not in (int, float) or not math.isfinite(v) or abs(v) > 1e6 for v in value)):
        raise ValueError("Expected bounded finite coordinates")
    return list(value)


def unit(value):
    values = vector(value)
    length = math.hypot(*values)
    if length < 1e-9:
        raise ValueError("An axis cannot be zero")
    return [v / length for v in values]


def quaternion(value):
    result = vector(value, 4)
    if abs(math.hypot(*result) - 1) > 1e-6:
        raise ValueError("Rotation must be a unit XYZW quaternion")
    return result


def multiply(a, b):
    x, y, z, w = a
    X, Y, Z, W = b
    return [w*X+x*W+y*Z-z*Y, w*Y-x*Z+y*W+z*X,
            w*Z+x*Y-y*X+z*W, w*W-x*X-y*Y-z*Z]


def rotate(q, point):
    return multiply(multiply(q, [*point, 0]), [-q[0], -q[1], -q[2], q[3]])[:3]


def entries(recipe, key, maximum):
    value = recipe.get(key, [])
    if not isinstance(value, list) or len(value) > maximum:
        raise ValueError(f"{key} exceeds the recipe limit of {maximum}")
    return value


def prepare(workspace, assembly_id, recipe):
    obj(recipe, ("version", "parts", "instances", "mates", "patterns"), ("version",))
    if type(recipe["version"]) is not int or recipe["version"] != 1:
        raise ValueError("Unsupported assembly recipe version")
    draft = workspace.clone()
    draft._require_assembly(assembly_id)
    parts, instances, mates = {}, {}, {}

    def remember(mapping, key, value):
        key = label(key)
        if key in mapping:
            raise ValueError(f"Duplicate recipe key: {key}")
        mapping[key] = value

    for item in entries(recipe, "parts", 64):
        obj(item, ("key", "name", "document", "part_id"), ("key",))
        if ("document" in item) == ("part_id" in item):
            raise ValueError("A Part template needs either document or part_id")
        if "part_id" in item:
            part = draft.part_definitions.get(label(item["part_id"]))
            if not part or "feature_document" not in part:
                raise ValueError("Choose an existing Part with geometry")
        else:
            document = copy.deepcopy(item["document"])
            validate_part_header(document)
            part = draft._build_part_definition({"name": label(item.get("name", document.get("name")))}, assign=True)
            document.update(documentId=part["id"], name=part["name"])
            part["feature_document"] = document
            part = draft._build_part_definition(part, assign=False)
            draft.part_definitions[part["id"]] = part
        remember(parts, item["key"], part["id"])

    def add_instance(key, part_id, position, rotation, grounded):
        if type(grounded) is not bool:
            raise ValueError("grounded must be boolean")
        if len(draft.instances) >= 512:
            raise ValueError("An assembly supports up to 512 instances")
        item = draft._build_instance({"name": label(key), "parent_assembly_id": assembly_id,
            "definition_id": part_id, "grounded": grounded,
            "rest_transform": {"position_m": [v/1000 for v in vector(position)],
                               "rotation_quaternion_xyzw": quaternion(rotation)}}, assign=True)
        remember(instances, key, item["id"])
        draft.instances[item["id"]] = item

    for item in entries(recipe, "instances", 512):
        obj(item, ("key", "part", "position_mm", "rotation_xyzw", "grounded"), ("key", "part"))
        if item["part"] not in parts:
            raise ValueError("Instance references an unknown Part template")
        add_instance(item["key"], parts[item["part"]], item.get("position_mm", [0, 0, 0]),
                     item.get("rotation_xyzw", [0, 0, 0, 1]), item.get("grounded", False))

    for pattern in entries(recipe, "patterns", 32):
        kind = pattern.get("kind") if isinstance(pattern, dict) else None
        fields = ("step_mm",) if kind == "linear" else ("axis_xyz", "center_mm", "step_degrees", "rotate")
        obj(pattern, ("key", "source", "kind", "count", *fields), ("key", "source", "kind", "count"))
        if kind not in ("linear", "circular") or pattern["source"] not in instances:
            raise ValueError("Choose a linear/circular array and an existing recipe instance")
        count = pattern["count"]
        if type(count) is not int or not 2 <= count <= 512:
            raise ValueError("Array count includes the original and must be 2–512")
        source = draft.instances[instances[pattern["source"]]]
        origin = [v*1000 for v in source["rest_transform"]["position_m"]]
        rotation = source["rest_transform"]["rotation_quaternion_xyzw"]
        if kind == "linear":
            step = vector(pattern.get("step_mm"))
            if math.hypot(*step) < 1e-9:
                raise ValueError("Linear array spacing cannot be zero")
        else:
            axis, center = unit(pattern.get("axis_xyz")), vector(pattern.get("center_mm"))
            angle = vector([pattern.get("step_degrees")], 1)[0]
            if abs(angle) < 1e-9 or abs(angle) >= 360 or abs(angle)*(count-1) >= 360-1e-9:
                raise ValueError("Circular array members must occupy distinct angles within one turn")
            if type(pattern.get("rotate", True)) is not bool:
                raise ValueError("rotate must be boolean")
        for index in range(1, count):
            q = rotation
            if kind == "linear":
                position = [v + index*s for v, s in zip(origin, step)]
            else:
                half = math.radians(index*angle)/2
                turn = [*(v*math.sin(half) for v in axis), math.cos(half)]
                position = [v+c for v, c in zip(rotate(turn, [v-c for v, c in zip(origin, center)]), center)]
                if pattern.get("rotate", True):
                    q = multiply(turn, rotation)
            add_instance(f"{label(pattern['key'])}:{index+1}", source["definition_id"], position, q, source["grounded"])

    def endpoint(value):
        obj(value, ("instance", "origin_mm", "z_axis", "x_axis"), ("instance",))
        if value["instance"] not in instances:
            raise ValueError("Mate references an unknown recipe instance")
        instance_id = instances[value["instance"]]
        connector = draft._build_connector({"name": "Recipe connector", "part_definition_id": draft.instances[instance_id]["definition_id"],
            "frame_part_local": {"origin_m": [v/1000 for v in vector(value.get("origin_mm", [0, 0, 0]))],
                                 "primary_axis_xyz": unit(value.get("z_axis", [0, 0, 1])),
                                 "secondary_axis_xyz": unit(value.get("x_axis", [1, 0, 0]))}}, assign=True)
        draft.connector_definitions[connector["id"]] = connector
        return {"instance_id": instance_id, "connector_definition_id": connector["id"]}

    for item in entries(recipe, "mates", 511):
        obj(item, ("key", "kind", "a", "b"), ("key", "kind", "a", "b"))
        if item["kind"] not in ("fastened", "revolute", "prismatic"):
            raise ValueError("Saved recipes currently support fastened, revolute and prismatic mates")
        before = set(draft.mates)
        draft._add_mate({"mate": {"name": label(item["key"]), "type_id": item["kind"],
                                  "endpoint_a": endpoint(item["a"]), "endpoint_b": endpoint(item["b"])}})
        remember(mates, item["key"], (set(draft.mates)-before).pop())
    if not instances and len(draft.part_definitions) == len(workspace.part_definitions):
        raise ValueError("Create at least one Part template or instance")
    if instances and not any(v["grounded"] for v in draft.instances.values() if v["parent_assembly_id"] == assembly_id):
        raise ValueError("Ground at least one instance to define the assembly origin")
    draft.revision_number += 1
    return draft, {"parts": parts, "instances": instances, "mates": mates}
