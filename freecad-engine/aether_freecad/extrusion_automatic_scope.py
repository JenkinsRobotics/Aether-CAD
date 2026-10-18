"""Evaluate automatic extrusion scope from native solids at this history step."""
from aether_freecad.extrusion_extent import resolve_extent_references
from aether_freecad.regions import _profile_tool


def extrude_all(document, feature, bodies, sketches, built):
    import Part

    parameters = feature.parameters
    operation = parameters.get('operation')
    if (parameters.get('scope_mode') != 'all' or operation not in ('add', 'cut', 'intersect')
            or 'target_body_ids' in parameters or parameters.get('body_id')):
        raise ValueError('Automatic extrusion scope cannot also specify target parts.')
    solids = {key: body.Shape.copy() for key, body in bodies.items()
              if hasattr(body, 'Shape') and not body.Shape.isNull() and body.Shape.Solids}
    if not solids:
        raise ValueError('Automatic scope needs an earlier solid part.')
    parameters = resolve_extent_references(parameters, bodies, built)
    parameters['_scope_allow_no_hit'] = True
    target = Part.makeCompound(list(solids.values()))
    tools = [_profile_tool({**parameters, **group}, sketches, target)[0]
             for group in parameters.get('profile_groups') or [parameters]]
    tools = [tool for tool in tools if not tool.isNull() and tool.Solids]
    if not tools:
        raise ValueError('The extrusion does not reach any solid part.')
    tool = tools[0] if len(tools) == 1 else tools[0].multiFuse(tools[1:]).removeSplitter()
    if tool.isNull() or not tool.isValid() or not tool.Solids:
        raise ValueError('The extrusion tool is not a valid solid.')
    if operation == 'add':
        targets, pending = _add_groups(solids, tool)
    else:
        targets, pending = [], []
        for key, shape in solids.items():
            common = shape.common(tool)
            if common.Volume <= 1e-9:
                continue
            targets.append(key)
            result = (shape.cut(tool) if operation == 'cut' else common).removeSplitter()
            if result.isNull() or not result.Solids or result.Volume <= 1e-9:
                if operation == 'cut':
                    continue  # Complete removal consumes the body identity.
                raise ValueError('Intersect did not produce a valid solid.')
            if not result.isValid():
                raise ValueError('Automatic extrusion produced an invalid solid.')
            pending.append(([key], result))
        if not targets:
            raise ValueError('The extrusion does not overlap any solid part. Adjust its depth or direction.')
    # Validate every result before updating any current output. Historical
    # feature/body snapshots remain available even after a body is consumed.
    survivors = set()
    groups = []
    for sources, shape in pending:
        primary = sources[0]
        result = document.addObject('PartDesign::Feature', 'AutomaticExtrusion')
        bodies[primary].addObject(result)
        result.Shape = shape
        bodies[primary].Tip = result
        built[(feature.id, primary)] = shape.copy()
        survivors.add(primary)
        groups.append({'bodyId': primary, 'sources': sources})
    for key in targets:
        if key not in survivors:
            del bodies[key]
    built.pop(feature.id, None)
    document.recompute()
    return {'targets': targets, 'groups': groups}


def _add_groups(solids, tool):
    import Part

    # Distance is only a candidate filter. The subsequent exact union must
    # actually connect material; no tolerance-based translation or gap filling.
    targets = [key for key, shape in solids.items() if shape.distToShape(tool)[0] <= 1e-7]
    if not targets:
        raise ValueError('Add does not touch any solid part. Extend the extrusion or choose New.')
    joined = solids[targets[0]].multiFuse([solids[key] for key in targets[1:]] + [tool]).removeSplitter()
    if joined.isNull() or not joined.isValid() or not joined.Solids:
        raise ValueError('Add could not form valid solids with the touching parts.')
    components = []
    for solid in joined.Solids:
        sources = {key for key in targets if solid.common(solids[key]).Volume > 1e-9}
        if not sources:
            raise ValueError('Each added region must join a solid part. Edge-only contact or a detached region cannot form a solid merge; choose New or adjust the sketch.')
        components.append((sources, [solid]))
    # An existing compound part may contain several solids. Preserve its one
    # identity; do not invent new IDs just because it spans several components.
    groups = []
    for sources, shapes in components:
        matching = [index for index, (members, _) in enumerate(groups) if members & sources]
        for index in reversed(matching):
            members, previous = groups.pop(index)
            sources |= members
            shapes += previous
        groups.append((sources, shapes))
    pending = []
    for sources, shapes in groups:
        ordered = [key for key in targets if key in sources]
        shape = shapes[0] if len(shapes) == 1 else Part.makeCompound(shapes)
        if not shape.isValid():
            raise ValueError('Automatic merge produced an invalid result.')
        pending.append((ordered, shape))
    pending.sort(key=lambda item: targets.index(item[0][0]))
    return targets, pending
