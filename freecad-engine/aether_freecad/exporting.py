"""Native file output from a validated rebuild; no display-mesh approximation for STEP."""

import base64
import math
import tempfile
from pathlib import Path
import Part
import Mesh
import MeshPart


def export_bodies(bodies, options):
    kind = options.get("format")
    if kind not in ("step", "stl"):
        raise ValueError("Choose STEP or STL.")
    ids = options.get("body_ids")
    if ids is not None and (
        not isinstance(ids, list) or not ids or any(i not in bodies for i in ids)
    ):
        raise ValueError("An export body is unavailable.")
    selected = [body for key, body in bodies.items() if ids is None or key in ids]
    if not selected:
        raise ValueError("Import or create geometry before exporting.")
    tolerance = float(options.get("tolerance_mm", 0.1))
    if not math.isfinite(tolerance) or not 0.001 <= tolerance <= 5:
        raise ValueError("Mesh tolerance must be between 0.001 and 5 mm.")
    if kind == "step" and any(hasattr(body, "Mesh") for body in selected):
        raise ValueError("STEP needs solid bodies. Select a solid or convert the mesh import to a solid first.")
    with tempfile.TemporaryDirectory(prefix="aether-export-") as folder:
        path = Path(folder) / f"part.{kind}"
        if kind == "step":
            Part.makeCompound([body.Shape for body in selected]).exportStep(str(path))
        else:
            mesh = Mesh.Mesh()
            for body in selected:
                if hasattr(body, "Mesh"):
                    mesh.addMesh(body.Mesh)
                    continue
                mesh.addMesh(
                    MeshPart.meshFromShape(
                        Shape=body.Shape,
                        LinearDeflection=tolerance,
                        AngularDeflection=0.35,
                        Relative=False,
                    )
                )
            if not any(hasattr(body, "Mesh") for body in selected) and not mesh.isSolid():
                raise ValueError("Export did not produce a closed STL mesh.")
            mesh.write(str(path))
        data = path.read_bytes()
        if len(data) > 64 * 1024 * 1024:
            raise ValueError("Export exceeds the 64 MB download limit.")
    return {
        "status": "ok",
        "format": kind,
        "units": "mm",
        "body_count": len(selected),
        "data_base64": base64.b64encode(data).decode("ascii"),
    }
