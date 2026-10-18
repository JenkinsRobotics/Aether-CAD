"""Rigid face motion using native offset/draft surface extension and solid healing.

FreeCAD public APIs: Solid.offsetFaces and PartDesign::Draft (FeatureDraft.cpp).
Planar translations change signed supporting-plane distances. Rotations derive
an exact neutral intersection and use the native draft builder. Every resulting
boundary is checked against its requested supporting surface before publication.
"""
import math

from aether_freecad.part_transform import _number, _vector, transformed_shape
from aether_freecad.transform_reference import resolve_transform


def _normal(face):
    return face.normalAt(*face.Surface.parameter(face.CenterOfMass))


def _moved(face, transform):
    result = face.copy()
    if transform['kind'] == 'translate':
        result.translate(_vector(transform.get('translationMillimeters'), 'Face translation'))
    else:
        axis = _vector(transform.get('axisDirection'), 'Face rotation axis')
        angle = transform.get('angleDegrees')
        if abs(axis.Length - 1) > 1e-6 or not _number(angle):
            raise ValueError('Face rotation needs a unit axis and finite angle.')
        result.rotate(_vector(transform.get('axisOriginMillimeters'), 'Face rotation origin'), axis, angle)
    return result


def _on_support(actual, expected, tolerance):
    """Check native surface position AND material-side orientation, not just volume."""
    if type(actual.Surface) is not type(expected.Surface):
        return False
    points = [v.Point for v in actual.Vertexes]
    points += [e.valueAt((e.FirstParameter + e.LastParameter) / 2) for e in actual.Edges if e.Length > 1e-9]
    u0, u1, v0, v1 = actual.ParameterRange
    uv = ((u0 + u1) / 2, (v0 + v1) / 2)
    points.append(actual.Surface.value(*uv))
    try:
        for point in points:
            u, v = expected.Surface.parameter(point)
            if (expected.Surface.value(u, v) - point).Length > tolerance:
                return False
        point = actual.Surface.value(*uv)
        return actual.normalAt(*uv).dot(expected.normalAt(*expected.Surface.parameter(point))) > 1 - 1e-7
    except (ValueError, RuntimeError):
        return False


def _check(result, original, expected):
    if (result.isNull() or not result.isValid() or len(result.Solids) != 1
            or not math.isfinite(result.Volume) or result.Volume <= 1e-9):
        raise ValueError('Face motion must leave a valid solid. Reduce the movement or change the selection.')
    result.check(True)
    tolerance = max(1e-6, original.BoundBox.DiagonalLength * 1e-8)
    if (len(result.Faces) != len(expected)
            or any(not any(_on_support(face, target, tolerance) for target in expected) for face in result.Faces)
            or any(not any(_on_support(face, target, tolerance) for face in result.Faces) for target in expected)):
        raise ValueError('The native kernel could not preserve the requested face surfaces and adjoining boundaries. Reduce the movement or change the selection.')
    return result


def _draft_face(document, shape, index, point, pull, angle, expected):
    import FreeCAD

    names = []
    try:
        body = document.addObject('PartDesign::Body', 'FaceRotationTool')
        names.append(body.Name)
        source = body.newObject('PartDesign::Feature', 'FaceRotationSource')
        names.append(source.Name)
        source.Shape = shape
        neutral = body.newObject('PartDesign::Plane', 'FaceRotationNeutral')
        names.append(neutral.Name)
        neutral.Placement = FreeCAD.Placement(point, FreeCAD.Rotation(FreeCAD.Vector(0, 0, 1), pull))
        body.Tip = source
        draft = body.newObject('PartDesign::Draft', 'FaceRotation')
        names.append(draft.Name)
        draft.Base = (source, [f'Face{index + 1}'])
        draft.NeutralPlane = (neutral, [''])
        draft.Angle = angle
        # Material-side orientation can reverse the kernel's draft convention.
        # Qualify the bounded native alternatives against the requested plane.
        for reverse in [False, True]:
            draft.Reversed = reverse
            document.recompute()
            result = draft.Shape
            if ('Invalid' not in draft.State and not result.isNull() and result.isValid()
                    and any(_on_support(face, expected, 1e-6) for face in result.Faces)):
                return result.copy()
        raise ValueError('The native kernel could not rotate this face while healing its neighbors. Reduce the angle or change the axis.')
    finally:
        for name in reversed(names):
            document.removeObject(name)


def _rotate_planes(document, shape, selected, transform):
    result = shape.copy()
    for source in selected:
        expected = _moved(source, transform)
        matches = [i for i, face in enumerate(result.Faces) if _on_support(face, source, 1e-6)]
        if len(matches) != 1:
            raise ValueError('A rotating face changed or is ambiguous. Reselect the face.')
        index = matches[0]
        face = result.Faces[index]
        normal, target = _normal(face), _normal(expected)
        cross = normal.cross(target)
        dot = normal.dot(target)
        if dot <= 1e-7:
            raise ValueError('This face rotation crosses a right angle. Use a smaller angle or edit the source feature.')
        if cross.Length < 1e-9:
            offset = normal.dot(expected.CenterOfMass - face.CenterOfMass)
            if abs(offset) > 1e-9:
                result = result.offsetFaces([face], offset)
            continue
        d1, d2 = normal.dot(face.CenterOfMass), target.dot(expected.CenterOfMass)
        point = (target.cross(cross) * d1 + cross.cross(normal) * d2) / cross.dot(cross)
        pull = (cross / cross.Length).cross(normal)
        angle = math.degrees(math.atan2(cross.Length, dot))
        result = _draft_face(document, result, index, point, pull, angle, expected)
    return result


def moved_shape(document, shape, faces, transform):
    import Part

    results = []
    for solid in shape.Solids:
        selected = [face for face in faces if any(face.isSame(f) for f in solid.Faces)]
        if not selected:
            result = solid.copy()
        elif len(selected) == len(solid.Faces):
            result = transformed_shape(solid, transform)
        else:
            if any(not isinstance(face.Surface, Part.Plane) for face in selected):
                raise ValueError('Translate and Rotate currently require planar faces, or all faces of a solid. Curved-face relocation needs further native support; Offset can change its radius.')
            if transform['kind'] == 'translate':
                delta = _vector(transform.get('translationMillimeters'), 'Face translation')
                offsets = {face: _normal(face).dot(delta) for face in selected if abs(_normal(face).dot(delta)) > 1e-9}
                result = solid.offsetFaces(offsets) if offsets else solid.copy()
            else:
                result = _rotate_planes(document, solid, selected, transform)
        targets = [_moved(face, transform) if any(face.isSame(f) for f in faces) else face for face in solid.Faces]
        results.append(_check(result, solid, targets))
    tolerance = max(1e-7, shape.Volume * 1e-9)
    for i, solid in enumerate(results):
        if any(solid.common(other).Volume > tolerance for other in results[:i]):
            raise ValueError('Face movement makes disconnected solids overlap.')
    result = results[0] if len(results) == 1 else Part.makeCompound(results)
    if result.cut(shape).Volume + shape.cut(result).Volume <= tolerance:
        raise ValueError('This movement changes no material. Choose a direction or axis that moves the selected face surface.')
    return result


def move_faces(document, feature, bodies, snapshots, targets):
    p = feature.parameters
    transform, direction = resolve_transform(p.get('transform'), snapshots)
    if transform.get('kind') not in ('translate', 'rotate'):
        raise ValueError('Faces can be translated or rotated. Scale and Copy apply to whole parts.')
    frame = p.get('_preview_frame')
    if isinstance(frame, dict):
        from aether_freecad.transform_preview import transform_frame
        source = {str(i): face for i, face in enumerate(face for faces in targets.values() for face in faces)}
        frame.update(transform_frame(source, {'body_ids': list(source)}) or {})
        frame['resolved_transform'] = transform
        if direction is not None:
            frame['reference_direction'] = list(direction)
    pending = {key: moved_shape(document, bodies[key].Shape, faces, transform) for key, faces in targets.items()}
    from aether_freecad.offset_face import publish_faces
    publish_faces(document, feature, bodies, snapshots, pending)
