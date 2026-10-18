"""Derive one exact closed wire from earlier open sketch contours.

The job retains each authored sketch and its native constraints. This object is
only their region projection, rebuilt from its linked inputs for every job.
Uses FreeCAD's public Part.sortEdges/Wire/Face API; no curve is tessellated,
fitted or copied into a second Sketcher geometry/constraint model.
"""

TOLERANCE_MM = 1e-7


def connected_region(document, parameters, sketches):
    import FreeCAD
    import Part

    identifiers = parameters.get("profiles")
    if (
        set(parameters) != {"profiles"}
        or not isinstance(identifiers, list)
        or len(identifiers) < 2
        or len(identifiers) > 1000
        or any(not isinstance(key, str) or not key.strip() for key in identifiers)
        or len(set(identifiers)) != len(identifiers)
    ):
        raise ValueError("A connected region needs distinct source sketch profiles.")
    if any(key not in sketches for key in identifiers):
        raise ValueError("A connected region source sketch is missing.")
    sources = [sketches[key] for key in identifiers]
    frame = sources[0].Placement
    axes = [FreeCAD.Vector(1, 0, 0), FreeCAD.Vector(0, 1, 0), FreeCAD.Vector(0, 0, 1)]
    edges = []
    endpoints = []
    for source in sources:
        placement = source.Placement
        if (placement.Base - frame.Base).Length > TOLERANCE_MM or any(
            (placement.Rotation.multVec(axis) - frame.Rotation.multVec(axis)).Length
            > 1e-10
            for axis in axes
        ):
            raise ValueError("Connected region sources must share one sketch frame.")
        shape = source.Shape
        if not shape.isValid() or len(shape.Wires) != 1:
            raise ValueError("Each connected region source must be one valid open wire.")
        wire = shape.Wires[0]
        if wire.isClosed() or len(wire.OrderedVertexes) < 2:
            raise ValueError("Connected region sources must be open contours.")
        endpoints.extend([wire.OrderedVertexes[0].Point, wire.OrderedVertexes[-1].Point])
        edges.extend(wire.Edges)

    # One partner per endpoint excludes open chains, branches, and tolerance
    # chains that could otherwise close different boundaries depending on order.
    for i, point in enumerate(endpoints):
        matches = [
            j for j, other in enumerate(endpoints)
            if i != j and (point - other).Length <= TOLERANCE_MM
        ]
        if len(matches) != 1:
            raise ValueError("Connected region curves must form one unbranched closed loop.")

    # sortEdges returns *all* components, unlike __sortEdges__, which can stop
    # after the first. Refuse disconnected loops rather than discarding sources.
    groups = Part.sortEdges(edges, TOLERANCE_MM)
    if len(groups) != 1 or len(groups[0]) != len(edges):
        raise ValueError("Connected region sources contain disconnected loops.")
    wire = Part.Wire(groups[0])
    if not wire.isClosed() or not wire.isValid():
        raise ValueError("Connected region curves do not form a valid closed wire.")
    face = Part.Face(wire)
    if not face.isValid() or face.Area <= 1e-9:
        raise ValueError("Connected region boundary crosses, overlaps or has no area.")

    # Shape carries world placement. Store local geometry and the shared frame
    # once, so existing extrusion/revolve/sweep directions work on any plane.
    local = wire.copy()
    local.transformShape(frame.inverse().toMatrix())
    # Rebuild the container from transformed edges: assigning an object's
    # Placement replaces its top-level shape location, so an inverse location
    # left on the root wire would otherwise be lost (double-transforming it).
    local = Part.Wire(local.Edges)
    # A 2D profile can enter a PartDesign body without becoming its solid Tip.
    # A generic PartDesign::Feature would be mistaken for a preceding solid by
    # AdditivePipe. Body accepts Part2DObject profiles (FreeCAD Body.cpp); the
    # shape remains an exact wire projection, with no second Sketcher model.
    region = document.addObject("Part::Part2DObjectPython", "SketchRegion")
    region.addProperty("App::PropertyLinkList", "SourceProfiles")
    region.SourceProfiles = sources
    region.Shape = local
    region.Placement = frame
    return region
