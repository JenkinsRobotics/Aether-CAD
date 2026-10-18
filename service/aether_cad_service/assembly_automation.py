"""Saved Assembly adapter. The ordinary editor recipe owns all modeling meaning."""

import base64
import json

from . import assembly_compose
from .automation_runtime import CommandError, worker
from .project_runtime import decode

SECTIONS = ("parts", "instances", "mates", "assemblies")


def inspect(workspace, assembly_id, section, offset):
    projection = workspace.projection(assembly_id)
    items = {
        "parts": [
            {
                "id": p["id"],
                "name": p["name"],
                "has_geometry": bool(p.get("feature_document")),
            }
            for p in projection["part_definitions"]
        ],
        "instances": [
            {
                "id": i["id"],
                "name": i["name"],
                "part_id": i["definition_id"],
                "grounded": i["grounded"],
                "suppressed": i["suppressed"],
                "position_mm": [
                    v * 1000 for v in i["solved_world_transform"]["position_m"]
                ],
                "rotation_xyzw": i["solved_world_transform"][
                    "rotation_quaternion_xyzw"
                ],
            }
            for i in projection["instances"]
        ],
        "mates": [
            {
                "id": m["id"],
                "name": m["name"],
                "kind": m["type_id"],
                "endpoint_a": m["endpoint_a"],
                "endpoint_b": m["endpoint_b"],
            }
            for m in projection["mates"]
        ],
        "assemblies": [
            {"id": a["id"], "name": a["name"]} for a in projection["assemblies"]
        ],
    }
    return {
        "assembly_id": assembly_id,
        "workspace_revision": workspace.revision,
        "section": section,
        "items": items[section][offset : offset + 20],
        "counts": {key: len(value) for key, value in items.items()},
        "next_offset": offset + 20 if offset + 20 < len(items[section]) else None,
        "capabilities": projection["capabilities"],
        "source": "saved-assembly",
        "pixel_preview": False,
    }


def execute(service, command, content, arguments, *, node=None):
    workspace = decode(base64.b64encode(content).decode("ascii"))
    assembly_id = arguments.get("assembly_id", workspace.root_assembly_id)
    if not isinstance(assembly_id, str) or assembly_id not in workspace.assemblies:
        raise CommandError(400, "Choose an Assembly in this saved document.")
    if command == "cad.assembly.inspect":
        offset = arguments.get("offset", 0)
        section = arguments.get("section", "instances")
        if (
            type(offset) is not int
            or not 0 <= offset <= 10000
            or section not in SECTIONS
        ):
            raise CommandError(
                400, "Choose a valid section and integer offset 0–10000."
            )
        result = inspect(workspace, assembly_id, section, offset)
        part = next(
            (
                p
                for p in workspace.part_definitions.values()
                if p.get("feature_document", {}).get("features")
            ),
            None,
        )
        result["example"] = worker(
            {"phase": "assembly_example", "part_id": part["id"] if part else None},
            node=node,
        )
        result["limits"] = [
            "Saved document only; open editors must reload external edits.",
            "Preview does not save or reserve identities. Apply requires the saved file revision.",
            "Ordinary recipe mates: fastened, revolute, prismatic. No nested assemblies.",
            "Arrays create independent instances, not associative patterns.",
        ]
        return {"result": result}
    if command not in ("cad.assembly.preview", "cad.assembly.compose"):
        raise CommandError(400, "Unknown Assembly command.")
    encoded = arguments.get("recipe_json")
    if not isinstance(encoded, str) or len(encoded.encode("utf-8")) > 2 * 1024 * 1024:
        raise CommandError(400, "Provide a JSON recipe of at most 2 MiB.")
    recipe = json.loads(encoded)
    qualified = assembly_compose.execute(
        service,
        {
            "data_base64": base64.b64encode(content).decode("ascii"),
            "expected_revision": workspace.revision,
            "assembly_id": assembly_id,
            "recipe": recipe,
        },
        node=node,
    )
    candidate = base64.b64decode(qualified.pop("data_base64"), validate=True)
    if len(candidate) > 4 * 1024 * 1024:
        raise CommandError(
            413, "This Assembly exceeds the 4 MiB automation document limit."
        )
    qualified["workspace_revision"] = qualified.pop("revision")
    result = {
        "result": {
            **qualified,
            "pixel_preview": False,
            "preview_only": command.endswith(".preview"),
        }
    }
    if command.endswith(".compose"):
        result["content"] = candidate
    return result
