"""Offline adapter for the same stateless services shipped to Studio."""
import json
import sys

from aether_cad_service import browser_runtime, project_runtime, settings_runtime


def main():
    request = json.loads(sys.stdin.buffer.read(16 * 1024 * 1024 + 1))
    path, arguments = request["service"], request["arguments"]
    class Service:
        node = sys.argv[1]
    if path.startswith("/api/cad/project-"):
        result = project_runtime.execute(path, arguments)
    elif path.startswith("/api/cad/settings-"):
        result = settings_runtime.execute(path, arguments)
    elif path.removeprefix('/api/cad/') in browser_runtime.SERVICES:
        result = browser_runtime.execute(Service(), path, arguments)
    else:
        raise ValueError("Unknown offline CAD operation")
    return result


try:
    print(json.dumps({"status": 200, "body": main()}))
except Exception as error:
    status = getattr(error, "status", 400)
    print(json.dumps({"status": status, "body": {"error": str(error) if status < 500 else "Offline CAD operation failed."}}))
