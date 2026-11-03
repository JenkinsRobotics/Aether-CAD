"""Permission-checked document operations around the canonical CAD container."""

import base64
import re
import time

from aether_animation.aether_project import edit_project
from aether_animation.aether_workspace import AetherWorkspaceError

from core.host.state import Problem

from .document import CADDocument, linked_part, parse_source_ref, source_ref


def dispatch(library, action, user, row, data):
    # This legacy adapter operates on Main's row. Never silently apply a branch
    # settings request to Main; the native Studio adapter owns that contract.
    if data.get("branch") not in (None, "", "Main"):
        raise Problem(501, "Branch document settings require native Studio.")
    if row["kind"] != "file":
        raise Problem(400, "Choose a native CAD document.")
    read_only = data.get("revision") is not None
    content = (
        library.history.revision(row["id"], data["revision"])["content"]
        if read_only
        else row["content"]
    )
    try:
        doc = CADDocument(content)
        if action == "cad_metadata":
            updates = []
            if doc.workspace:
                for part in doc.workspace.part_definitions.values():
                    parsed = parse_source_ref(part.get("source", {}).get("asset_ref", ""))
                    if not parsed:
                        continue
                    try:
                        source = library.entry(user["id"], row["app"], parsed[0])
                        updates.append(
                            {
                                "part_id": part["id"],
                                "name": part["name"],
                                "current": int(parsed[1]),
                                "latest": source["revision"],
                                "available": True,
                            }
                        )
                    except Problem:
                        updates.append(
                            {
                                "part_id": part["id"],
                                "name": part["name"],
                                "current": int(parsed[1]),
                                "available": False,
                            }
                        )
            return {
                **library.metadata(row, user["id"]),
                **doc.projection(),
                "revision": data.get("revision", row["revision"]),
                "writable": library.access.role(row, user["id"]) in ("owner", "editor") and not read_only,
                "updates": updates,
            }
        operation = data.get("operation")
        if operation == "copy":
            # A historical/shared snapshot can be copied privately, never edited in place.
            name = library.name(data.get("name"))
            doc.edit("rename", {"name": name})
            return library.dispatch(
                "create",
                user,
                {
                    "app": row["app"],
                    "name": name + extension(row["name"]),
                    "parent": data.get("parent"),
                    "scope": "personal",
                    "data_base64": base64.b64encode(doc.bytes()).decode(),
                },
            )
        library.entry(user["id"], row["app"], row["id"], write=True)
        if read_only:
            raise Problem(
                403, "Historical revisions are read-only. Copy or restore them first."
            )
        if data.get("expected_revision") != row["revision"]:
            raise Problem(
                409, "The document changed. Save or reopen it before continuing."
            )
        filename = row["name"]
        parent = row["parent"]
        if operation == "move":
            library.access.require(row, user["id"], "owner")
            parent = data.get("parent") or None
            if parent:
                folder = library.entry(user["id"], row["app"], parent, write=True)
                if folder["kind"] != "folder" or library.access.location(folder) != library.access.location(row):
                    raise Problem(
                        400, "Choose an owned folder in the same sharing location."
                    )
        elif operation == "update":
            doc.edit("upgrade", data)
            if doc.workspace:
                chosen = data.get("parts", [])
                if not isinstance(chosen, list):
                    raise ValueError("Choose linked Parts to update.")
                for part_id in chosen:
                    part = doc.workspace.part_definitions.get(part_id)
                    parsed = parse_source_ref(part and part["source"].get("asset_ref", ""))
                    if not parsed:
                        raise ValueError("Choose a linked Part.")
                    source = library.entry(user["id"], row["app"], parsed[0])
                    linked = linked_part(CADDocument(source["content"]), parsed[2])
                    edit_project(
                        doc.workspace,
                        "update_link",
                        {
                            "part_id": part_id,
                            "document": linked["feature_document"],
                            "source_label": source["name"],
                            "source_ref": source_ref(source["id"], source["revision"], parsed[2]),
                        },
                    )
        else:
            doc.edit(operation, data)
            if operation == "rename":
                filename = library.name(data.get("name")) + extension(row["name"])
        payload = doc.bytes()
        library.content({"data_base64": base64.b64encode(payload).decode()})
        library.db.execute(
            "UPDATE library SET content=?,name=?,parent=?,revision=?,modified=? WHERE id=?",
            (payload, filename, parent, library.history.next_revision(row), time.time(), row["id"]),
        )
        current = library.entry(user["id"], row["app"], row["id"])
        library.history.record(current, user["id"], "document_" + operation)
        library.store.audit(user["username"], "document_" + operation, row["id"])
        return library.metadata(current, user["id"])
    except (ValueError, KeyError, TypeError, AetherWorkspaceError) as exc:
        raise Problem(400, str(exc)) from None


def extension(name):
    return "." + name.rsplit(".", 1)[-1] if "." in name else ".aethercad"
