"""Existing stateless CAD browser operations, shared by both host adapters."""

import json
from pathlib import Path

import aether_freecad as engine_module

from .automation_runtime import CommandError

SERVICES = tuple(json.loads(Path(__file__).with_name("browser-services.json").read_text()))


def execute(service, path, data):
    if not isinstance(data, dict):
        raise CommandError(400, "Expected a request object.")
    if path == "/api/cad/assembly-compose":
        from .assembly_compose import execute as compose
        return compose(service, data, node=getattr(service, "node", None))
    if path in ("/api/cad/geometry", "/api/cad/export", "/api/cad/analysis"):
        BuildJob = engine_module.BuildJob
        Feature = engine_module.Feature
        FreeCADUnavailable = engine_module.FreeCADUnavailable
        PROTOCOL_VERSION = engine_module.PROTOCOL_VERSION

        features = data.get("features")
        if not isinstance(features, list):
            raise CommandError(400, "Expected a list of features.")
        if len(features) > 512:
            raise CommandError(413, "A part supports up to 512 features.")
        try:
            job = BuildJob(
                features=[
                    Feature(
                        id=str(item["id"]),
                        kind=str(item["kind"]),
                        parameters=dict(item.get("parameters") or {}),
                    )
                    for item in features
                ],
                rollback=data.get("rollback"),
                preview_feature_id=data.get("preview_feature_id"),
                tessellation_tolerance_mm=min(
                    5.0, max(0.001, float(data.get("tolerance_mm") or 0.1))
                ),
            )
        except (KeyError, TypeError, ValueError) as error:
            raise CommandError(400, f"Malformed feature list: {error}") from None
        try:
            if path == "/api/cad/analysis":
                options = data.get("analysis")
                if not isinstance(options, dict):
                    raise CommandError(400, "Expected analysis options.")
                return service.geometry_engine().analyze(job, options)
            if path == "/api/cad/export":
                if data.get("format") not in ("step", "stl"):
                    raise CommandError(400, "Choose STEP or STL.")
                return service.geometry_engine().export(
                    job,
                    {
                        "format": data["format"],
                        "body_ids": data.get("body_ids"),
                        "tolerance_mm": data.get("tolerance_mm", 0.1),
                    },
                )
            result = service.geometry_engine().build(job)
        except FreeCADUnavailable as error:
            # An operator-fixable condition, not a bug: say what to do.
            raise CommandError(503, str(error)) from None
        return {
            "protocol": PROTOCOL_VERSION,
            "status": result.status,
            "engine": result.engine,
            "message": result.message,
            "build_seconds": result.build_seconds,
            "body_outputs": result.body_outputs,
            "scope_resolutions": result.scope_resolutions,
            "sketch_frames": result.sketch_frames,
            "preview": result.preview,
            "diagnostics": result.diagnostics,
            "bodies": [
                {
                    "id": body.id,
                    "geometry_kind": body.geometry_kind,
                    "volume_mm3": body.volume_mm3,
                    "face_count": body.face_count,
                    "edge_count": body.edge_count,
                    "vertices": body.vertices,
                    "normals": body.normals,
                    "triangles": body.triangles,
                    "edge_lines": body.edge_lines,
                    "face_ranges": body.face_ranges,
                    "topology": body.topology,
                    "face_names": body.face_names,
                }
                for body in result.bodies
            ],
        }

    if path == "/api/cad/assembly":
        unavailable = engine_module.FreeCADUnavailable
        try:
            job = engine_module.assembly_job_from_json(data)
        except (KeyError, TypeError, ValueError) as error:
            raise CommandError(400, f"Malformed assembly: {error}") from None
        if len(job.instances) > 512:
            raise CommandError(413, "An assembly supports up to 512 instances.")
        try:
            result = service.geometry_engine().solve_assembly(job)
        except unavailable as error:
            # Operator-fixable, like the geometry path: say what to do.
            raise CommandError(503, str(error)) from None
        return {
            "protocol": engine_module.PROTOCOL_VERSION,
            "status": result.status,
            "engine": result.engine,
            "message": result.message,
            "solve_seconds": result.solve_seconds,
            "diagnostics": result.diagnostics,
            "instances": [
                {
                    "id": instance.id,
                    "placement_mm": list(instance.placement_mm),
                    "rotation": list(instance.rotation),
                }
                for instance in result.instances
            ],
        }

    if path == "/api/cad/mate-kinds":
        # What the engine can actually mate, so the UI never offers a kind
        # the solver would refuse — the lesson from Shell and Sweep.
        return {"ok": True, "kinds": sorted(engine_module.JOINT_KINDS)}

    if path == "/api/cad/engine":
        unavailable = engine_module.FreeCADUnavailable
        try:
            return {"ok": True, **service.geometry_engine().describe()}
        except unavailable as error:
            # Operator-fixable, so report it as data rather than a failure:
            # the UI shows which engine is live, or why none is.
            return {"ok": False, "error": str(error)}

    raise CommandError(404, "Unknown CAD endpoint.")
