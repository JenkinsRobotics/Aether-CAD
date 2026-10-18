"""Assemblies, solved by FreeCAD's Assembly workbench.

FreeCAD 1.1 ships the Ondsel multibody solver behind an `Assembly::AssemblyObject`,
and it runs headless — no GUI, no display. That is the whole reason this
exists: thirteen joint types and a real constraint solve arrive with the
kernel we already drive, instead of being written again.

Aether keeps its own mate vocabulary at the boundary (`fastened`, `prismatic`)
and translates here, so saved assemblies do not carry FreeCAD's names and the
engine stays replaceable — the same rule the geometry path follows for face
identity.
"""

from __future__ import annotations

import time
from typing import Any

import FreeCAD

from .protocol import JOINT_KINDS, AssemblyJob


#: Joints that read a length from their parameters, and the property to set.
_LENGTH_JOINTS = {"distance": "Distance"}
#: Joints that read an angle, in degrees.
_ANGLE_JOINTS = {"angle": "Angle"}


class AssemblyUnavailable(RuntimeError):
    """FreeCAD is present but its Assembly workbench is not importable."""


def _placement(position, rotation) -> FreeCAD.Placement:
    x, y, z, w = (float(v) for v in rotation)
    return FreeCAD.Placement(
        FreeCAD.Vector(*(float(v) for v in position)),
        FreeCAD.Rotation(x, y, z, w),
    )


def _attach_frame(joint_object, end, side: str) -> None:
    """Pin one side's joint coordinate system to a connector frame."""
    if end.placement_mm is None and end.rotation is None:
        return
    setattr(joint_object, f"Placement{side}", _placement(
        end.placement_mm or (0.0, 0.0, 0.0),
        end.rotation or (0.0, 0.0, 0.0, 1.0),
    ))
    setattr(joint_object, f"Detach{side}", True)


def solve(job: AssemblyJob, build_part) -> dict[str, Any]:
    """Place every instance, apply the joints, and solve.

    `build_part` is handed in rather than imported so this module stays about
    assemblies: it takes a document, a name and a feature list, and returns an
    object with a Shape.
    """
    try:
        import JointObject
        import UtilsAssembly
    except ImportError as error:  # pragma: no cover - depends on the install
        raise AssemblyUnavailable(
            "FreeCAD's Assembly workbench is not available in this build."
        ) from error

    started = time.time()
    document = FreeCAD.newDocument("aether-assembly")
    diagnostics: list[dict[str, Any]] = []
    try:
        assembly = document.addObject("Assembly::AssemblyObject", "Assembly")

        # One shape per definition, reused by every instance of it.
        shapes: dict[str, Any] = {}
        for part in job.parts:
            try:
                shapes[part.id] = build_part(document, f"part_{part.id}", part.features)
            except Exception as error:
                diagnostics.append({
                    "feature_id": part.id, "severity": "error",
                    "message": f"part did not build: {error}",
                })

        objects: dict[str, Any] = {}
        for instance in job.instances:
            shape = shapes.get(instance.part)
            if shape is None:
                diagnostics.append({
                    "feature_id": instance.id, "severity": "error",
                    "message": f"no part definition {instance.part!r} to place",
                })
                continue
            placed = assembly.newObject("Part::Feature", f"inst_{instance.id}")
            placed.Shape = shape.Shape
            placed.Placement = _placement(instance.placement_mm, instance.rotation)
            objects[instance.id] = placed
        document.recompute()

        group = UtilsAssembly.getJointGroup(assembly)

        # Something has to be fixed in space or the solve is under-determined
        # and every body is free to drift. If the job grounds nothing, ground
        # the first instance rather than returning a meaningless solve.
        grounded = [i for i in job.instances if i.grounded and i.id in objects]
        if not grounded and objects:
            first = next(i for i in job.instances if i.id in objects)
            grounded = [first]
            diagnostics.append({
                "feature_id": first.id, "severity": "warning",
                "message": "nothing was grounded, so this instance was held fixed",
            })
        for instance in grounded:
            ground = group.newObject("App::FeaturePython", f"ground_{instance.id}")
            JointObject.GroundedJoint(ground, objects[instance.id])

        native_joints = []
        for joint in job.joints:
            kind = JOINT_KINDS.get(joint.kind)
            if kind is None:
                diagnostics.append({
                    "feature_id": joint.id, "severity": "error",
                    "message": f"unsupported mate kind {joint.kind!r}",
                })
                continue
            first, second = objects.get(joint.a.instance), objects.get(joint.b.instance)
            if first is None or second is None:
                diagnostics.append({
                    "feature_id": joint.id, "severity": "error",
                    "message": "a mate names an instance that is not in the assembly",
                })
                continue
            try:
                obj = group.newObject("App::FeaturePython", f"joint_{joint.id}")
                JointObject.Joint(obj, JointObject.JointTypes.index(kind))
                obj.Reference1 = (first, [joint.a.element] if joint.a.element else [""])
                obj.Reference2 = (second, [joint.b.element] if joint.b.element else [""])
                # A mate connector is a joint coordinate system. When the mate
                # names one, hand it over verbatim and detach the frame, or
                # FreeCAD recomputes it from the referenced geometry and the
                # connector's own placement is lost.
                _attach_frame(obj, joint.a, "1")
                _attach_frame(obj, joint.b, "2")
                if joint.kind in _LENGTH_JOINTS and "distance_mm" in joint.parameters:
                    setattr(obj, _LENGTH_JOINTS[joint.kind], float(joint.parameters["distance_mm"]))
                if joint.kind in _ANGLE_JOINTS and "angle_deg" in joint.parameters:
                    setattr(obj, _ANGLE_JOINTS[joint.kind], float(joint.parameters["angle_deg"]))
                if joint.kind == "fastened":
                    # Use the native GUI's frame-matching initializer. Its
                    # closest-direction heuristic can pick the opposite frame
                    # for quarter/half turns. Our saved connector frames are
                    # explicit, so ask it to match those axes exactly.
                    # JointObject still owns placement and grounding semantics.
                    obj.Proxy.matchJCS(obj, False, not obj.Proxy.areJcsSameDir(obj))
                native_joints.append((joint, obj))
            except Exception as error:  # one bad mate must not lose the rest
                diagnostics.append({
                    "feature_id": joint.id, "severity": "error",
                    "message": f"mate could not be created: {error}",
                })
        document.recompute()

        errors = [item for item in diagnostics if item["severity"] == "error"]
        if objects and not errors:
            try:
                # AssemblyObject::solve returns 0 on success, negative on
                # failure; its Python binding does not raise for those codes.
                # See FreeCAD src/Mod/Assembly/App/AssemblyObject{,PyImp}.cpp.
                code = assembly.solve()
                if code != 0:
                    raise ValueError(f"native solver returned status {code}")
                document.recompute()
                from .assembly_residuals import joint_residual_errors

                diagnostics.extend(joint_residual_errors(native_joints))
            except Exception as error:
                diagnostics.append({
                    "feature_id": "assembly", "severity": "error",
                    "message": f"the solver did not converge: {error}",
                })

        errors = [item for item in diagnostics if item["severity"] == "error"]
        message = "; ".join(item["message"] for item in errors)
        solved = []
        # A partially built/solved assembly must never publish placements that
        # a caller could mistake for the requested complete solution.
        for instance in ([] if errors else job.instances):
            placed = objects.get(instance.id)
            if placed is None:
                continue
            position = placed.Placement.Base
            q = placed.Placement.Rotation.Q
            solved.append({
                "id": instance.id,
                "placement_mm": [position.x, position.y, position.z],
                "rotation": [q[0], q[1], q[2], q[3]],
            })
        return {
            "status": "error" if message else "ok",
            "message": message,
            "solve_seconds": round(time.time() - started, 6),
            "instances": solved,
            "diagnostics": diagnostics,
        }
    finally:
        FreeCAD.closeDocument(document.Name)
