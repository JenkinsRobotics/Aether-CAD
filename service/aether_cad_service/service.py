"""CAD-owned host adapter for the legacy Python host; geometry builds in the Node runner."""

from core.host.compatibility import packaged_contract
from core.host.state import Problem


class CADService:
    app = "cad"
    compatibility = packaged_contract("aether_cad_service", app)
    from .automation import COMMANDS as automation_commands

    def automation(self, command, content, arguments):
        from .automation import execute

        return execute(self, command, content, arguments)

    document_create_actions = ("project_create",)
    document_actions = ("cad_metadata", "cad_operation", "project_read", "project_edit")

    def __init__(self):
        self.engines = {}

    # Geometry (builds, solves, exports) runs in the Node runner with the Aether engine;
    # `engines` stays for hosts that close engine processes on shutdown.
    node = None

    def api(self, host, user, path, data):
        from .automation_runtime import CommandError
        from .browser_runtime import execute

        if user["role"] == "service" and path not in (
            "/api/cad/engine",
            "/api/cad/mate-kinds",
        ):
            raise Problem(403, "User account required.")
        try:
            return execute(self, path, data)
        except CommandError as error:
            raise Problem(error.status, error.message) from None

    def rpc(self, host, user, app, token, data):
        # Compatibility for existing CAD workspace clients. The serializer and
        # legacy workspace protocol still reside in Animation until format ownership
        # is migrated; the platform no longer imports that implementation.
        from aether_animation.host_service import AnimationService

        return AnimationService().rpc(host, user, app, token, data)

    def document(self, library, action, user, data, row=None):
        from .documents import dispatch

        return dispatch(library, action, user, data, row)
