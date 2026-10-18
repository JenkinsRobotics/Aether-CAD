"""CAD container operations only. Studio owns storage, access and revision history."""

import base64
import io
import uuid
import zipfile

from aether_animation.aether_project import (
    edit_project,
    new_project,
    project_projection,
)
from aether_animation.aether_workspace import AetherWorkspace

from .part_format import (
    PART_DOCUMENT_VERSION,
    validate_part_header,
    validate_workspace_part_headers,
)

MAX_BYTES = 6 * 1024 * 1024


def new_part_document():
    # The container codec owns tab identities; CAD owns feature schema versions.
    return {"format": "aether-part", "formatVersion": PART_DOCUMENT_VERSION,
            "units": "millimeter", "features": []}


def decode(encoded):
    if not isinstance(encoded, str) or len(encoded) > MAX_BYTES * 4 // 3:
        raise ValueError("Container exceeds limit")
    raw = base64.b64decode(encoded, validate=True)
    # Bound decompression before invoking the canonical format decoder. Stored
    # caches are allowed but cannot consume unbounded memory or shadow graph data.
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        entries = archive.infolist()
        if (len(entries) > 256 or len({e.filename for e in entries}) != len(entries)
                or sum(e.file_size for e in entries) > MAX_BYTES
                or any(e.flag_bits & 1 for e in entries)):
            raise ValueError("Invalid container")
    workspace = AetherWorkspace.from_bytes(raw)
    validate_workspace_part_headers(workspace)
    return workspace


def execute(path, data):
    if path == "/api/cad/project-create":
        packaging = data.get("packaging", "project")
        if packaging not in ("project", "assembly"):
            raise ValueError("Invalid packaging")
        workspace = new_project(data["name"])
        # Exact operation retries must produce identical bytes for Studio's
        # canonical atomic create receipt. IDs inside a container are local.
        workspace.workspace_id = str(uuid.uuid5(uuid.NAMESPACE_URL, data["operation_id"]))
        if packaging == "project":
            edit_project(workspace, "add_part", {"name": "Part 1", "document": new_part_document()})
    elif path in ("/api/cad/project-read", "/api/cad/project-edit"):
        workspace = decode(data["data_base64"])
        if path.endswith("-edit"):
            if data["operation"] == "add_part" and "document" not in data:
                data = {**data, "document": new_part_document()}
            if data["operation"] in ("add_part", "save_part", "link_part", "update_link"):
                validate_part_header(data.get("document"))
            edit_project(workspace, data["operation"], data)
    else:
        raise ValueError("Unknown project operation")
    validate_workspace_part_headers(workspace)
    result = {"project": project_projection(workspace)}
    if not path.endswith("-read"):
        content = workspace.to_bytes()[0]
        if len(content) > MAX_BYTES:
            raise ValueError("Container exceeds limit")
        result["data_base64"] = base64.b64encode(content).decode("ascii")
    return result
