"""Ordered closed sections through FreeCAD's native PartDesign Loft.

Property contract: src/Mod/PartDesign/App/FeatureLoft.cpp. The native feature
owns section matching, smooth/ruled surfaces, and additive/subtractive booleans.
"""

from aether_freecad.modeling import body_sketch


def loft(document, body, parameters, sketches):
    ids = parameters.get("sections")
    if (
        not isinstance(ids, list)
        or len(ids) < 2
        or any(not isinstance(i, str) for i in ids)
    ):
        raise ValueError("Loft requires at least two ordered sketch sections.")
    if len(set(ids)) != len(ids):
        raise ValueError("A loft section cannot be selected twice.")
    operation = parameters.get("operation", "new")
    if operation not in ("new", "add", "cut"):
        raise ValueError("Unsupported loft operation.")
    if operation != "new" and (body.Tip is None or body.Shape.isNull()):
        raise ValueError("Choose an existing target body for the loft.")
    sections = []
    for source_id in ids:
        source = sketches.get(source_id)
        if (
            source is None
            or not source.Shape.Wires
            or any(not w.isClosed() for w in source.Shape.Wires)
        ):
            raise ValueError(
                "Every loft section must be an available closed sketch region."
            )
        sections.append(body_sketch(document, body, source))
    document.recompute()
    result = body.newObject(
        "PartDesign::SubtractiveLoft"
        if operation == "cut"
        else "PartDesign::AdditiveLoft",
        "Loft",
    )
    result.Profile = sections[0]
    result.Sections = sections[1:]
    result.Ruled = bool(parameters.get("ruled", False))
    result.Closed = False
    document.recompute()
    return result
