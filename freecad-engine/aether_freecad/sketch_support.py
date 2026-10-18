"""Conservative planar support: unique oriented face at a named history snapshot."""


def resolve_support(support, snapshots):
    import FreeCAD
    from aether_freecad.planar_reference import resolve_planar_face

    shape = snapshots.get((support.get("sourceFeatureId"), support.get("bodyId")))
    if shape is None:
        raise ValueError("Sketch support body is unavailable at its source feature. Edit the sketch and reselect a planar face.")
    normal = FreeCAD.Vector(*support["normal"])
    face = resolve_planar_face(shape, normal, "Sketch support", support.get("faceAnchor"))
    center = face.CenterOfMass
    return {"originMillimeters": [center.x, center.y, center.z],
            "normal": support["normal"], "xDirection": support["xDirection"]}
