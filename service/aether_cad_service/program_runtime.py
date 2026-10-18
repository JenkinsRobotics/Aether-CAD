"""Headless authoring reuses the editor's program semantics and native geometry.

Only the completed candidate is returned; the host owns authorization, revision
checks and atomic persistence. Intermediate geometry never becomes a saved edit.
"""

import math
import time

from .automation_runtime import (
    CommandError,
    build_candidate,
    build_summary,
    native_job,
    worker,
)


def execute_program(service, source, arguments, *, node=None):
    started = time.monotonic()
    plan = worker(
        {
            "phase": "program_begin",
            "content": source,
            "program_json": arguments.get("program_json"),
        },
        node=node,
    )
    content = source
    references = {}
    for step in plan["steps"]:
        if time.monotonic() - started > 25:
            raise CommandError(504, "CAD program timed out. No changes were saved.")
        try:
            prepared = worker(
                {
                    "phase": "program_step",
                    "content": content,
                    "step": step,
                    "references": references,
                },
                node=node,
            )
            built = build_candidate(service, prepared["features"])
            accepted = worker(
                {
                    "phase": "program_accept",
                    "content": prepared["candidate"],
                    "pending": prepared["pending"],
                    "body_outputs": built.body_outputs,
                    "sketch_frames": built.sketch_frames,
                    "scope_resolutions": built.scope_resolutions,
                },
                node=node,
            )
        except CommandError as error:
            raise CommandError(
                error.status, f"Program step {step['id']}: {error.message}"
            ) from None
        content = accepted["content"]
        if len(content.encode("utf-8")) > 4 * 1024 * 1024:
            raise CommandError(
                413, "The program candidate exceeds the 4 MiB document limit."
            )
        references[step["id"]] = accepted["reference"]
    if time.monotonic() - started > 25:
        raise CommandError(504, "CAD program timed out. No changes were saved.")
    result = {
        **accepted["result"],
        **build_summary(built),
        "references": references,
        "steps_completed": len(plan["steps"]),
        "program_seconds": time.monotonic() - started,
        "source": "saved-file-native",
    }
    # Compare normalized documents, not formatting or a migrated version marker.
    # No-op steps must not create a revision. Inspect omits some persisted fields,
    # so comparison is performed by the canonical serializer in the TS worker.
    comparison = worker(
        {"phase": "compare", "content": source, "candidate": content}, node=node
    )
    if comparison["changed"]:
        return {"result": result, "content": content.encode("utf-8")}
    return {"result": result}


def verify(service, prepared, arguments):
    offset = arguments.get("offset", 0)
    density = arguments.get("density_kg_m3")
    if type(offset) is not int or not 0 <= offset <= 512:
        raise CommandError(400, "Use an integer offset from 0 to 512.")
    if density is not None and (
        type(density) not in (int, float)
        or not math.isfinite(density)
        or not 0 < density <= 1e6
    ):
        raise CommandError(400, "Density must be positive and at most 1000000 kg/m³.")
    options = {"kind": "properties"}
    if density is not None:
        options["density_kg_m3"] = density
    import aether_freecad as adapter

    try:
        analyzed = service.geometry_engine().analyze(
            native_job(prepared["features"]), options
        )
    except adapter.FreeCADUnavailable as error:
        raise CommandError(503, str(error)) from None
    if analyzed.get("status") != "ok" or analyzed.get("diagnostics"):
        raise CommandError(
            400, "Exact native verification failed. No changes were saved."
        )
    measurements = analyzed.get("measurements")
    if not isinstance(measurements, list) or len(measurements) > 512:
        raise CommandError(400, "Invalid or oversized geometry measurements.")
    return {
        "document_id": prepared["result"]["document_id"],
        "source": "native-exact-solids",
        "units": {
            "volume": "mm³",
            "area": "mm²",
            "length": "mm",
            "mass": "kg",
            "inertia": "kg·m²",
        },
        "total_bodies": len(measurements),
        "measurements": measurements[offset : offset + 20],
        "next_offset": offset + 20 if offset + 20 < len(measurements) else None,
        "pixel_preview": False,
    }
