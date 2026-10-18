"""Planar region extrusion using exact closed wires and containment.

A region is its contour minus enclosed contours. Selecting both a region and
its enclosed region fills that hole. Crossing contours must first be trimmed.
"""


def _profile_tool(parameters, sketches, target):
    import Part

    selected = parameters.get("profiles") or []
    candidates = parameters.get("profile_regions") or []
    if not selected or any(key not in candidates for key in selected):
        raise ValueError("Choose at least one profile from the source sketch.")
    if "thin" in parameters:
        from aether_freecad.extrusion_thin import thin_profile_face

        if any(key not in sketches for key in selected):
            raise ValueError("A selected sketch curve is missing.")
        regions = [thin_profile_face(sketches[key], parameters["thin"]) for key in selected]
    else:
        faces = {}
        for key in candidates:
            sketch = sketches.get(key)
            if sketch is None:
                raise ValueError("A sketch region is missing.")
            wires = sketch.Shape.Wires
            if len(wires) != 1 or not wires[0].isClosed():
                raise ValueError("Each region must have one closed contour.")
            face = Part.Face(wires[0])
            if not face.isValid() or face.Area <= 1e-9:
                raise ValueError("Invalid planar region.")
            faces[key] = face
        regions = []
        for key in selected:
            outer = faces[key]
            region = outer
            for other_key, inner in faces.items():
                if other_key == key:
                    continue
                common = outer.common(inner).Area
                epsilon = max(1e-8, min(outer.Area, inner.Area) * 1e-8)
                if common <= epsilon:
                    continue
                if (
                    abs(common - inner.Area) <= epsilon
                    and inner.Area < outer.Area - epsilon
                ):
                    region = region.cut(inner)
                elif (
                    abs(common - outer.Area) <= epsilon
                    and outer.Area < inner.Area - epsilon
                ):
                    continue
                else:
                    raise ValueError(
                        "Overlapping or duplicate contours need trimming before region extrusion."
                    )
            regions.append(region)
    planar = regions[0]
    for region in regions[1:]:
        planar = planar.fuse(region)
    distance = float(parameters.get("distance_mm", parameters.get("depth_mm", 0)))
    if distance <= 0:
        raise ValueError("Extrusion depth must be positive.")
    normal = sketches[selected[0]].Placement.Rotation.multVec(
        __import__("FreeCAD").Vector(0, 0, 1)
    )
    from aether_freecad.extrusion_direction import extrusion_direction
    from aether_freecad.extrusion_extent import extrusion_tool

    direction = extrusion_direction(parameters, normal)
    tool = extrusion_tool(planar, direction, target, parameters, sketches[selected[0]].Document)
    # Adjacent planar faces can extrude into a compound with a shared internal
    # wall. Fuse in 3D before deciding which solids are disconnected.
    if len(tool.Solids) > 1:
        tool = tool.Solids[0].multiFuse(tool.Solids[1:]).removeSplitter()
    return tool, regions, direction, selected


def extrude_regions(document, body, parameters, sketches):
    from aether_freecad.extrusion_extent import extrusion_tool

    target = body.Tip.Shape if body.Tip is not None else None
    groups = parameters.get("profile_groups") or [parameters]
    tools = []
    contributors = []
    for group in groups:
        group_parameters = {**parameters, **group}
        tool, regions, direction, selected = _profile_tool(group_parameters, sketches, target)
        tools.append(tool)
        if parameters.get("separate_bodies") and parameters.get("operation") == "new":
            keys = group_parameters.get("profile_keys") or {}
            contributors.extend((keys.get(key, key), extrusion_tool(region, direction, target, group_parameters, document)) for key, region in zip(selected, regions))
    tool = tools[0] if len(tools) == 1 else tools[0].multiFuse(tools[1:]).removeSplitter()
    operation = parameters.get("operation")
    if operation not in ("new", "add", "cut", "intersect"):
        raise ValueError("Unsupported extrusion operation.")
    if operation in ("add", "cut", "intersect"):
        if body.Tip is None:
            raise ValueError("Select a target solid.")
        target_shape = body.Tip.Shape
        if operation == "intersect":
            shape = target_shape.common(tool)
            if shape.isNull() or not shape.Solids or shape.Volume <= 1e-9:
                raise ValueError("The extrusion does not overlap the selected target body.")
        elif operation == "cut":
            shape = target_shape.cut(tool)
        else:
            shape = target_shape.fuse(tool)
    else:
        shape = tool
    feature = document.addObject("PartDesign::Feature", "ExtrudeRegions")
    body.addObject(feature)
    feature.Shape = shape.removeSplitter()
    body.Tip = feature
    if parameters.get("separate_bodies") and operation == "new":
        import hashlib
        import json

        solid_keys = []
        for solid in feature.Shape.Solids:
            identities = sorted({key for key, region_tool in contributors
                                 if solid.common(region_tool).Volume > 1e-8})
            if not identities:
                raise ValueError("Could not identify an extrusion output body.")
            identity = hashlib.sha256(json.dumps(identities, separators=(",", ":")).encode()).hexdigest()[:24]
            solid_keys.append(identity)
        if len(set(solid_keys)) != len(solid_keys):
            raise ValueError("A region splits into ambiguous output bodies. Split the sketch into distinct contours first.")
        feature.addProperty("App::PropertyStringList", "AetherSolidKeys")
        feature.AetherSolidKeys = solid_keys
    return feature
