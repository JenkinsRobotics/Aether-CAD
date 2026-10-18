"""Saved STEP source to a native PartDesign base feature (FreeCAD public API)."""

import base64
from pathlib import Path
import tempfile


def import_step(document, body, parameters):
    import Part

    encoded = parameters.get("data_base64")
    if not isinstance(encoded, str) or len(encoded) > 4 * 1024 * 1024:
        raise ValueError("Invalid STEP source (maximum 3 MiB).")
    data = base64.b64decode(encoded, validate=True)
    if not data:
        raise ValueError("STEP source is empty.")
    with tempfile.TemporaryDirectory(prefix="aether-step-") as directory:
        path = Path(directory) / "source.step"
        path.write_bytes(data)
        shape = Part.Shape()
        shape.read(str(path))
    if shape.isNull() or not shape.isValid() or not shape.Solids:
        raise ValueError("STEP must contain valid solid geometry.")
    # Do not silently drop surfaces from a mixed solid/surface file.
    if sum(len(s.Faces) for s in shape.Solids) != len(shape.Faces):
        raise ValueError(
            "STEP contains unsewn surfaces; repair them before solid import."
        )
    feature = document.addObject("PartDesign::Feature", "ImportedSTEP")
    body.addObject(feature)
    feature.Shape = shape
    body.Tip = feature
    return feature
