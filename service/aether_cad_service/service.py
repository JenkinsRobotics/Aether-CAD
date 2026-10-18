"""CAD-owned host adapter; FreeCAD remains behind its existing JSON boundary."""

from core.host.compatibility import packaged_contract
from core.host.state import Problem


def freecad_engine_module():
    """Load the product-owned adapter installed with this service."""
    import aether_freecad

    return aether_freecad


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

    def geometry_engine(self):
        """The CAD geometry engine, started on first use.

        FreeCAD is the default engine (Jonathan, 2026-09-12). It lives behind
        `Aether CAD/freecad-engine`'s JSON boundary, so nothing here imports
        FreeCAD and the engine can be replaced centrally.

        ponytail: one worker, created on demand and reused. The worker is
        stateless per job, so a pool can replace this without callers changing
        when request volume justifies it.
        """
        engine = self.engines.get("cad-geometry")
        if engine is None:
            engine = freecad_engine_module().FreeCADEngine()
            self.engines["cad-geometry"] = engine
        return engine

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
