"""CAD project operations; platform library owns revisions and access checks."""
import base64
import json
from core.host.state import Problem

def dispatch(library, action, user, data, row=None):
    self = library
    uid, app = user["id"], data["app"]
    if action == "project_create":
        from aether_animation.aether_project import new_project, edit_project

        workspace = new_project(self.name(data.get("name")))
        packaging = data.get("packaging", "project")
        if packaging not in ("project", "assembly"):
            raise Problem(400, "Choose a project or standalone Assembly.")
        if packaging == "project":
            edit_project(workspace, "add_part", {"name": "Part 1"})
        content, _ = workspace.to_bytes()
        return self.dispatch(
            "create",
            user,
            {
                **data,
                "name": workspace.name
                + (".acasm" if packaging == "assembly" else ".acad"),
                "data_base64": base64.b64encode(content).decode(),
            },
        )

    if action in ("cad_metadata", "cad_operation"):
        from .settings import dispatch
        return dispatch(self, action, user, row, data)

    if action in ("project_read", "project_edit"):
        from aether_animation.aether_workspace import AetherWorkspace, AetherWorkspaceError
        from aether_animation.aether_project import project_projection, edit_project

        if action == "project_edit":
            row = self.entry(uid, app, row["id"], write=True)
        branch_name, branch_head = self.history.head(row, data.get("branch"))
        if action == "project_edit" and data.get("expected_revision") != branch_head:
            raise Problem(409, "This project changed. Reopen it before saving.")
        try:
            content = row["content"] if branch_name == "Main" else self.history.revision(row["id"], branch_head)["content"]
            if action == "project_read" and data.get("revision") is not None:
                content = self.history.revision(row["id"], data["revision"])[
                    "content"
                ]
            workspace = AetherWorkspace.from_bytes(content)
            if action == "project_edit":
                if data.get("operation") in ("link_part", "update_link"):
                    source = self.entry(uid, app, data.get("source_id"))
                    snapshot = self.history.revision(
                        source["id"], data.get("source_revision")
                    )
                    try:
                        document = json.loads(snapshot["content"])
                    except (ValueError, UnicodeDecodeError):
                        raise Problem(
                            400, "Select a standalone Part file."
                        ) from None
                    if (
                        not isinstance(document, dict)
                        or document.get("format") != "aether-part"
                    ):
                        raise Problem(400, "Select a native Part file.")
                    data = {
                        **data,
                        "document": document,
                        "source_label": snapshot["name"],
                        "source_ref": f"library:{source['id']}@{snapshot['revision']}",
                    }
                edit_project(workspace, data.get("operation"), data)
                content, _ = workspace.to_bytes()
                saved = self.dispatch(
                    "save",
                    user,
                    {
                        "app": app,
                        "id": row["id"],
                        "expected_revision": branch_head,
                        "branch": branch_name,
                        "data_base64": base64.b64encode(content).decode(),
                        "note": data.get("operation"),
                    },
                )
                branch_head = saved["revision"]
                row = self.entry(uid, app, row["id"])
        except AetherWorkspaceError as exc:
            raise Problem(400, str(exc)) from None
        return {**self.metadata(row, uid), "revision": data.get("revision", branch_head), "branch": branch_name, "project": project_projection(workspace)}

    raise Problem(400, "Unsupported CAD document operation.")
