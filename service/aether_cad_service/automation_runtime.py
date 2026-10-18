"""CAD command execution shared by legacy and native hosts; no Studio imports."""

import json
import shutil
import subprocess
import zipfile
from pathlib import Path


class CommandError(Exception):
    def __init__(self, status, message):
        self.status = status
        self.message = message
        super().__init__(message)


def worker(request, *, node=None):
    runner = Path(__file__).with_name("runtime") / "runner.mjs"
    node = node or shutil.which("node")
    if not node or not runner.is_file():
        raise CommandError(
            503,
            "CAD automation requires Node.js and its built runtime. Build Aether CAD first.",
        )
    try:
        completed = subprocess.run(
            [node, "--max-old-space-size=256", str(runner)],
            input=json.dumps(request, allow_nan=False),
            text=True,
            capture_output=True,
            timeout=15,
            check=False,
        )
        if completed.returncode or len(completed.stdout.encode()) > 8 * 1024 * 1024:
            raise CommandError(503, "CAD automation could not complete this operation.")
        response = json.loads(completed.stdout)
    except subprocess.TimeoutExpired:
        raise CommandError(
            504, "CAD automation timed out. No changes were saved."
        ) from None
    except OSError:
        raise CommandError(503, "CAD automation runtime is unavailable.") from None
    except ValueError:
        raise CommandError(400, "This CAD request could not be read.") from None
    if not isinstance(response, dict):
        raise CommandError(503, "Invalid CAD automation response.")
    if "error" in response:
        raise CommandError(400, str(response["error"])[:2000])
    return response


def execute(service, command_id, content, arguments, *, node=None):
    if len(content) > 4 * 1024 * 1024:
        raise CommandError(
            413, "This part exceeds the 4 MiB automation document limit."
        )
    if command_id.startswith("cad.assembly."):
        from aether_freecad import FreeCADUnavailable

        from .assembly_automation import execute as assembly_execute

        try:
            return assembly_execute(service, command_id, content, arguments, node=node)
        except FreeCADUnavailable:
            raise CommandError(503, "The native Assembly engine is unavailable.") from None
        except (ValueError, KeyError, TypeError, zipfile.BadZipFile):
            raise CommandError(
                400, "The Assembly archive or recipe is invalid. No changes were saved."
            ) from None
    try:
        text = content.decode("utf-8")
    except UnicodeError:
        raise CommandError(400, "Choose a saved .acpart document.") from None
    if command_id == "cad.part.runprogram":
        from .program_runtime import execute_program

        return execute_program(service, text, arguments, node=node)
    prepared = worker(
        {"command": command_id, "content": text, "arguments": arguments}, node=node
    )
    result = prepared["result"]
    if "features" not in prepared:
        return {"result": result}
    if command_id == "cad.part.verify":
        from .program_runtime import verify

        return {"result": verify(service, prepared, arguments)}
    built = build_candidate(service, prepared["features"])
    result.update(build_summary(built))
    if command_id == "cad.part.topology":
        body = next((b for b in built.bodies if b.id == arguments.get("body_id")), None)
        if body is None:
            raise CommandError(400, "Body not found. Evaluate the part first.")
        offset = arguments.get("offset", 0)
        result.update(
            coordinate_units="millimeter",
            body_id=body.id,
            faces=body.topology[offset : offset + 20],
            next_offset=offset + 20 if offset + 20 < len(body.topology) else None,
        )
    response = {"result": result}
    if prepared.get("changed"):
        final = worker(
            {
                "phase": "finalize",
                "content": prepared["candidate"],
                "body_outputs": built.body_outputs,
                "scope_resolutions": built.scope_resolutions,
                "sketch_frames": built.sketch_frames,
            },
            node=node,
        )
        encoded = final["content"].encode("utf-8")
        if len(encoded) > 4 * 1024 * 1024:
            raise CommandError(
                413, "The edited part exceeds the automation document limit."
            )
        response["content"] = encoded
    return response


def native_job(features):
    import aether_freecad as adapter

    return adapter.BuildJob(
        features=[
            adapter.Feature(f["id"], f["kind"], f.get("parameters", {}))
            for f in features
        ]
    )


def build_candidate(service, features):
    import aether_freecad as adapter

    try:
        built = service.geometry_engine().build(native_job(features))
    except adapter.FreeCADUnavailable as error:
        raise CommandError(503, str(error)) from None
    if built.status != "ok" or built.diagnostics:
        details = "; ".join(
            str(d.get("message", "Invalid feature")) for d in built.diagnostics
        )
        raise CommandError(
            400,
            "Native rebuild refused. No changes saved. "
            + (details or built.message)[:1500],
        )
    return built


def build_summary(built):
    return {
        "engine": built.engine,
        "build_seconds": built.build_seconds,
        "pixel_preview": False,
        "evaluated_bodies": [
            {
                "id": b.id,
                "volume_mm3": b.volume_mm3,
                "face_count": b.face_count,
                "edge_count": b.edge_count,
            }
            for b in built.bodies
        ],
    }
