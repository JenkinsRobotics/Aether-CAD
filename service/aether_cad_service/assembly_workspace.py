"""Portable CAD Assembly metadata operations, using the release-pinned codec.

The request owns archive bytes, never host handles, paths or storage authority.
Exact contact/Part geometry remains in the client's Aether OCCT worker.
"""
import base64
import json
import uuid

from aether_animation.aether_workspace import AetherWorkspace, AetherWorkspaceError

from .automation_runtime import CommandError
from .part_format import validate_workspace_part_headers
from .project_runtime import decode

MUTATIONS = frozenset((
    "add_part_definition", "update_part_definition", "remove_part_definition",
    "add_instance", "update_instance", "remove_instance", "move_instance",
    "set_instance_grounded", "set_instance_suppressed",
    "add_connector", "update_connector", "remove_connector",
    "add_mate", "update_mate", "remove_mate", "set_dof_value",
    "add_relation", "update_relation", "remove_relation",
    "add_contact_set", "update_contact_set", "remove_contact_set", "set_contacts_enabled",
))
READS = frozenset(("describe_assembly", "solve_assembly", "project_bom", "preview_mate"))
MAX_REQUEST = 4 * 1024 * 1024
# Leave room for command metadata inside the unchanged host request limit.
MAX_ARCHIVE_BASE64 = MAX_REQUEST - 64 * 1024


def bounded(workspace):
    if len(workspace.instances) > 512 or len(workspace.part_definitions) > 512:
        raise CommandError(413, "An assembly supports up to 512 instances and Part definitions.")
    if len(workspace.mates) > 2048 or len(workspace.relations) > 2048:
        raise CommandError(413, "An assembly supports up to 2048 mates and relations.")
    validate_workspace_part_headers(workspace)


def archive(workspace, handle):
    encoded = base64.b64encode(workspace.to_bytes()[0]).decode("ascii")
    if len(encoded) > MAX_ARCHIVE_BASE64:
        raise CommandError(413, "Assembly archive exceeds the portable request limit.")
    return {"handle": handle, "revision": workspace.revision,
            "graph_sha256": workspace.semantic_hash(), "data_base64": encoded}


def execute(data):
    if set(data) - {"operation", "method", "params", "data_base64"}:
        raise CommandError(400, "Unknown Assembly workspace request field.")
    if len(json.dumps(data, allow_nan=False).encode()) > MAX_REQUEST:
        raise CommandError(413, "Assembly request exceeds limit.")
    method, params = data.get("method"), data.get("params")
    if not isinstance(method, str) or method not in READS | MUTATIONS | {"new_workspace", "load_workspace"}:
        raise CommandError(400, "Unknown Assembly workspace operation.")
    if not isinstance(params, dict):
        raise CommandError(400, "Expected Assembly parameters.")
    handle = params.get("handle")
    if not isinstance(handle, str) or not 1 <= len(handle) <= 128:
        raise CommandError(400, "Expected a portable Assembly handle.")
    if "path" in params or "return_data" in params:
        raise CommandError(400, "Assembly workspace operations accept archive bytes only.")
    try:
        if method == "new_workspace":
            name = params.get("name")
            if not isinstance(name, str) or not name.strip() or len(name) > 256:
                raise CommandError(400, "Expected an Assembly name of 1 to 256 characters.")
            workspace = AetherWorkspace.new(1, name.strip())
            workspace.workspace_id = str(uuid.uuid5(uuid.NAMESPACE_URL, handle))
        else:
            encoded = data.get("data_base64")
            if not isinstance(encoded, str) or len(encoded) > MAX_ARCHIVE_BASE64:
                raise CommandError(413, "Assembly archive exceeds the portable request limit.")
            workspace = decode(encoded)
        bounded(workspace)
        if method in ("new_workspace", "load_workspace"):
            result = workspace.describe_workspace(handle)
        else:
            assembly_id = params.get("assembly_id", workspace.root_assembly_id)
            if not isinstance(assembly_id, str):
                raise CommandError(400, "Expected an Assembly ID.")
            if method in MUTATIONS:
                expected = params.get("expected_revision")
                if not isinstance(expected, str):
                    raise CommandError(400, "Expected an Assembly revision.")
                result = workspace.mutate(method, params, expected, handle)
                bounded(workspace)
            elif method == "describe_assembly":
                result = workspace.projection(assembly_id)
            elif method == "solve_assembly":
                result = workspace.solve(assembly_id)
            elif method == "project_bom":
                mode = params.get("mode", "hierarchical")
                if mode not in ("hierarchical", "flattened"):
                    raise CommandError(400, "Unknown BOM mode.")
                result = workspace.bom(assembly_id, mode)
            else:
                result = workspace.preview_mate(assembly_id, params.get("mate"))
        response = {"ok": True, "result": result}
        if method not in READS:
            response["archive"] = archive(workspace, handle)
        return response
    except AetherWorkspaceError as error:
        # Structured domain errors match the previous bridge contract. No host
        # paths or process logs are produced by these metadata-only operations.
        return {"ok": False, "error": {"code": error.code,
                "message": error.message, "path": error.path}}
