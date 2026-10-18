"""The one boundary between Aether CAD and FreeCAD.

Everything Aether asks of FreeCAD crosses here, as JSON. Nothing else in the
repository imports FreeCAD, and nothing in this protocol mentions a FreeCAD
type. That is deliberate: the engine is meant to be replaceable centrally, so
the contract is written in Aether's terms — features, millimetres, meshes,
face names — and a different engine can satisfy it without anything upstream
changing.

Keep this file free of FreeCAD imports. It is read by both sides, and the
Aether side runs in a Python that has no FreeCAD on its path.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

PROTOCOL_VERSION = 1


@dataclass(frozen=True)
class Feature:
    """One parametric operation, in Aether's vocabulary.

    `kind` names the operation; `parameters` carries its millimetre/degree
    values. Deliberately open: the engine rejects kinds it cannot build rather
    than the protocol constraining what may be asked.
    """

    id: str
    kind: str
    parameters: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class BuildJob:
    """Build a part from an ordered feature list.

    Stateless by contract: the result depends only on this job. `rollback`
    truncates the list, which is how Aether's rollback bar is expressed
    without the engine holding a document between calls.
    """

    features: list[Feature]
    rollback: int | None = None
    tessellation_tolerance_mm: float = 0.1
    preview_feature_id: str | None = None


@dataclass(frozen=True)
class Body:
    """Evaluated geometry for one solid or explicitly tagged reference mesh.

    Reference meshes have no exact topology; volume_mm3 is an unused zero.

    `face_names` are the engine's own sub-element identifiers, in the same
    order as the faces they label, so the browser can send a selection back.
    They are engine-stable, NOT Aether-stable — see the topological naming
    note in the module README.
    """

    volume_mm3: float
    face_count: int
    edge_count: int
    vertices: list[float]
    """Per-vertex normals, parallel to `vertices`."""
    normals: list[float]
    triangles: list[int]
    """Edge display lines as flat segment pairs."""
    edge_lines: list[float]
    """Which triangles belong to which face — what picking needs."""
    face_ranges: list[dict[str, int]]
    topology: list[dict[str, Any]]
    face_names: list[str]
    id: str | None = None
    geometry_kind: str = "solid"


@dataclass(frozen=True)
class BuildResult:
    status: Literal["ok", "error"]
    bodies: list[Body] = field(default_factory=list)
    """Per-feature outcome, so a failure names the feature that caused it."""
    diagnostics: list[dict[str, Any]] = field(default_factory=list)
    message: str = ""
    engine: str = ""
    build_seconds: float = 0.0
    body_outputs: dict[str, list[str]] = field(default_factory=dict)
    scope_resolutions: dict[str, dict[str, Any]] = field(default_factory=dict)
    sketch_frames: dict[str, dict[str, Any]] = field(default_factory=dict)
    preview: dict[str, Any] | None = None


class GeometryEngine(Protocol):
    """What Aether CAD requires of a geometry engine.

    FreeCAD satisfies this today. The browser OCCT/WASM path could satisfy it
    too, and so could a future engine — which is the point of writing it down.
    """

    def describe(self) -> dict[str, Any]:
        """Engine name, version and licence, for the About box and logs."""

    def build(self, job: BuildJob) -> BuildResult:
        """Evaluate a feature list into geometry. Must not retain state."""


def job_to_json(job: BuildJob) -> dict[str, Any]:
    return {
        "protocol": PROTOCOL_VERSION,
        "rollback": job.rollback,
        "preview_feature_id": job.preview_feature_id,
        "tessellation_tolerance_mm": job.tessellation_tolerance_mm,
        "features": [
            {"id": f.id, "kind": f.kind, "parameters": f.parameters}
            for f in job.features
        ],
    }


def job_from_json(payload: dict[str, Any]) -> BuildJob:
    version = payload.get("protocol")
    if version != PROTOCOL_VERSION:
        raise ValueError(f"unsupported protocol {version!r}")
    return BuildJob(
        features=[
            Feature(
                id=str(item["id"]),
                kind=str(item["kind"]),
                parameters=dict(item.get("parameters") or {}),
            )
            for item in payload.get("features") or []
        ],
        rollback=payload.get("rollback"),
        preview_feature_id=payload.get("preview_feature_id"),
        tessellation_tolerance_mm=float(
            payload.get("tessellation_tolerance_mm") or 0.1
        ),
    )


def result_from_json(payload: dict[str, Any]) -> BuildResult:
    return BuildResult(
        status="ok" if payload.get("status") == "ok" else "error",
        bodies=[
            Body(
                id=body.get("id"),
                geometry_kind=body.get("geometry_kind", "solid"),
                volume_mm3=float(body["volume_mm3"]),
                face_count=int(body["face_count"]),
                edge_count=int(body["edge_count"]),
                vertices=[float(v) for v in body.get("vertices") or []],
                normals=[float(n) for n in body.get("normals") or []],
                triangles=[int(t) for t in body.get("triangles") or []],
                edge_lines=[float(e) for e in body.get("edge_lines") or []],
                face_ranges=list(body.get("face_ranges") or []),
                topology=list(body.get("topology") or []),
                face_names=[str(n) for n in body.get("face_names") or []],
            )
            for body in payload.get("bodies") or []
        ],
        preview=payload.get("preview"),
        body_outputs=dict(payload.get("body_outputs") or {}),
        sketch_frames=dict(payload.get("sketch_frames") or {}),
        scope_resolutions=dict(payload.get("scope_resolutions") or {}),
        diagnostics=list(payload.get("diagnostics") or []),
        message=str(payload.get("message") or ""),
        engine=str(payload.get("engine") or ""),
        build_seconds=float(payload.get("build_seconds") or 0.0),
    )


#: Aether's mate vocabulary -> FreeCAD's JointTypes. Ours is what documents
#: save; FreeCAD's is an implementation detail of the worker. Declared here,
#: with the protocol, because the host has to know which mates it may offer
#: without importing FreeCAD to find out.
JOINT_KINDS = {
    "fastened": "Fixed",
    "revolute": "Revolute",
    "cylindrical": "Cylindrical",
    #: Onshape and Aether say prismatic; FreeCAD says Slider.
    "prismatic": "Slider",
    "ball": "Ball",
    "distance": "Distance",
    "parallel": "Parallel",
    "perpendicular": "Perpendicular",
    "angle": "Angle",
    "rack-pinion": "RackPinion",
    "screw": "Screw",
    "gears": "Gears",
    "belt": "Belt",
}


# --- Assemblies -----------------------------------------------------------
#
# Stateless by the same contract as BuildJob: one job fully describes an
# assembly, so the engine holds no document between calls and the same job
# always solves to the same placements.


@dataclass(frozen=True)
class PartDefinition:
    """A part an assembly can place, given as the features that build it.

    Defined once and instanced many times, so a job carrying twenty of the
    same bracket builds it once.
    """

    id: str
    features: list[Feature] = field(default_factory=list)


@dataclass(frozen=True)
class Instance:
    """One placed occurrence of a part definition.

    `placement_mm` and `rotation` are the starting pose. The solver moves
    everything that is not grounded, so this is a seed, not a constraint —
    except for a grounded instance, which stays exactly here.
    """

    id: str
    part: str
    placement_mm: tuple[float, float, float] = (0.0, 0.0, 0.0)
    #: Quaternion, x/y/z/w — the order FreeCAD's Rotation takes.
    rotation: tuple[float, float, float, float] = (0.0, 0.0, 0.0, 1.0)
    grounded: bool = False


@dataclass(frozen=True)
class JointEnd:
    """One side of a joint: an instance, and where on it.

    Two ways to say where. `element` is a sub-element name such as `Face3` or
    `Vertex1`, and FreeCAD derives the joint frame from that geometry. Or give
    `placement_mm`/`rotation` directly — an Aether mate connector *is* a joint
    coordinate system, so a connector frame maps onto one exactly, and the
    engine detaches the frame from geometry so the solver uses it verbatim.

    A frame wins over an element when both are given. Neither means the
    instance's own placement, which is how a mate attaches to a part rather
    than to a feature of it.
    """

    instance: str
    element: str = ""
    #: The connector frame on this part, if the mate names one.
    placement_mm: tuple[float, float, float] | None = None
    rotation: tuple[float, float, float, float] | None = None


@dataclass(frozen=True)
class Joint:
    """A mate, in Aether's vocabulary.

    `kind` is Aether's name (`fastened`, `prismatic`, ...); the engine
    translates to FreeCAD's (`Fixed`, `Slider`, ...). Keeping our vocabulary
    at the boundary is what lets the engine be replaced without renaming
    every saved mate.
    """

    id: str
    kind: str
    a: JointEnd
    b: JointEnd
    parameters: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class AssemblyJob:
    parts: list[PartDefinition] = field(default_factory=list)
    instances: list[Instance] = field(default_factory=list)
    joints: list[Joint] = field(default_factory=list)


@dataclass(frozen=True)
class SolvedInstance:
    """Where the solver put an instance."""

    id: str
    placement_mm: tuple[float, float, float]
    rotation: tuple[float, float, float, float]


@dataclass(frozen=True)
class AssemblyResult:
    status: str
    engine: str = ""
    message: str = ""
    solve_seconds: float = 0.0
    instances: list[SolvedInstance] = field(default_factory=list)
    diagnostics: list[dict[str, Any]] = field(default_factory=list)


def _end_to_json(end: JointEnd) -> dict[str, Any]:
    payload: dict[str, Any] = {"instance": end.instance, "element": end.element}
    if end.placement_mm is not None:
        payload["placement_mm"] = list(end.placement_mm)
    if end.rotation is not None:
        payload["rotation"] = list(end.rotation)
    return payload


def assembly_job_to_json(job: AssemblyJob) -> dict[str, Any]:
    return {
        "request": "assembly",
        "protocol": PROTOCOL_VERSION,
        "parts": [
            {"id": part.id,
             "features": [
                 {"id": f.id, "kind": f.kind, "parameters": f.parameters}
                 for f in part.features
             ]}
            for part in job.parts
        ],
        "instances": [
            {"id": i.id, "part": i.part, "placement_mm": list(i.placement_mm),
             "rotation": list(i.rotation), "grounded": i.grounded}
            for i in job.instances
        ],
        "joints": [
            {"id": j.id, "kind": j.kind, "a": _end_to_json(j.a),
             "b": _end_to_json(j.b), "parameters": j.parameters}
            for j in job.joints
        ],
    }


def assembly_job_from_json(payload: dict[str, Any]) -> AssemblyJob:
    def end(value: Any) -> JointEnd:
        value = value or {}
        position = value.get("placement_mm")
        rotation = value.get("rotation")
        return JointEnd(
            str(value.get("instance", "")),
            str(value.get("element", "")),
            tuple(float(v) for v in position) if position is not None else None,
            tuple(float(v) for v in rotation) if rotation is not None else None,
        )

    return AssemblyJob(
        parts=[
            PartDefinition(
                id=str(part["id"]),
                features=[
                    Feature(str(f["id"]), str(f["kind"]), dict(f.get("parameters") or {}))
                    for f in part.get("features") or []
                ],
            )
            for part in payload.get("parts") or []
        ],
        instances=[
            Instance(
                id=str(i["id"]),
                part=str(i["part"]),
                placement_mm=tuple(float(v) for v in (i.get("placement_mm") or (0, 0, 0))),
                rotation=tuple(float(v) for v in (i.get("rotation") or (0, 0, 0, 1))),
                grounded=bool(i.get("grounded")),
            )
            for i in payload.get("instances") or []
        ],
        joints=[
            Joint(
                id=str(j["id"]),
                kind=str(j["kind"]),
                a=end(j.get("a")),
                b=end(j.get("b")),
                parameters=dict(j.get("parameters") or {}),
            )
            for j in payload.get("joints") or []
        ],
    )


def assembly_result_from_json(payload: dict[str, Any]) -> AssemblyResult:
    return AssemblyResult(
        status=str(payload.get("status", "error")),
        engine=str(payload.get("engine", "")),
        message=str(payload.get("message", "")),
        solve_seconds=float(payload.get("solve_seconds") or 0.0),
        instances=[
            SolvedInstance(
                id=str(i["id"]),
                placement_mm=tuple(float(v) for v in i["placement_mm"]),
                rotation=tuple(float(v) for v in i["rotation"]),
            )
            for i in payload.get("instances") or []
        ],
        diagnostics=list(payload.get("diagnostics") or []),
    )
