"""Planar-face drafting through native PartDesign::Draft.

Geometric plane references resolve on each rebuild; FaceN names are never saved.
Property contract: FreeCAD src/Mod/PartDesign/App/FeatureDraft.cpp.
"""

import math
import FreeCAD
from aether_freecad.modeling import faces_in_plane


def draft(document, body, parameters):
    tip = body.Tip
    if tip is None or tip.Shape.isNull():
        raise ValueError("Choose an existing target body for Draft.")
    angle = float(parameters.get("angle_deg", 0))
    if not math.isfinite(angle) or not 0 < angle < 90:
        raise ValueError("Draft angle must be greater than 0 and less than 90 degrees.")
    face_offset = float(parameters.get("face_offset_mm", 0))
    neutral_offset = float(parameters.get("neutral_offset_mm", 0))
    if not math.isfinite(face_offset) or not math.isfinite(neutral_offset):
        raise ValueError("Draft plane offsets must be finite.")
    faces = faces_in_plane(tip.Shape, parameters.get("face_plane"), face_offset)
    if not faces:
        raise ValueError(
            "Draft face is unavailable on the selected plane. Repair the face reference."
        )
    if len(faces) != 1:
        raise ValueError(
            "Several faces match the draft plane. Choose an unambiguous face reference."
        )
    plane = parameters.get("neutral_plane")
    axis = {"XY": (0, 0, 1), "XZ": (0, 1, 0), "YZ": (1, 0, 0)}.get(plane)
    if axis is None:
        raise ValueError("Unknown neutral plane.")
    normal = FreeCAD.Vector(*axis)
    neutral = body.newObject("PartDesign::Plane", "DraftNeutralPlane")
    neutral.Placement = FreeCAD.Placement(
        normal * neutral_offset, FreeCAD.Rotation(FreeCAD.Vector(0, 0, 1), normal)
    )
    body.Tip = tip
    result = body.newObject("PartDesign::Draft", "Draft")
    result.Base = (tip, faces)
    result.NeutralPlane = (neutral, [""])
    result.Angle = angle
    result.Reversed = bool(parameters.get("reversed", False))
    document.recompute()
    return result
