"""Qualify a recipe using CAD's normal translator and exact native solver."""
import base64
import math

import json

from .assembly_recipe import prepare
from .automation_runtime import worker
from .project_runtime import MAX_BYTES, decode


def execute(service, data, *, node=None):
    workspace = decode(data["data_base64"])
    if workspace.revision != data["expected_revision"]:
        raise ValueError("The assembly revision changed")
    assembly_id = data["assembly_id"]
    candidate, ids = prepare(workspace, assembly_id, data["recipe"])
    projection = candidate.projection(assembly_id)
    if candidate.solve(assembly_id)["status"] != "solved":
        raise ValueError("The saved assembly constraint graph did not solve")
    translated = worker({"phase": "assembly", "projection": projection, "template_ids": list(ids["parts"].values())}, node=node)
    if not translated["complete"]:
        raise ValueError("Assembly contains geometry that cannot be rebuilt: " +
                         "; ".join(v["reason"] for v in translated["untranslated"])[:1000])
    # The assembly solver builds Parts too, but does not expose every upstream
    # feature diagnostic. Qualify each used template through the normal builder.
    bodies = []
    documents = {p["id"]: p.get("feature_document") for p in projection["part_definitions"]}
    for part in translated["job"]["parts"]:
        document = documents.get(part["id"])
        built = worker({"phase": "build", "content": json.dumps(document)}, node=node) if document else None
        if not built or built.get("status") != "ok" or built.get("diagnostics") or not built.get("bodies"):
            raise ValueError("A Part template failed its exact geometry rebuild")
        bodies.append({"part_id": part["id"], "body_count": len(built["bodies"]),
                       "volume_mm3": sum(b["volume_mm3"] for b in built["bodies"])})
    solution = worker({"phase": "assembly_solve", "job": translated["job"]}, node=node) if translated["job"]["instances"] else None
    if solution and (solution["status"] != "ok" or any(d.get("severity") == "error" for d in solution["diagnostics"])):
        raise ValueError("The native assembly solve failed: " + solution["message"][:1000])
    expected = {v["id"] for v in translated["job"]["instances"]}
    placements = solution["instances"] if solution else []
    if len(placements) != len(expected) or {v["id"] for v in placements} != expected:
        raise ValueError("The native solver returned incomplete placements")
    for instance in placements:
        if (not all(math.isfinite(v) for v in (*instance["placement_mm"], *instance["rotation"])) or
                abs(math.hypot(*instance["rotation"])-1) > 1e-6):
            raise ValueError("The native solver returned an invalid placement")
        saved = next(v for v in projection["instances"] if v["id"] == instance["id"])["solved_world_transform"]
        if (max(abs(a-b*1000) for a, b in zip(instance["placement_mm"], saved["position_m"])) > 1e-4 or
                abs(sum(a*b for a, b in zip(instance["rotation"], saved["rotation_quaternion_xyzw"]))) < 1-1e-8):
            raise ValueError("The saved assembly pose disagrees with the native constraint solve")
    content = candidate.to_bytes()[0]
    if len(content) > MAX_BYTES:
        raise ValueError("Container exceeds limit")
    # Check the actual serialized artifact with the installed codec before it
    # can replace the live document. Storage remains the caller's responsibility.
    encoded = base64.b64encode(content).decode("ascii")
    decode(encoded)
    return {"data_base64": encoded, "revision": candidate.revision,
            "assembly_id": assembly_id, "ids": ids, "evaluated_parts": bodies,
            "instance_count": len(expected), "engine": solution["engine"] if solution else "Aether",
            "solve_seconds": solution["solve_seconds"] if solution else 0}
