"""Signed extrusion of one conservatively resolved planar face footprint.

No saved FaceN indices, approximate meshes, or generic surface-offset claims.
"""
import math

import FreeCAD
from aether_freecad.planar_reference import resolve_planar_face


def unique_planar_face(shape, normal, label="Push/Pull", anchor=None):
    return resolve_planar_face(shape, normal, label, anchor)


def face_extrude(document, body, parameters, snapshots):
    distance = float(parameters.get("distance_mm", 0))
    if not math.isfinite(distance) or abs(distance) < 1e-6:
        raise ValueError("Push/Pull distance must be finite and nonzero.")
    values = parameters.get("normal", [])
    if len(values) != 3 or not all(math.isfinite(float(v)) for v in values):
        raise ValueError("Push/Pull needs a finite planar face normal.")
    normal = FreeCAD.Vector(*values)
    if abs(normal.Length - 1) > 1e-6:
        raise ValueError("Push/Pull needs a unit planar face normal.")
    source = snapshots.get((parameters.get("source_feature_id"), parameters.get("body_id")))
    if source is None:
        raise ValueError("Push/Pull source body is unavailable. Repair the face reference.")
    anchor = parameters.get("face_anchor")
    unique_planar_face(source, normal, anchor=anchor)
    tip = body.Tip
    if tip is None or tip.Shape.isNull():
        raise ValueError("Push/Pull target body is unavailable.")
    face = unique_planar_face(tip.Shape, normal, anchor=anchor)
    prism = face.extrude(normal * distance)
    shape = (tip.Shape.fuse(prism) if distance > 0 else tip.Shape.cut(prism)).removeSplitter()
    if shape.isNull() or not shape.isValid() or len(shape.Solids) != 1 or shape.Volume <= 1e-9:
        raise ValueError("Push/Pull must leave one valid solid. Reduce the distance.")
    delta = shape.Volume - tip.Shape.Volume
    if (distance > 0 and delta <= 1e-8) or (distance < 0 and delta >= -1e-8):
        raise ValueError("Push/Pull changes no material. Check the face and distance.")
    result = body.newObject("PartDesign::Feature", "FaceExtrude")
    result.Shape = shape
    return result
