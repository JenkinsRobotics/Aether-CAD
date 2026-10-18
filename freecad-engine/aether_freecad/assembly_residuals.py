"""Check solved mate frames before publishing a native assembly solution.

FreeCAD 1.1.3 can return zero with contradictory constraints on the same pair.
This is acceptance validation, not another solver. Fixed joints require equal
coordinate frames; vertex/vertex distance joints require the specified point
distance (AssemblyObject.cpp::makeMbdJointDistance). Other distance references
have different semantics and are deliberately not treated as point distances.
"""

import math


def joint_residual_errors(joints):
    import UtilsAssembly

    errors = []
    for joint, native in joints:
        point_distance = joint.kind == "distance" and all(
            (end.element or "").startswith("Vertex") for end in (joint.a, joint.b)
        )
        if joint.kind != "fastened" and not point_distance:
            continue
        first = UtilsAssembly.getJcsGlobalPlc(native.Placement1, native.Reference1)
        second = UtilsAssembly.getJcsGlobalPlc(native.Placement2, native.Reference2)
        distance = (first.Base - second.Base).Length
        expected = float(native.Distance) if point_distance else 0.0
        tolerance = 1e-4 + 1e-8 * abs(expected)
        reason = None
        if not math.isfinite(distance) or not math.isfinite(expected) or abs(distance - expected) > tolerance:
            reason = f"position residual {abs(distance - expected):.6g} mm exceeds {tolerance:.6g} mm"
        if joint.kind == "fastened":
            rotation = first.Rotation.inverted() * second.Rotation
            angle = 2 * math.acos(min(1.0, abs(rotation.Q[3])))
            if not math.isfinite(angle) or angle > 1e-6:
                reason = f"rotation residual {angle:.6g} rad exceeds 1e-6 rad"
        if reason:
            errors.append(
                {
                    "feature_id": joint.id,
                    "severity": "error",
                    "message": f"Mate is not satisfied after solving: {reason}. Check conflicting mates or connector references.",
                }
            )
    return errors
