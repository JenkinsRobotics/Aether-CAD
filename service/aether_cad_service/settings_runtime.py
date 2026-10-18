"""Portable settings transforms. Studio alone resolves linked-file authority."""

import base64
import re

from aether_animation.aether_project import edit_project

from .document import CADDocument
from .project_runtime import MAX_BYTES, decode


def execute(path, data):
    encoded = data.get("data_base64")
    if not isinstance(encoded, str) or len(encoded) > MAX_BYTES * 4 // 3:
        raise ValueError("Document exceeds limit")
    raw = base64.b64decode(encoded, validate=True)
    if raw.startswith(b"PK"):
        # Apply the same decompression/checksum limits as project operations.
        decode(encoded)
    doc = CADDocument(raw)
    if path == "/api/cad/settings-edit":
        operation = data["operation"]
        if operation not in ("details", "units", "rename", "copy", "properties", "delete_item", "restore_item", "move", "update"):
            raise ValueError("Unknown settings operation")
        if operation == "update":
            doc.edit("upgrade", data)
            chosen = data.get("parts", [])
            resolved = data.get("resolved_sources", {})
            if not isinstance(chosen, list) or len(chosen) > 256 or len(set(chosen)) != len(chosen):
                raise ValueError("Choose linked Parts to update")
            for part_id in chosen:
                part = doc.workspace and doc.workspace.part_definitions.get(part_id)
                match = re.fullmatch(r"library:([^@]+)@(\d+)", part and part["source"].get("asset_ref", "") or "")
                source = resolved.get(part_id)
                if not match or not isinstance(source, dict):
                    raise ValueError("Choose a linked Part")
                source_ref = source.get("source_ref", "")
                if not re.fullmatch(r"library:" + re.escape(match[1]) + r"@[1-9]\d*", source_ref):
                    raise ValueError("Link source identity changed")
                raw_source = source.get("data_base64")
                if not isinstance(raw_source, str) or len(raw_source) > MAX_BYTES * 4 // 3:
                    raise ValueError("Invalid link source")
                source_bytes = base64.b64decode(raw_source, validate=True)
                if source_bytes.startswith(b"PK"):
                    raise ValueError("Link source must be a standalone Part")
                source_doc = CADDocument(source_bytes)
                if source_doc.part is None:
                    raise ValueError("Link source must be a standalone Part")
                edit_project(doc.workspace, "update_link", {"part_id": part_id, "document": source_doc.part,
                    "source_label": source["source_label"], "source_ref": source_ref})
        elif operation != "move":
            doc.edit("rename" if operation == "copy" else operation, data)
        raw = doc.bytes()
        if len(raw) > MAX_BYTES:
            raise ValueError("Document exceeds limit")
    elif path != "/api/cad/settings-read":
        raise ValueError("Unknown settings service")
    result = doc.projection()
    result["linked_sources"] = []
    if doc.workspace:
        for part in doc.workspace.part_definitions.values():
            ref = part.get("source", {}).get("asset_ref", "")
            match = re.fullmatch(r"library:([^@]+)@(\d+)", ref or "")
            if match:
                result["linked_sources"].append({"part_id": part["id"], "name": part["name"], "current": int(match[2]), "source_id": match[1]})
    if path.endswith("-edit"):
        result["data_base64"] = base64.b64encode(raw).decode("ascii")
    return result
