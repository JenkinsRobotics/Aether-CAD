"""One local development computation; no Studio services or stored documents."""

import json
import signal
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(root / "freecad-engine"), str(root / "service")]

from aether_cad_service.automation_runtime import CommandError
from aether_cad_service.browser_runtime import execute
from aether_freecad import FreeCADEngine


class LocalGeometry:
    engine = None

    def geometry_engine(self):
        if self.engine is None:
            self.engine = FreeCADEngine(timeout_seconds=45)
        return self.engine


def stop(_signal, _frame):
    raise SystemExit(0)


signal.signal(signal.SIGTERM, stop)
service = LocalGeometry()
try:
    raw = sys.stdin.buffer.read(1024 * 1024 + 1)
    if len(raw) > 1024 * 1024:
        raise CommandError(413, "CAD request exceeds 1 MiB.")
    request = json.loads(raw)
    if request["path"] not in ("/api/cad/engine", "/api/cad/geometry"):
        raise CommandError(404, "This local window only supports geometry computation.")
    result = execute(service, request["path"], request["data"])
    if request["path"] == "/api/cad/engine":
        result.pop("command", None)
    print(json.dumps({"status": 200, "body": result}, allow_nan=False))
except CommandError as error:
    print(json.dumps({"status": error.status, "body": {"error": error.message}}))
except Exception as error:
    print(json.dumps({"status": 503, "body": {"error": str(error)}}))
finally:
    if service.engine is not None:
        service.engine.close()
