"""Geometric curved-face references; never an unchecked FaceN index."""
import math

SURFACE_TYPES = {
    'Cylinder': 'cylinder', 'Cone': 'cone', 'Sphere': 'sphere', 'Toroid': 'torus',
    'BSplineSurface': 'bspline', 'BezierSurface': 'bezier',
    'SurfaceOfExtrusion': 'extrusion', 'SurfaceOfRevolution': 'revolution',
}


def surface_type(face):
    return SURFACE_TYPES.get(type(face.Surface).__name__)


def resolve_surface_face(shape, reference, label='Up to face'):
    import FreeCAD

    kind = reference.get('surfaceType')
    if kind not in SURFACE_TYPES.values():
        raise ValueError(f'{label} needs a supported native surface reference. Reselect the face.')
    anchor = reference.get('faceAnchor')
    if anchor is not None:
        center = anchor.get('centerMillimeters') if isinstance(anchor, dict) else None
        area = anchor.get('areaSquareMillimeters') if isinstance(anchor, dict) else None
        if (not isinstance(center, list) or len(center) != 3
                or any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in center)
                or isinstance(area, bool) or not isinstance(area, (int, float)) or not math.isfinite(area) or area <= 0):
            raise ValueError(f'{label} has an invalid surface anchor. Reselect the face.')
        center = FreeCAD.Vector(*center)
    matches = [face for face in shape.Faces if surface_type(face) == kind
               and (anchor is None or ((face.CenterOfMass - center).Length <= 1e-6
                    and abs(face.Area-area) <= max(1e-6, area*1e-9)))]
    if len(matches) != 1:
        raise ValueError(f'{label} surface is missing, changed or ambiguous. Reselect the face on the earlier geometry.')
    return matches[0]


def reference_for_surface(shape, face):
    """Native picking hint; only unambiguous geometry can be authored."""
    kind=surface_type(face)
    if kind is None:
        return None
    reference={'surfaceType':kind}
    peers=[candidate for candidate in shape.Faces if surface_type(candidate)==kind]
    if len(peers)>1:
        c=face.CenterOfMass
        reference['faceAnchor']={'centerMillimeters':[c.x,c.y,c.z],'areaSquareMillimeters':face.Area}
        try:
            resolve_surface_face(shape,reference)
        except ValueError:
            return None
    return reference
