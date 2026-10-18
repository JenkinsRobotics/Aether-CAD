"""Map Aether's fixed geometry to FreeCAD Sketcher Block constraints.

Public API reference: FreeCAD documentation Sketcher_ConstrainBlock.
The input indices name native geometry, never Sketcher endpoint parameters.
"""


def apply_fixed_geometry(sketch, parameters, constraint):
    indices = parameters.get("blocked_geometry", [])
    if not isinstance(indices, list) or any(
        type(index) is not int or index < 0 or index >= sketch.GeometryCount
        for index in indices
    ):
        raise ValueError("blocked_geometry must name existing sketch geometry indices")
    if len(set(indices)) != len(indices):
        raise ValueError("blocked_geometry contains duplicate indices")
    for index in indices:
        sketch.addConstraint(constraint("Block", index))
    if indices and sketch.solve() != 0:
        raise ValueError("Fixed sketch geometry could not be solved")
