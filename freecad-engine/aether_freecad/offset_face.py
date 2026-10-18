"""Exact selected-face offsets through FreeCAD's public Solid.offsetFaces API.

API reference: FreeCAD src/Mod/Part/App/TopoShapeSolidPyImp.cpp::offsetFaces.
The native offset builder extends adjacent surfaces; no prism or display mesh
substitutes for the moved boundary. All target shapes are validated before commit.
"""
import math


def _resolve(shape, reference):
    import FreeCAD

    from aether_freecad.planar_reference import resolve_planar_face
    from aether_freecad.surface_reference import resolve_surface_face

    if 'surfaceType' in reference:
        if 'normal' in reference:
            raise ValueError('Offset faces needs a single unambiguous surface reference.')
        return resolve_surface_face(shape, reference, label='Offset faces')
    values = reference.get('normal')
    if (not isinstance(values, list) or len(values) != 3
            or any(isinstance(v, bool) or not isinstance(v, (float, int)) or not math.isfinite(v) for v in values)
            or abs(math.hypot(*values)-1) > 1e-6):
        raise ValueError('Offset faces needs a unit planar normal or curved surface reference.')
    return resolve_planar_face(shape, FreeCAD.Vector(*values), 'Offset faces', reference.get('faceAnchor'))


def _check_radius(face, distance):
    """OCCT can return a valid inverted cylinder after passing its zero radius."""
    import Part

    surface = face.Surface
    if not isinstance(surface, (Part.Cylinder, Part.Sphere, Part.Toroid)):
        return
    u0, u1, v0, v1 = face.ParameterRange
    u, v = (u0+u1)/2, (v0+v1)/2
    normal = face.normalAt(u, v)
    radial = surface.value(u, v)-surface.Center
    if isinstance(surface, (Part.Cylinder, Part.Toroid)):
        axial = radial-surface.Axis*radial.dot(surface.Axis)
        if isinstance(surface, Part.Toroid):
            axial.normalize()
            radial = radial-axial*surface.MajorRadius
        else:
            radial = axial
    geometric = radial
    sign = 1 if normal.dot(geometric) > 0 else -1
    radius = surface.MinorRadius if isinstance(surface, Part.Toroid) else surface.Radius
    if radius+sign*distance <= 1e-7:
        raise ValueError('Offset collapses or inverts a curved face radius. Reduce the distance.')


def _offset_shape(shape, faces, distance):
    import Part

    for face in faces:
        _check_radius(face, distance)
    results = []
    for solid in shape.Solids:
        selected = [face for face in faces if any(face.isSame(candidate) for candidate in solid.Faces)]
        result = solid.offsetFaces(selected, distance).removeSplitter() if selected else solid.copy()
        if result.isNull() or not result.isValid() or len(result.Solids) != 1 or result.Volume <= 1e-9:
            raise ValueError('Offset faces must leave valid solid geometry. Reduce the distance or change the selection.')
        result.check(True)
        results.append(result)
    result = results[0] if len(results) == 1 else Part.makeCompound(results)
    tolerance = max(1e-7, shape.Volume*1e-9)
    unexpected = shape.cut(result) if distance > 0 else result.cut(shape)
    if unexpected.Volume > tolerance:
        raise ValueError('Offset would invert, cross or remove the wrong side of a face. Reduce the distance.')
    if (result.Volume-shape.Volume)*(1 if distance > 0 else -1) <= tolerance:
        raise ValueError('Offset faces changes no material. Check the selection and distance.')
    # Separate shells of one imported body must not become overlapping solids.
    for i, solid in enumerate(results):
        if any(solid.common(other).Volume > tolerance for other in results[:i]):
            raise ValueError('Offset makes disconnected solids overlap. Reduce the distance or separate the parts.')
    return result


def offset_faces(document, feature, bodies, snapshots):
    parameters = feature.parameters
    distance = parameters.get('distance_mm')
    references = parameters.get('faces')
    if 'transform' not in parameters and (isinstance(distance, bool) or not isinstance(distance, (float, int))
            or not math.isfinite(distance) or abs(distance) < 1e-6):
        raise ValueError('Offset distance must be finite and nonzero.')
    if not isinstance(references, list) or not 0 < len(references) <= 256:
        raise ValueError('Choose one or more faces to offset (up to 256).')
    targets = {}
    for ref in references:
        if not isinstance(ref, dict):
            raise TypeError('Offset faces needs valid source references.')
        key, source_id = ref.get('bodyId'), ref.get('sourceFeatureId')
        if not isinstance(key, str) or not isinstance(source_id, str):
            raise TypeError('Offset faces needs source and body identities.')
        body, source = bodies.get(key), snapshots.get((source_id, key))
        if body is None or not hasattr(body, 'Shape') or body.Shape.isNull() or not body.Shape.Solids or source is None:
            raise ValueError('An offset source or target solid is unavailable. Reselect its faces.')
        _resolve(source, ref)
        face = _resolve(body.Shape, ref)
        selected = targets.setdefault(key, [])
        if any(face.isSame(previous) for previous in selected):
            raise ValueError('Select each offset face only once.')
        selected.append(face)
    if 'transform' in parameters:
        if 'distance_mm' in parameters:
            raise ValueError('Choose an offset distance or a face transform, not both.')
        from aether_freecad.move_face import move_faces
        move_faces(document, feature, bodies, snapshots, targets)
        return
    axes = parameters.get('_preview_axes')
    if isinstance(axes, list):
        face = next(iter(targets.values()))[0]
        u, v = face.Surface.parameter(face.CenterOfMass)
        axes.append({'side':'primary','parameter':'distance',
                     'originMillimeters':list(face.Surface.value(u,v)),
                     'direction':list(face.normalAt(u,v)), 'scale':1, 'reversed':False})
    pending = {key:_offset_shape(bodies[key].Shape, faces, distance) for key,faces in targets.items()}
    publish_faces(document, feature, bodies, snapshots, pending)


def publish_faces(document, feature, bodies, snapshots, pending):
    for key, shape in pending.items():
        result = document.addObject('PartDesign::Feature', 'OffsetFaces')
        bodies[key].addObject(result)
        result.Shape = shape
        bodies[key].Tip = result
        snapshots[(feature.id, key)] = shape.copy()
    document.recompute()
    if len(pending) == 1:
        snapshots[feature.id] = result
    else:
        # A single-body Pattern cannot repeat a multi-body modifier implicitly.
        snapshots.pop(feature.id, None)
