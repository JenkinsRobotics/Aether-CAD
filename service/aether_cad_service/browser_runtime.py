"""Stateless CAD services the host still routes, answered by the Aether engine in the Node runner."""

import json
from pathlib import Path

from .automation_runtime import CommandError, worker

SERVICES = tuple(json.loads(Path(__file__).with_name("browser-services.json").read_text()))

RETIRED = ("/api/cad/geometry", "/api/cad/export", "/api/cad/analysis")


def execute(service, path, data):
    if not isinstance(data, dict):
        raise CommandError(400, "Expected a request object.")
    node = getattr(service, "node", None)
    if path == "/api/cad/assembly-compose":
        from .assembly_compose import execute as compose
        return compose(service, data, node=node)
    if path in RETIRED:
        # The editor builds, exports and measures in-process; the host never computes geometry per user.
        raise CommandError(410, "The CAD editor builds geometry in the browser; this host service is retired.")
    if path == "/api/cad/assembly":
        if data.get("operation") == "workspace":
            from .assembly_workspace import execute as workspace
            return workspace(data)
        if not isinstance(data.get("instances"), list) or len(data["instances"]) > 512:
            raise CommandError(413, "An assembly supports up to 512 instances.")
        return worker({"phase": "assembly_solve", "job": data}, node=node)
    if path == "/api/cad/mate-kinds":
        return {"ok": True, "kinds": sorted(worker({"phase": "engine"}, node=node)["mate_kinds"])}
    if path == "/api/cad/engine":
        return worker({"phase": "engine"}, node=node)
    raise CommandError(404, "Unknown CAD endpoint.")
