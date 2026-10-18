"""One bounded invocation, installed as a self-contained, hashed Python zipapp.

The Rust host owns the process group, deadline, private working directory and
saved-file authority. This module imports no Studio host or database package.
"""

import base64
import json
import sys
import tempfile
import zipfile
from pathlib import Path


def main():
    if len(sys.argv) != 3:
        raise ValueError("Operator Node and FreeCAD paths required")
    node, freecad = sys.argv[1:]
    if not all(
        Path(path).is_absolute() and Path(path).is_file() for path in (node, freecad)
    ):
        raise ValueError("Invalid installed runtime")
    raw = sys.stdin.buffer.read(16 * 1024 * 1024 + 1)
    if len(raw) > 16 * 1024 * 1024:
        raise ValueError("Request exceeds limit")
    request = json.loads(raw)
    # FreeCAD runs the existing worker.py by filename. Extract only the trusted
    # build's files into the host-owned private request directory, never a home
    # directory or product checkout. No path comes from document content.
    with tempfile.TemporaryDirectory(prefix="cad-", dir=Path.cwd()) as temporary:
        root = Path(temporary)
        with zipfile.ZipFile(sys.argv[0]) as bundle:
            for entry in bundle.infolist():
                path = Path(entry.filename)
                if path.is_absolute() or ".." in path.parts:
                    raise ValueError("Invalid bundle")
            bundle.extractall(root)
        sys.path.insert(0, str(root))
        from aether_freecad import FreeCADEngine

        from aether_cad_service.automation_runtime import execute

        class Service:
            def __init__(self):
                self.engine = None
                self.node = node

            def geometry_engine(self):
                if self.engine is None:
                    self.engine = FreeCADEngine(command=freecad, timeout_seconds=25)
                return self.engine

        service = Service()
        try:
            if request.get("service", "").startswith("/api/cad/settings-"):
                from aether_cad_service.settings_runtime import (
                    execute as settings_execute,
                )

                result = {
                    "result": settings_execute(request["service"], request["arguments"])
                }
            elif request.get("service", "").startswith("/api/cad/project-"):
                from aether_cad_service.project_runtime import (
                    execute as project_execute,
                )

                result = {
                    "result": project_execute(request["service"], request["arguments"])
                }
            elif "service" in request:
                from aether_cad_service.browser_runtime import (
                    execute as browser_execute,
                )

                result = browser_execute(
                    service, request["service"], request["arguments"]
                )
                if request["service"] == "/api/cad/engine":
                    # Local executable paths/logs are operator-only details.
                    result.pop("command", None)
                    if not result.get("ok"):
                        result["error"] = "The CAD geometry engine is unavailable."
                result = {"result": result}
            else:
                catalog = json.loads((root / "automation-commands.json").read_text())
                descriptor = next(c for c in catalog if c["id"] == request["command"])
                encoding = descriptor.get("content_encoding", "utf8")
                if request.get("content_encoding", "utf8") != encoding:
                    raise ValueError("Unsupported content encoding")
                content = (
                    base64.b64decode(request["content"], validate=True)
                    if encoding == "base64"
                    else request["content"].encode("utf-8")
                )
                result = execute(
                    service,
                    request["command"],
                    content,
                    request["arguments"],
                    node=node,
                )
                if "content" in result:
                    result["content"] = (
                        base64.b64encode(result["content"]).decode("ascii")
                        if encoding == "base64"
                        else result["content"].decode("utf-8")
                    )
                else:
                    if descriptor["writes"]:
                        result["unchanged"] = True
            encoded = json.dumps(result, allow_nan=False)
            if len(encoded.encode()) > 8 * 1024 * 1024:
                raise ValueError("Result exceeds limit")
            sys.stdout.write(encoded)
        finally:
            if service.engine:
                service.engine.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # noqa: BLE001 - redact failures at the public process boundary
        # Do not return paths, native logs or document data in error messages.
        unavailable = (
            isinstance(error, (OSError, ImportError))
            or getattr(error, "status", 400) >= 500
        )
        sys.stdout.write(
            json.dumps(
                {
                    "error": {
                        "kind": "unavailable"
                        if unavailable
                        else (
                            "too_large"
                            if getattr(error, "status", 0) == 413
                            else "invalid"
                        )
                    }
                }
            )
        )
