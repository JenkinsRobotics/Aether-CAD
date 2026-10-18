"""Transient exact changes; never feature history or stored document geometry."""


def snapshot(bodies):
    return {key: body.Shape.copy() for key, body in bodies.items()
            if hasattr(body, "Shape") and not body.Shape.isNull() and body.Shape.Solids and body.Shape.isValid()}


def difference(before, after, geometry, tolerance, merge_scope=(), merge_groups=()):
    result = {"base": [], "added": [], "removed": []}
    if merge_scope or merge_groups:
        # Consuming a part identity does not remove its material. Compare the
        # combined selected input against the surviving primary output.
        before = dict(before)
        groups = merge_groups or [{'bodyId': merge_scope[0], 'sources': merge_scope}]
        for group in groups:
            shapes = [before.pop(key) for key in group['sources']]
            before[group['bodyId']] = (shapes[0] if len(shapes) == 1 else
                                      shapes[0].multiFuse(shapes[1:]).removeSplitter())

    def append(kind, key, shape):
        if shape.isNull() or not shape.Solids or shape.Volume <= 1e-9:
            return
        if not shape.isValid():
            raise ValueError("The feature preview difference is invalid.")
        mesh = geometry(shape, tolerance)
        mesh["id"] = f"preview:{kind}:{key}"
        result[kind].append(mesh)

    for key in sorted(before.keys() | after.keys()):
        old, new = before.get(key), after.get(key)
        if old is None:
            append("added", key, new)
        elif new is None:
            append("removed", key, old)
        else:
            append("base", key, old.common(new))
            append("added", key, new.cut(old))
            append("removed", key, old.cut(new))
    return result
