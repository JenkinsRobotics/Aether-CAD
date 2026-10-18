"""Resolve a parallel extrusion start using current native history geometry."""
import math


def resolve_start(reference, built):
    from aether_freecad.face_extrude import unique_planar_face

    if not isinstance(reference, dict):
        raise TypeError('Choose a starting face or reference plane.')
    if reference.get('kind') == 'face':
        shape = built.get((reference.get('sourceFeatureId'), reference.get('bodyId')))
        if shape is None:
            raise ValueError('Starting face is unavailable. Reselect an earlier planar face.')
        normal = _vector(reference.get('normal'), unit=True)
        face = unique_planar_face(shape, normal, 'Starting face', reference.get('faceAnchor'))
        return face.CenterOfMass, normal
    if reference.get('kind') == 'plane':
        frame = reference.get('frame') or {}
        return _vector(frame.get('originMillimeters')), _vector(frame.get('normal'), unit=True)
    raise ValueError('Unknown extrusion starting entity.')


def _vector(value, unit=False):
    from FreeCAD import Vector

    if (not isinstance(value, list) or len(value) != 3
            or any(isinstance(v, bool) or not isinstance(v, (int, float))
                   or not math.isfinite(v) for v in value)):
        raise ValueError('Starting plane needs finite coordinates and a unit normal.')
    result = Vector(*value)
    if unit and abs(result.Length - 1) > 1e-6:
        raise ValueError('Starting plane needs a unit normal.')
    return result


def starting_parameters(planar, direction, parameters):
    """Depth starts at the reference; draft retains the original sketch neutral.

    A signed extra offset is measured along the extrusion axis. Resolve once
    before constructing independent ends so they share exactly one start plane.
    """
    plane = parameters.get('_start_plane')
    if plane is None:
        return parameters
    origin, normal = plane
    profile_normal = planar.Faces[0].normalAt(0, 0)
    if normal.cross(profile_normal).Length > 1e-7:
        raise ValueError('Starting entity must be parallel to the sketch plane.')
    alignment = normal.dot(direction)
    if abs(alignment) < 1e-7:
        raise ValueError('Extrusion direction must leave the starting plane.')
    offset = normal.dot(origin - planar.CenterOfMass) / alignment
    offset += float(parameters.get('starting_offset_mm', 0))
    if not math.isfinite(offset):
        raise ValueError('Starting offset must be finite.')
    return {**parameters, 'starting_offset_mm': offset}
