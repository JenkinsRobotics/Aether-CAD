"""All selected targets are validated before any PartDesign tip is replaced."""
from aether_freecad.regions import _profile_tool
from aether_freecad.extrusion_extent import resolve_extent_references


def extrude_scope(document, feature, bodies, sketches, built):
    parameters = feature.parameters
    ids = parameters.get("target_body_ids")
    operation = parameters.get("operation")
    if (operation not in ("add", "cut", "intersect") or not isinstance(ids, list)
            or not ids or len(ids) > 256 or any(not isinstance(i, str) or not i.strip() for i in ids)
            or len(set(ids)) != len(ids) or parameters.get("body_id") != ids[0]):
        raise ValueError("Choose distinct target parts for Add, Remove or Intersect.")
    if any(i not in bodies for i in ids):
        raise ValueError("A selected target part is unavailable. Repair the extrusion scope.")
    parameters = resolve_extent_references(parameters, bodies, built)
    if operation == "add":
        _merge_scope(document, feature, parameters, ids, bodies, sketches, built)
        return
    parameters["_scope_allow_no_hit"] = True
    pending = []
    removed = 0
    for index, key in enumerate(ids):
        target = bodies[key].Shape
        tools = [_profile_tool({**parameters, **group}, sketches, target)[0]
                 for group in (parameters.get("profile_groups") or [parameters])]
        tools = [tool for tool in tools if not tool.isNull()]
        if tools:
            tool = tools[0] if len(tools) == 1 else tools[0].multiFuse(tools[1:]).removeSplitter()
            shape = (target.cut(tool) if operation == "cut" else target.common(tool)).removeSplitter()
        else:
            shape = target.copy()
        if shape.isNull() or not shape.isValid() or not shape.Solids or shape.Volume <= 1e-9:
            raise ValueError(f"Extrusion leaves no valid solid in selected part {index + 1}. Narrow the scope or adjust the depth.")
        removed += max(0, target.Volume - shape.Volume)
        pending.append((key, shape))
    if operation == "cut" and removed < 1e-8:
        raise ValueError("Cut removes no material from the selected parts. Check scope and direction.")
    for key, shape in pending:
        result = document.addObject("PartDesign::Feature", "ScopedExtrusion")
        bodies[key].addObject(result)
        result.Shape = shape
        bodies[key].Tip = result
        built[(feature.id, key)] = shape.copy()
    document.recompute()
    # Repeating a multi-body feature through single-body Pattern/Mirror is not
    # supported; do not point its generic source at an arbitrary target.
    built.pop(feature.id, None)


def _merge_scope(document, feature, parameters, ids, bodies, sketches, built):
    import Part

    targets = [bodies[key].Shape.copy() for key in ids]
    target = Part.makeCompound(targets)
    tools = [_profile_tool({**parameters, **group}, sketches, target)[0]
             for group in (parameters.get("profile_groups") or [parameters])]
    shape = targets[0].multiFuse(targets[1:] + tools).removeSplitter()
    if (shape.isNull() or not shape.isValid() or len(shape.Solids) != 1
            or shape.Volume <= 1e-9):
        raise ValueError("Add must join all selected parts into one solid. Adjust the depth or merge scope.")
    # No output or body tip changes until the complete merge is valid. Keep
    # historical snapshots intact; only current outputs consume the extra IDs.
    primary = ids[0]
    result = document.addObject("PartDesign::Feature", "ScopedMerge")
    bodies[primary].addObject(result)
    result.Shape = shape
    bodies[primary].Tip = result
    document.recompute()
    built[(feature.id, primary)] = shape.copy()
    built.pop(feature.id, None)
    for key in ids[1:]:
        del bodies[key]
