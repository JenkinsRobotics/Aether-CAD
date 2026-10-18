"""Exact volume analysis of rebuilt Part solids; no document mutation."""

import math


def analyze_bodies(bodies, options, geometry, tolerance):
    import Part
    import FreeCAD as App

    if any(hasattr(body, "Mesh") for body in bodies.values()):
        raise ValueError("Exact analysis requires solid bodies. Convert mesh references to solids first.")
    shapes = {key: body.Shape for key, body in bodies.items()}
    if not shapes:
        raise ValueError("Analysis needs at least one solid body.")
    kind = options.get("kind")
    rendered = []
    measurements = []
    if kind == "properties":
        from aether_freecad.properties import physical_properties

        measurements = physical_properties(shapes, options.get("density_kg_m3"))
    elif kind == "section":
        axis = {"XY": 2, "XZ": 1, "YZ": 0}.get(options.get("plane", "XY"))
        offset = float(options.get("offset_mm", 0))
        if axis is None or not math.isfinite(offset):
            raise ValueError("Choose a principal plane and finite offset in mm.")
        for key, shape in shapes.items():
            box = shape.BoundBox
            lo = [box.XMin - 1, box.YMin - 1, box.ZMin - 1]
            hi = [box.XMax + 1, box.YMax + 1, box.ZMax + 1]
            if options.get("reverse", False):
                lo[axis] = max(lo[axis], offset)
            else:
                hi[axis] = min(hi[axis], offset)
            if any(hi[i] <= lo[i] for i in range(3)):
                continue
            cutter = Part.makeBox(*(hi[i] - lo[i] for i in range(3)), App.Vector(*lo))
            cut = shape.common(cutter)
            if cut.isNull() or cut.Volume <= 1e-9:
                continue
            if not cut.isValid():
                raise ValueError("Section failed to produce valid capped geometry.")
            rendered.append(dict(geometry(cut, tolerance), id=key))
            measurements.append({"body_id": key, "volume_mm3": cut.Volume})
    elif kind == "interference":
        if len(shapes) < 2:
            raise ValueError("Interference needs at least two body features.")
        items = list(shapes.items())
        if len(items) > 64:
            raise ValueError("Interference supports up to 64 bodies per check.")
        for i, (first_id, first) in enumerate(items):
            for second_id, second in items[i + 1 :]:
                overlap = first.common(second)
                if overlap.isNull() or overlap.Volume <= 1e-7:
                    continue
                if not overlap.isValid():
                    raise ValueError("Intersection failed; the result is not valid.")
                measurements.append(
                    {
                        "first_body_id": first_id,
                        "second_body_id": second_id,
                        "volume_mm3": overlap.Volume,
                    }
                )
                rendered.append(
                    dict(geometry(overlap, tolerance), id=f"{first_id}|{second_id}")
                )
    else:
        raise ValueError("Choose section, interference or properties analysis.")
    return {
        "status": "ok",
        "kind": kind,
        "bodies": rendered,
        "measurements": measurements,
    }
