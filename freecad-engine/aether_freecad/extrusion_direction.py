"""World-space extrusion directions and exact planar termination."""
import math


def extrusion_direction(parameters, normal):
    from FreeCAD import Vector

    vector = parameters.get("direction_vector")
    direction = normal
    if vector is not None:
        if (not isinstance(vector, list) or len(vector) != 3
                or any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in vector)
                or abs(math.hypot(*vector) - 1) > 1e-6):
            raise ValueError("Extrusion direction must be a finite unit vector.")
        direction = Vector(*vector)
        direction.normalize()
        alignment = abs(normal.dot(direction))
        if alignment < 1e-7:
            raise ValueError("The extrusion direction is tangent to the sketch. Choose a direction that leaves its plane.")
        second = parameters.get("second_end") or {}
        if alignment < 1 - 1e-7 and (parameters.get("draft_angle_deg") or second.get("draft_angle_deg")):
            raise ValueError("Draft along an oblique direction is not supported yet. Disable Draft or use the sketch normal.")
    sign = -1 if parameters.get("operation") == "cut" else 1
    if parameters.get("reversed"):
        sign *= -1
    return direction * sign


def profile_axis(profile, direction):
    """Oriented profile normal and positive axial movement per unit travel."""
    normal = profile.Faces[0].normalAt(0, 0)
    alignment = normal.dot(direction)
    if alignment < 0:
        normal = normal * -1
        alignment = -alignment
    if alignment < 1e-7:
        raise ValueError("The extrusion direction is tangent to the sketch.")
    return normal, alignment


def next_planar_distance(profile, direction, limit, offset):
    """Complete next stop parallel to the profile, including oblique travel.

    Native face intersections select the first stop. Later obstructions cannot
    invalidate it; curved/tilted boundaries encountered before it are refused.
    """
    import Part

    from aether_freecad.extrusion_draft_limits import projection_bounds

    normal, alignment = profile_axis(profile, direction)
    origin = profile.CenterOfMass.dot(normal)
    _, maximum = projection_bounds(limit, normal)
    reach = max(1, (maximum - origin) / alignment - offset + 1)
    start = profile.copy()
    start.translate(direction * offset)
    probe = start.extrude(direction * reach)
    candidates = []
    epsilon = max(1e-8, profile.Area * 1e-8)
    for face in limit.Faces:
        if not isinstance(face.Surface, Part.Plane) or abs(face.normalAt(0, 0).dot(normal)) < 1 - 1e-7:
            continue
        distance = (face.CenterOfMass.dot(normal) - origin) / alignment
        if distance <= offset + 1e-7 or face.common(probe).Area <= epsilon:
            continue
        candidates.append(distance)
    if not candidates:
        raise ValueError("No next face found with complete parallel planar termination. Flip direction or select an explicit stopping face.")
    distance = min(candidates)
    coverage = None
    for face in limit.Faces:
        if (not isinstance(face.Surface, Part.Plane)
                or abs(face.normalAt(0, 0).dot(normal)) < 1 - 1e-7
                or abs((face.CenterOfMass.dot(normal) - origin) / alignment - distance) > 1e-7):
            continue
        projected = face.copy()
        projected.translate(direction * -distance)
        coverage = projected if coverage is None else coverage.fuse(projected)
    if coverage is None or profile.cut(coverage).Area > epsilon:
        raise ValueError("The next face does not cover the whole selected face. Split the sketch or use another limit.")
    bounded = start.extrude(direction * (distance - offset))
    for face in limit.Faces:
        if (isinstance(face.Surface, Part.Plane)
                and (abs(face.normalAt(0, 0).dot(normal)) > 1 - 1e-7 or abs(face.normalAt(0, 0).dot(direction)) < 1e-7)):
            continue
        if face.common(bounded).Area > epsilon:
            raise ValueError("Up to next encounters a curved or nonparallel boundary. Select an explicit planar stopping face.")
    return distance
