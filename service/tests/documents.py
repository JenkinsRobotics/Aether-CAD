"""Test documents: a Part Studio wrapped in the one `.aethercad` container.

The runner and the automation commands take saved documents (archives, base64
on the wire). Tests think in Part JSON, so `request_content` wraps on the way in
and `part_text` unwraps the returned document on the way out."""
import base64
import copy
import json

from aether_animation.aether_workspace import AetherWorkspace


def part_archive(document):
    """Bytes of a document holding exactly this Part Studio, written like the app
    writes them (manifest + graph, stored zip) so any Part JSON can be wrapped and
    the runtime, not this helper, decides whether it is acceptable."""
    import hashlib
    import io
    import zipfile

    part_id = document.get("documentId") or "part-000003"
    name = document.get("name") or "Part"
    graph = {
        "schema_version": 3, "workspace_id": part_id, "name": name, "revision": "2", "id_counter": 3,
        "part_definitions": [{
            "custom_properties": [], "description": None, "id": part_id, "mass_kg": None, "material_id": None,
            "name": name, "part_number": None,
            "source": {"asset_ref": None, "kind": "authored", "label": name, "status": "resolved"},
            "feature_document": {**copy.deepcopy(document), "documentId": part_id},
        }],
        "assemblies": [{"description": None, "id": "assembly-000001", "name": "Main Assembly"}],
        "instances": [], "connector_definitions": [], "mates": [], "relations": [],
        "configurations": [{"active": True, "id": "configuration-000002", "name": "Default", "overridden_dof_ids": [], "suppressed_instance_ids": []}],
        "document_settings": {},
    }
    graph_bytes = (json.dumps(graph) + "\n").encode()
    manifest = {"format": "aether-workspace", "format_version": 1, "workspace_id": part_id, "name": name,
                "core_semantics_version": "1", "graph_path": "state/graph.json",
                "graph_sha256": hashlib.sha256(graph_bytes).hexdigest(),
                "root_view_ids": ["assembly-000001", part_id], "display_unit_system": "metric", "app": "cad", "kind": "part"}
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_STORED) as archive:
        archive.writestr("manifest.json", json.dumps(manifest) + "\n")
        archive.writestr("state/graph.json", graph_bytes)
    return buffer.getvalue()


def part_of(content):
    """The Part Studio document inside archive bytes, base64 text of them, or Part JSON text."""
    if isinstance(content, str):
        if content.lstrip().startswith("{"):
            return json.loads(content)
        content = base64.b64decode(content)
    workspace = AetherWorkspace.from_bytes(content)
    part = next(p for p in workspace.part_definitions.values() if p.get("feature_document"))
    return json.loads(json.dumps(part["feature_document"]))


def request_content(content):
    """base64 of the document a command runs on: Part JSON (dict or text) is wrapped, archive bytes pass through."""
    if isinstance(content, dict):
        content = part_archive(content)
    elif isinstance(content, str):
        content = part_archive(json.loads(content)) if content.lstrip().startswith("{") else base64.b64decode(content)
    return base64.b64encode(content).decode()


def part_text(result):
    """A runner result with its returned document unwrapped to Part JSON text."""
    if isinstance(result, dict) and isinstance(result.get("content"), str):
        result["content"] = json.dumps(part_of(result["content"]))
    return result
