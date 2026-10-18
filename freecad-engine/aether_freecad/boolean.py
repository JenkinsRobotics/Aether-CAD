"""Multi-body booleans via native PartDesign::Boolean.

Property contract: FreeCAD src/Mod/PartDesign/App/FeatureBoolean.cpp.
The caller removes consumed tools from published outputs only after validation.
"""


def boolean(document, body, parameters, bodies):
    operation = parameters.get("boolean_operation")
    types = {"union": "Fuse", "cut": "Cut", "intersection": "Common"}
    if operation not in types:
        raise ValueError("Choose Union, Cut or Intersection.")
    ids = parameters.get("tool_body_ids")
    if not isinstance(ids, list) or not ids or any(not isinstance(i, str) for i in ids):
        raise ValueError("Boolean needs at least one tool body.")
    if len(ids) != len(set(ids)):
        raise ValueError("Boolean tool bodies must be distinct.")
    tools = [bodies.get(key) for key in ids]
    if any(tool is None or tool is body for tool in tools):
        raise ValueError("Choose available tool bodies different from the target.")
    if body.Tip is None or body.Shape.isNull():
        raise ValueError("Boolean needs an existing target solid.")
    # Resolve tools at this position in Aether's history. Linking their live
    # Body objects would let a later edit of a retained tool retroactively
    # change this earlier Boolean when the native document recomputes.
    snapshots = []
    for tool in tools:
        snapshot = document.addObject("Part::Feature", "BooleanTool")
        snapshot.Shape = tool.Shape.copy()
        snapshots.append(snapshot)
    result = body.newObject("PartDesign::Boolean", "Boolean")
    result.Type = types[operation]
    result.Group = snapshots
    result.Refine = True
    body.Tip = result
    document.recompute()
    return result
