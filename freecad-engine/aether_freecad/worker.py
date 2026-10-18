"""Runs INSIDE FreeCAD. The only file in Aether that imports FreeCAD.

Reads one JSON job per line on stdin, writes one JSON result per line on
stdout, and keeps nothing between jobs — each build gets a fresh document that
is closed before the reply is sent. A long-lived worker therefore stays
stateless by contract while avoiding FreeCAD's start-up cost per request
(measured: ~0.25 s to start, ~2 ms to rebuild a pad).

Launched as:  freecadcmd worker.py

Result lines are prefixed so FreeCAD's own console chatter ("Recompute...",
the licence banner) can never be mistaken for protocol output.
"""

from __future__ import annotations

import json
import math
import os
import sys
import time
import traceback
from dataclasses import replace

RESULT_PREFIX = "AETHER_RESULT "

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from aether_freecad.protocol import (  # noqa: E402
    assembly_job_from_json,
    PROTOCOL_VERSION,
    job_from_json,
)
from aether_freecad.modeling import apply_frame, body_sketch, sweep, shell  # noqa: E402
from aether_freecad.fixed_sketch import apply_fixed_geometry  # noqa: E402
from aether_freecad.ellipse_wire import ellipse_wire_segment  # noqa: E402
from aether_freecad.conic_wire import conic_wire_segment  # noqa: E402
from aether_freecad.topology import extract_topology, stable_face_ids  # noqa: E402

import FreeCAD  # noqa: E402
import Part  # noqa: E402
import Sketcher  # noqa: E402


def _engine_name() -> str:
    version = FreeCAD.Version()
    return f"FreeCAD {version[0]}.{version[1]}.{version[2]}"


#: Aether names sketch planes; FreeCAD wants a placement. These are FreeCAD's
#: own datum-plane orientations, as quaternions, so a part built here matches
#: one built in the FreeCAD GUI:
#:   XY  sketch X,Y -> world X,Y   normal +Z
#:   XZ  sketch X,Y -> world X,Z   normal -Y
#:   YZ  sketch X,Y -> world Y,Z   normal +X
#: Quaternions rather than axis/angle because the YZ orientation is a 120°
#: rotation about a diagonal — expressing it as a single axis/angle is what
#: first put the offset and the extrude direction on opposite sides.
PLANES = {
    "XY": ((0.0, 0.0, 0.0, 1.0), (0.0, 0.0, 1.0)),
    "XZ": ((0.7071067811865476, 0.0, 0.0, 0.7071067811865476), (0.0, -1.0, 0.0)),
    "YZ": ((0.5, 0.5, 0.5, 0.5), (1.0, 0.0, 0.0)),
}


def _placement(plane, offset_mm):
    """Placement for a named plane, offset along that plane's own normal.

    The normal here must be the one the rotation actually produces, or an
    offset pushes the sketch one way while the pad grows the other.
    """
    name = plane if isinstance(plane, str) else "XY"
    quaternion, normal = PLANES.get(name, PLANES["XY"])
    rotation = FreeCAD.Rotation(*quaternion)
    position = FreeCAD.Vector(
        *(component * float(offset_mm or 0.0) for component in normal)
    )
    return FreeCAD.Placement(position, rotation)


def _sketch_on_plane(document, body, parameters, name="Sketch"):
    sketch = document.addObject("Sketcher::SketchObject", name)
    if body is not None:
        body.addObject(sketch)
    sketch.Placement = _placement(
        parameters.get("plane", "XY"), parameters.get("offset_mm", 0.0)
    )
    apply_frame(sketch, parameters.get("frame"))
    return sketch


def _polygon_sketch(document, body, parameters):
    """A closed polygon — how Aether expresses a rectangle or any closed path.

    Coincidence constraints are added between consecutive segments so the
    profile is a genuine closed wire to FreeCAD, not four loose lines.
    """
    points = parameters.get("points_mm") or []
    if len(points) < 3:
        raise ValueError("a polygon profile needs at least three points")
    sketch = _sketch_on_plane(document, body, parameters)
    vector = FreeCAD.Vector
    count = len(points)
    for index in range(count):
        start = points[index]
        end = points[(index + 1) % count]
        if abs(start[0] - end[0]) < 1e-9 and abs(start[1] - end[1]) < 1e-9:
            raise ValueError("a polygon profile has a zero-length edge")
        sketch.addGeometry(
            Part.LineSegment(
                vector(float(start[0]), float(start[1]), 0.0),
                vector(float(end[0]), float(end[1]), 0.0),
            ),
            False,
        )
    for index in range(count):
        sketch.addConstraint(
            Sketcher.Constraint("Coincident", index, 2, (index + 1) % count, 1)
        )
    apply_frame(sketch, parameters.get("frame"))
    return sketch


def _circle_sketch(document, body, parameters):
    radius = float(parameters.get("radius_mm", 0.0))
    if radius <= 0:
        raise ValueError("a circle profile needs a positive radius")
    center = parameters.get("center_mm") or (0.0, 0.0)
    sketch = _sketch_on_plane(document, body, parameters)
    sketch.addGeometry(
        Part.Circle(
            FreeCAD.Vector(float(center[0]), float(center[1]), 0.0),
            FreeCAD.Vector(0, 0, 1),
            radius,
        ),
        False,
    )
    apply_fixed_geometry(sketch, parameters, Sketcher.Constraint)
    apply_frame(sketch, parameters.get("frame"))
    return sketch


def _point_sketch(document, body, parameters):
    point = parameters.get("point_mm")
    if not isinstance(point, list) or len(point) != 2 or not all(type(v) in (int, float) and math.isfinite(v) for v in point):
        raise ValueError("A sketch point needs finite millimeter coordinates")
    sketch = _sketch_on_plane(document, body, parameters)
    sketch.addGeometry(Part.Point(FreeCAD.Vector(*point, 0)), True)
    apply_frame(sketch, parameters.get("frame"))
    return sketch


def _wire_sketch(document, body, parameters):
    """A drawn contour: straight runs, arcs through a middle point, and cubic
    beziers, exactly as the sketch stores them.

    Sketcher takes `Part.Arc` directly but refuses a raw Bezier, so a bezier
    goes in as the degree-3 B-spline it already is.
    """
    start = parameters.get("start_mm")
    segments = parameters.get("segments") or []
    if not start or not segments:
        raise ValueError("a wire profile needs a start point and at least one segment")
    sketch = _sketch_on_plane(document, body, parameters)

    def point(value):
        return FreeCAD.Vector(float(value[0]), float(value[1]), 0.0)

    current = list(start)
    indices = []
    for segment in segments:
        kind = segment.get("type")
        end = segment.get("end")
        if end is None:
            raise ValueError(f"a {kind} segment has no end point")
        if kind == "line":
            geometry = Part.LineSegment(point(current), point(end))
        elif kind == "arc":
            middle = segment.get("middle")
            if middle is None:
                raise ValueError("an arc segment has no middle point")
            geometry = Part.Arc(point(current), point(middle), point(end))
        elif kind == "bezier":
            controls = segment.get("controls") or []
            if len(controls) != 2:
                raise ValueError("a bezier segment needs two control points")
            curve = Part.BezierCurve()
            curve.setPoles(
                [point(current), point(controls[0]), point(controls[1]), point(end)]
            )
            geometry = curve.toBSpline()
        elif kind == "ellipse":
            geometry = ellipse_wire_segment(current, end, segment.get("ellipse_frame"), Part, FreeCAD.Vector)
        elif kind == "conic":
            geometry = conic_wire_segment(
                current, end, segment.get("control"), segment.get("rho"), Part, FreeCAD.Vector
            )
        else:
            raise ValueError(f"unsupported wire segment {kind!r}")
        indices.append(sketch.addGeometry(geometry, False))
        current = end
    # Geometry already carries solved endpoint coordinates. Do not add endpoint
    # index constraints: native arcs can reverse parameter order, so indices
    # 1/2 need not match the author's start/end and can deform a valid contour.
    apply_fixed_geometry(sketch, parameters, Sketcher.Constraint)
    apply_frame(sketch, parameters.get("frame"))
    return sketch


def _rectangle_sketch(document, body, parameters):
    """A closed, constrained rectangle.

    Built from explicit constraints rather than a fixed polygon so the
    Sketcher solver is genuinely exercised — this is the engine's own solver
    doing the work, which is the reason for using it.
    """
    width = float(parameters.get("width_mm", 10.0))
    height = float(parameters.get("height_mm", 10.0))
    if width <= 0 or height <= 0:
        raise ValueError("a sketch rectangle needs positive width and height")
    sketch = _sketch_on_plane(document, body, parameters)
    vector = FreeCAD.Vector
    corners = [
        (0.0, 0.0),
        (width, 0.0),
        (width, height),
        (0.0, height),
    ]
    for index in range(4):
        start = corners[index]
        end = corners[(index + 1) % 4]
        sketch.addGeometry(Part.LineSegment(vector(*start, 0), vector(*end, 0)), False)
    for index in range(4):
        sketch.addConstraint(
            Sketcher.Constraint("Coincident", index, 2, (index + 1) % 4, 1)
        )
    sketch.addConstraint(Sketcher.Constraint("Horizontal", 0))
    sketch.addConstraint(Sketcher.Constraint("Vertical", 1))
    sketch.addConstraint(Sketcher.Constraint("DistanceX", 0, 1, 0, 2, width))
    sketch.addConstraint(Sketcher.Constraint("DistanceY", 1, 1, 1, 2, height))
    apply_frame(sketch, parameters.get("frame"))
    return sketch


def _require_closed_profile(document, sketch, operation):
    """Refuse an open profile, loudly.

    FreeCAD pads an open wire to nothing and reports success, so the part just
    quietly loses a feature. A drawn contour is the only profile that can be
    open, which is exactly the one a user is most likely to try.
    """
    document.recompute()
    wires = getattr(getattr(sketch, "Shape", None), "Wires", None) or []
    if wires and not any(wire.isClosed() for wire in wires):
        raise ValueError(
            f"{operation} needs a closed profile; this sketch region is an open path"
        )


def _pad(document, body, parameters, sketches):
    profile_id = parameters.get("profile")
    sketch = sketches.get(profile_id) if profile_id else None
    if sketch is None:
        if not sketches:
            raise ValueError("pad needs a sketch to extrude")
        sketch = list(sketches.values())[-1]
    distance = float(parameters.get("distance_mm", 1.0))
    if distance <= 0:
        raise ValueError("pad distance must be positive")
    _require_closed_profile(document, sketch, "pad")
    pad = document.addObject("PartDesign::Pad", "Pad")
    body.addObject(pad)
    pad.Profile = sketch
    pad.Length = distance
    if parameters.get("midplane"):
        pad.Midplane = True
    if parameters.get("reversed"):
        pad.Reversed = True
    return pad


def _origin_axis(body, name):
    """The body's own X/Y/Z datum line, which is what a revolve turns about."""
    role = f"{name}_Axis"
    for feature in body.Origin.OriginFeatures:
        if feature.Role == role:
            return feature
    raise ValueError(f"the body has no {role}")


def _revolve(document, body, parameters, sketches):
    profile_id = parameters.get("profile")
    sketch = sketches.get(profile_id) if profile_id else None
    if sketch is None:
        raise ValueError("revolve needs a named sketch profile")
    angle = float(parameters.get("angle_deg", 360.0))
    if not 0.0 < angle <= 360.0:
        raise ValueError("revolve angle must be above 0 and at most 360 degrees")
    _require_closed_profile(document, sketch, "revolve")
    axis = str(parameters.get("axis", "Z")).upper()
    if axis not in {"X", "Y", "Z"}:
        raise ValueError(f"unknown revolve axis {axis!r}")
    # Cutting a revolve is FreeCAD's Groove: the same sweep, taking material
    # away instead of adding it.
    cut = bool(parameters.get("cut"))
    revolve = document.addObject(
        "PartDesign::Groove" if cut else "PartDesign::Revolution",
        "Groove" if cut else "Revolution",
    )
    body.addObject(revolve)
    revolve.Profile = sketch
    revolve.ReferenceAxis = (_origin_axis(body, axis), [""])
    from aether_freecad.revolve_extent import configure_revolve_extent

    configure_revolve_extent(revolve, parameters)
    return revolve


#: Which coordinate a named plane holds constant, so an edge can be tested
#: against it. Matches the plane names the document uses everywhere else.
PLANE_PINNED_AXIS = {"XY": 2, "XZ": 1, "YZ": 0}


def _edges_in_plane(shape, plane, offset_mm):
    """Edge names to finish: all of them, or only those lying in one plane.

    The document selects edges the same way the TypeScript engine does — by
    the plane they lie in — because a saved part must not depend on which
    edge FreeCAD happened to number first.
    """
    names = [f"Edge{index + 1}" for index in range(len(shape.Edges))]
    if not plane:
        return names
    pinned = PLANE_PINNED_AXIS.get(str(plane).upper())
    if pinned is None:
        raise ValueError(f"unknown edge plane {plane!r}")
    offset = float(offset_mm or 0.0)
    selected = []
    for name, edge in zip(names, shape.Edges):
        points = [vertex.Point for vertex in edge.Vertexes]
        if points and all(
            abs((point.x, point.y, point.z)[pinned] - offset) < 1e-6 for point in points
        ):
            selected.append(name)
    return selected


def _edge_finish(document, body, parameters, kind):
    """Fillet or chamfer — one builder, because only the property name differs."""
    tip = body.Tip
    if tip is None:
        raise ValueError(f"{kind} needs a solid to work on")
    size = float(parameters.get("radius_mm", 0.0))
    if size <= 0:
        raise ValueError(f"{kind} size must be positive")
    edges = _edges_in_plane(
        tip.Shape, parameters.get("plane"), parameters.get("offset_mm", 0.0)
    )
    if not edges:
        raise ValueError(f"{kind} matched no edges on this solid")
    finish = document.addObject(
        "PartDesign::Fillet" if kind == "fillet" else "PartDesign::Chamfer",
        kind.capitalize(),
    )
    body.addObject(finish)
    finish.Base = (tip, edges)
    if kind == "fillet":
        finish.Radius = size
    else:
        finish.Size = size
    return finish


def _origin_plane(body, name):
    role = f"{str(name).upper()}_Plane"
    for feature in body.Origin.OriginFeatures:
        if feature.Role == role:
            return feature
    raise ValueError(f"the body has no {role}")


def _mirror(document, body, parameters, built):
    """Repeat an earlier feature on the other side of a plane.

    FreeCAD's Mirrored repeats the source *feature*, so it inherits whether
    that feature added or removed material.
    """
    source = built.get(parameters.get("source"))
    if source is None:
        raise ValueError("mirror needs an earlier solid feature to repeat")
    plane = _origin_plane(body, parameters.get("plane", "XY"))
    offset = float(parameters.get("offset_mm", 0.0) or 0.0)
    if abs(offset) > 1e-9:
        # An offset mirror plane has to exist as a datum; the origin planes
        # themselves sit at zero.
        datum = document.addObject("PartDesign::Plane", "MirrorPlane")
        body.addObject(datum)
        datum.AttachmentSupport = [(plane, "")]
        datum.MapMode = "FlatFace"
        datum.AttachmentOffset = FreeCAD.Placement(
            FreeCAD.Vector(0.0, 0.0, offset), FreeCAD.Rotation()
        )
        plane = datum
    mirrored = document.addObject("PartDesign::Mirrored", "Mirrored")
    body.addObject(mirrored)
    mirrored.Originals = [source]
    mirrored.MirrorPlane = (plane, [""])
    # addObject does not advance the tip for a transform feature, and an
    # unadvanced tip means the mirror computes and is then never shown.
    document.recompute()
    body.Tip = mirrored
    return mirrored


def _pocket(document, body, parameters, sketches):
    profile_id = parameters.get("profile")
    sketch = sketches.get(profile_id) if profile_id else None
    if sketch is None:
        raise ValueError("pocket needs a named sketch profile")
    depth = float(parameters.get("depth_mm", 1.0))
    if depth <= 0:
        raise ValueError("pocket depth must be positive")
    _require_closed_profile(document, sketch, "pocket")
    pocket = document.addObject("PartDesign::Pocket", "Pocket")
    body.addObject(pocket)
    pocket.Profile = sketch
    pocket.Length = depth
    pocket.Reversed = bool(parameters.get("reversed", False))
    if parameters.get("through_all"):
        pocket.Type = 1
    return pocket


def _geometry(shape, tolerance):
    """Tessellate per face, so Aether gets the payload its renderer already
    draws: interleaved vertices, per-vertex normals, triangle indices, edge
    line segments, and a face range per face for picking.

    Per-face rather than whole-shape tessellation is the point — a single
    `shape.tessellate()` loses which triangle belongs to which face, and face
    identity is what selection, mates and dimensions are built on.
    """
    vertices: list[float] = []
    normals: list[float] = []
    triangles: list[int] = []
    face_ranges: list[dict[str, int]] = []
    topology: list[dict[str, object]] = []

    # One id source for both labellings, so a triangle's faceId is the same
    # number the topology entry is filed under.
    face_ids = stable_face_ids(shape)

    for index, face in enumerate(shape.Faces):
        face_id = face_ids[index]
        start = len(triangles) // 3
        base = len(vertices) // 3
        # Face.tessellate supplies implicit angular settings that oversample
        # swept spline surfaces. Set both controls through FreeCAD's public
        # mesher; linear deflection remains absolute mm, never a model ratio.
        import MeshPart
        mesh = MeshPart.meshFromShape(
            Shape=face, LinearDeflection=tolerance,
            AngularDeflection=0.25, Relative=False,
        )
        points, facets = mesh.Topology
        surface = face.Surface
        for point in points:
            vertices.extend((point.x, point.y, point.z))
            try:
                u, v = surface.parameter(point)
                # normalAt already applies the face's topological orientation,
                # matching tessellate's winding, including cavity walls.
                normal = face.normalAt(u, v)
                normals.extend((normal.x, normal.y, normal.z))
            except Exception:
                # A degenerate parameterisation must not lose the triangle;
                # the renderer can live with a zero normal on one vertex.
                normals.extend((0.0, 0.0, 0.0))
        for facet in facets:
            triangles.extend((base + facet[0], base + facet[1], base + facet[2]))
        face_ranges.append(
            {
                "start": start,
                "count": len(triangles) // 3 - start,
                "faceId": face_id,
            }
        )
    topology = extract_topology(shape, face_ids)

    # Edge display lines. FreeCAD gives a polyline per edge; the renderer wants
    # flat segment pairs.
    edge_lines: list[float] = []
    for edge in shape.Edges:
        try:
            points = edge.discretize(Deflection=tolerance)
        except Exception:
            continue
        for first, second in zip(points, points[1:]):
            edge_lines.extend((first.x, first.y, first.z))
            edge_lines.extend((second.x, second.y, second.z))

    return {
        "volume_mm3": shape.Volume,
        "face_count": len(shape.Faces),
        "edge_count": len(shape.Edges),
        "vertices": vertices,
        "normals": normals,
        "triangles": triangles,
        "edge_lines": edge_lines,
        "face_ranges": face_ranges,
        "topology": topology,
        "face_names": [f"Face{i + 1}" for i in range(len(shape.Faces))],
    }


def _apply_feature(document, feature, bodies_by_id, sketches, built):
    """Build one feature into the document, or raise saying why not.

    Extracted so an assembly can build its part definitions through exactly
    the same path a Part document does — a part must behave identically
    whether it is opened on its own or placed in an assembly. The caller
    owns the loop, the diagnostics and when to stop.
    """
    parameters = feature.parameters
    if feature.kind.startswith("sketch-"):
        if feature.kind == "sketch-region":
            from aether_freecad.connected_region import connected_region

            sketches[feature.id] = connected_region(document, parameters, sketches)
            document.recompute()
            return
        if parameters.get("support"):
            from aether_freecad.sketch_support import resolve_support

            parameters = dict(parameters)
            parameters["frame"] = resolve_support(parameters["support"], built)
        if feature.kind == "sketch-wire":
            sketch = _wire_sketch(document, None, parameters)
        else:
            builder = {
                "sketch-rectangle": _rectangle_sketch,
                "sketch-polygon": _polygon_sketch,
                "sketch-circle": _circle_sketch,
                "sketch-point": _point_sketch,
            }.get(feature.kind)
            if builder is None:
                raise ValueError(
                    f"unsupported feature kind {feature.kind!r}"
                )
            sketch = builder(document, None, parameters)
        if parameters.get("support"):
            sketch.addProperty("App::PropertyString", "AetherSourceProfileId")
            sketch.AetherSourceProfileId = parameters["source_profile_id"]
            sketch.addProperty("App::PropertyString", "AetherResolvedFrame")
            sketch.AetherResolvedFrame = json.dumps(parameters["frame"])
        sketches[feature.id] = sketch
        document.recompute()
        if "pierce_checks" in parameters:
            from aether_freecad.pierce_validation import validate_pierce_contacts

            validate_pierce_contacts(sketch, parameters, sketches)
        return
    from aether_freecad.cad_import import create_import, reject_mesh_targets
    reject_mesh_targets(parameters, bodies_by_id, built)
    if feature.kind in ("pad", "pocket"):
        from aether_freecad.extrusion_draft import validate_draft

        from aether_freecad.extrusion_ends import validate_ends
        validate_ends(parameters)
        if (validate_draft(parameters) or parameters.get("second_end") is not None or parameters.get("direction_vector") is not None or "thin" in parameters or "direction_reference" in parameters or "starting_reference" in parameters or parameters.get("end_type") == "symmetric-through-all") and not parameters.get("region_mode"):
            raise ValueError("Independent ends and draft require a region-aware extrusion.")
    if feature.kind == "transform":
        from aether_freecad.part_transform import transform_parts
        transform_parts(document, feature, bodies_by_id, built)
        return
    if feature.kind == "offset-face":
        from aether_freecad.offset_face import offset_faces
        offset_faces(document, feature, bodies_by_id, built)
        return
    imported = None
    if feature.kind == "import-cad":
        imported = create_import(document, parameters)
        if hasattr(imported, "Mesh"):
            body_id = parameters.get("body_id") or "default"
            if body_id in bodies_by_id:
                raise ValueError("Import needs a new body identity.")
            bodies_by_id[body_id] = imported
            built[feature.id] = imported
            return
    if parameters.get("operation") == "intersect" and (feature.kind != "pad" or not parameters.get("region_mode")):
        raise ValueError("Intersect extrusion requires a region-aware pad and a target body.")
    if "scope_mode" in parameters:
        if feature.kind not in ("pad", "pocket") or not parameters.get("region_mode"):
            raise ValueError("Automatic scope requires a region-aware extrusion.")
        from aether_freecad.extrusion_automatic_scope import extrude_all
        return extrude_all(document, feature, bodies_by_id, sketches, built)
    if "target_body_ids" in parameters:
        if feature.kind not in ("pad", "pocket") or not parameters.get("region_mode"):
            raise ValueError("Part scope requires a region-aware extrusion.")
        from aether_freecad.extrusion_scope import extrude_scope
        extrude_scope(document, feature, bodies_by_id, sketches, built)
        return
    body_id = parameters.get("body_id") or "default"
    if body_id not in bodies_by_id:
        if parameters.get("operation") in ("add", "cut", "intersect") or feature.kind == "boolean":
            raise ValueError("The selected target body is unavailable.")
        bodies_by_id[body_id] = document.addObject(
            "PartDesign::Body", "Body"
        )
    body = bodies_by_id[body_id]
    if hasattr(body, "Mesh"):
        raise ValueError("This operation requires a solid body. Convert the imported mesh first.")
    previous_volume = body.Shape.Volume if not body.Shape.isNull() else 0
    local_sketches = dict(sketches)
    for key in ("profile", "path"):
        source_id = parameters.get(key)
        if source_id in sketches:
            local_sketches[source_id] = body_sketch(
                document, body, sketches[source_id]
            )
    document.recompute()
    if feature.kind in ("pad", "pocket") and parameters.get("region_mode"):
        from aether_freecad.regions import extrude_regions

        from aether_freecad.extrusion_extent import resolve_extent_references
        parameters = resolve_extent_references(parameters, bodies_by_id, built)
        result = extrude_regions(document, body, parameters, sketches)
    elif feature.kind == "import-cad":
        result = imported
        body.addObject(result)
        body.Tip = result
    elif feature.kind == "import-step":
        from aether_freecad.importing import import_step

        result = import_step(document, body, parameters)
    elif feature.kind == "pad":
        result = _pad(document, body, parameters, local_sketches)
    elif feature.kind == "pocket":
        result = _pocket(document, body, parameters, local_sketches)
    elif feature.kind == "revolve":
        result = _revolve(document, body, parameters, local_sketches)
    elif feature.kind == "mirror":
        result = _mirror(document, body, parameters, built)
    elif feature.kind in ("fillet", "chamfer"):
        result = _edge_finish(document, body, parameters, feature.kind)
    elif feature.kind == "sweep":
        result = sweep(document, body, parameters, local_sketches)
    elif feature.kind == "boolean":
        from aether_freecad.boolean import boolean

        result = boolean(document, body, parameters, bodies_by_id)
    elif feature.kind == "pattern":
        from aether_freecad.pattern import pattern

        result = pattern(document, body, parameters, built)
    elif feature.kind == "draft":
        from aether_freecad.draft import draft

        result = draft(document, body, parameters)
    elif feature.kind == "loft":
        from aether_freecad.loft import loft

        result = loft(document, body, parameters, sketches)
    elif feature.kind == "hole":
        from aether_freecad.hole import hole

        result = hole(document, body, parameters, local_sketches)
    elif feature.kind == "face-extrude":
        from aether_freecad.face_extrude import face_extrude

        result = face_extrude(document, body, parameters, built)
    elif feature.kind == "shell":
        result = shell(document, body, parameters)
    else:
        raise ValueError(f"unsupported feature kind {feature.kind!r}")
    document.recompute()
    shape = result.Shape
    if (
        "Invalid" in result.State
        or shape.isNull()
        or not shape.isValid()
        or not shape.Solids
        or shape.Volume <= 1e-9
    ):
        raise ValueError(
            f"{feature.kind} did not produce a valid solid. Check the profile, target and dimensions."
        )
    if (
        parameters.get("operation") == "add"
        and feature.kind != "mirror"
        and len(shape.Solids) != 1
    ):
        raise ValueError(
            "Add must join the target body. Use New for a separate solid."
        )
    if (
        parameters.get("operation") == "cut" or feature.kind in ("pocket",)
    ) and abs(shape.Volume - previous_volume) < 1e-8:
        raise ValueError(
            "Cut removes no material. Flip direction or check the selected target and depth."
        )
    if feature.kind == "boolean" and not parameters.get("keep_tools", False):
        for tool_id in parameters["tool_body_ids"]:
            del bodies_by_id[tool_id]
    if "AetherSolidKeys" in result.PropertiesList:
        # Keep the producer in the document for feature references, but expose
        # each disconnected solid as its own independently editable body.
        del bodies_by_id[body_id]
        for solid, key in zip(shape.Solids, result.AetherSolidKeys):
            output_id = f"{body_id}:solid-{key}"
            if output_id in bodies_by_id:
                raise ValueError("Duplicate output body identity.")
            output = document.addObject("PartDesign::Body", "OutputBody")
            base = document.addObject("PartDesign::Feature", "ExtrusionSolid")
            output.addObject(base)
            base.Shape = solid
            output.Tip = base
            output.addProperty("App::PropertyString", "AetherSourceFeatureId")
            output.AetherSourceFeatureId = feature.id
            bodies_by_id[output_id] = output
            built[(feature.id, output_id)] = solid.copy()
        document.recompute()
    if "AetherSolidKeys" not in result.PropertiesList:
        built[(feature.id, body_id)] = shape.copy()
    built[feature.id] = result


def _build_part_object(document, name, features):
    """Build one part's features and return the object carrying its shape.

    Goes through `_apply_feature`, the same path a Part document uses, so a
    part placed in an assembly is the part — not a second interpretation of
    the same features.
    """
    bodies_by_id: dict[str, object] = {}
    sketches: dict[str, object] = {}
    built: dict[str, object] = {}
    for feature in features:
        _apply_feature(document, feature, bodies_by_id, sketches, built)
    document.recompute()
    if not bodies_by_id:
        raise ValueError(f"part {name!r} produced no solid")
    if any(hasattr(body, 'Mesh') for body in bodies_by_id.values()):
        raise ValueError('Assembly placement requires solids. Convert mesh references to solids before placing this Part.')
    # One body per part definition: an assembly places a part, not a scene.
    return next(iter(bodies_by_id.values()))


def _build(job, export_options=None, analysis_options=None):
    document = FreeCAD.newDocument("aether")
    try:
        started = time.time()
        bodies_by_id = {}
        sketches = {}
        built = {}
        diagnostics = []
        features = (
            job.features
            if job.rollback is None
            else job.features[: max(0, int(job.rollback))]
        )
        preview = None
        body_outputs = {}
        scope_resolutions = {}
        if job.preview_feature_id and (not features or features[-1].id != job.preview_feature_id):
            raise ValueError("Preview must name the last evaluated feature.")
        for feature in features:
            try:
                if feature.id == job.preview_feature_id:
                    from aether_freecad.feature_preview import snapshot, difference
                    before = snapshot(bodies_by_id)
                    transform_anchor = None
                    if feature.kind == 'transform':
                        from aether_freecad.transform_preview import transform_frame
                        transform_anchor = transform_frame(before, feature.parameters)
                        from aether_freecad.transform_reference import resolve_transform
                        resolved_transform, reference_direction = resolve_transform(feature.parameters.get('transform'), built)
                        if transform_anchor and feature.parameters.get('transform', {}).get('kind', '').endswith('-reference'):
                            transform_anchor['resolved_transform'] = resolved_transform
                            if reference_direction is not None:
                                transform_anchor['reference_direction'] = reference_direction
                    axes = []
                    feature = replace(feature, parameters={**feature.parameters, '_preview_axes': axes, '_preview_frame': {}})
                resolution = _apply_feature(document, feature, bodies_by_id, sketches, built)
                if resolution is not None:
                    scope_resolutions[feature.id] = resolution
                # Capture each producer now, before a later Boolean consumes its
                # outputs. Rollback/history must retain the original identities.
                produced = sorted(key for key, body in bodies_by_id.items()
                                  if getattr(body, "AetherSourceFeatureId", None) == feature.id)
                if produced:
                    body_outputs[feature.id] = produced
                if feature.id == job.preview_feature_id:
                    document.recompute()
                    merge_scope = (feature.parameters.get("target_body_ids", ())
                                   if feature.parameters.get("operation") == "add" else ())
                    preview = difference(before, snapshot(bodies_by_id), _geometry,
                                         job.tessellation_tolerance_mm, merge_scope,
                                         resolution.get("groups", []) if resolution and feature.parameters.get("operation") == "add" else ())
                    preview['feature_id'] = feature.id
                    preview['extrusion_axes'] = axes
                    if feature.kind == 'transform':
                        preview['transform_frame'] = transform_anchor
                    elif feature.kind == 'offset-face' and feature.parameters.get('_preview_frame'):
                        preview['transform_frame'] = feature.parameters['_preview_frame']
            except Exception as error:
                diagnostics.append(
                    {
                        "feature_id": feature.id,
                        "severity": "error",
                        "message": str(error),
                    }
                )
                break
        document.recompute()
        if analysis_options is not None:
            if diagnostics:
                return {"status": "error", "diagnostics": diagnostics, "message": "Analysis requires a complete rebuild."}
            from aether_freecad.analysis import analyze_bodies

            return analyze_bodies(bodies_by_id, analysis_options, _geometry, job.tessellation_tolerance_mm)
        if export_options is not None:
            if diagnostics:
                return {
                    "status": "error",
                    "diagnostics": diagnostics,
                    "message": "Export requires a complete successful rebuild.",
                }
            from aether_freecad.exporting import export_bodies

            return export_bodies(bodies_by_id, export_options)
        bodies = []
        for body_id, body in bodies_by_id.items():
            if hasattr(body, "Mesh"):
                from aether_freecad.cad_import import mesh_geometry
                bodies.append(dict(mesh_geometry(body.Mesh), id=body_id))
                continue
            shape = getattr(body, "Shape", None)
            if (
                shape is not None
                and not shape.isNull()
                and shape.Solids
                and shape.isValid()
            ):
                geometry = _geometry(shape, job.tessellation_tolerance_mm)
                if body_id != "default":
                    geometry["id"] = body_id
                bodies.append(geometry)
        failed = any(item["severity"] == "error" for item in diagnostics)
        return {
            "status": "error" if failed and not bodies else "ok",
            "bodies": bodies,
            "preview": preview if not failed else None,
            "sketch_frames": {
                sketch.AetherSourceProfileId: json.loads(sketch.AetherResolvedFrame)
                for sketch in sketches.values() if "AetherResolvedFrame" in sketch.PropertiesList
            },
            "body_outputs": body_outputs,
            "scope_resolutions": scope_resolutions if not failed else {},
            "diagnostics": diagnostics,
            "engine": _engine_name(),
            "build_seconds": round(time.time() - started, 6),
            "message": "" if not failed else "Some features did not build.",
        }
    finally:
        FreeCAD.closeDocument(document.Name)


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
            if payload.get("request") == "describe":
                result = {
                    "status": "ok",
                    "engine": _engine_name(),
                    "protocol": PROTOCOL_VERSION,
                    "licence": "LGPL-2.1-or-later",
                    "capabilities": [
                        "sketch-wire",
                        "sketch-connected-region",
                        "sketch-fixed-geometry",
                        "sketch-ellipse",
                        "sketch-conic",
                        "sketch-pierce",
                        "pad",
                        "pocket",
                        "revolve",
                        "mirror",
                        "fillet",
                        "chamfer",
                        "sweep",
                        "shell",
                        "face-extrude",
                        "offset-face",
                        "move-face",
                        "part-transform",
                        "referenced-part-transform",
                        "solid-edge-transform",
                        "hole",
                        "loft",
                        "draft",
                        "pattern", "boolean",
                        "import-step",
                        "import-cad",
                        "extrude-regions",
                        "extrude-draft",
                        "extrude-independent-ends",
                        "extrude-drafted-limits",
                        "extrude-direction-vector",
                        "extrude-sketch-line-direction",
                        "extrude-thin",
                        "extrude-up-to-part",
                        "extrude-general-next",
                        "extrude-drafted-general-next",
                        "extrude-curved-face",
                        "extrude-up-to-vertex",
                        "extrude-reference-start",
                        "extrude-automatic-scope",
                        "extrude-symmetric-through-all",
                        "section",
                        "interference",
                        "multiple-bodies",
                        "export-step",
                        "export-stl",
                        "assembly-solve",
                    ],
                    "bodies": [],
                }
            elif payload.get("request") == "assembly":
                from aether_freecad.assembly import solve as solve_assembly

                result = solve_assembly(
                    assembly_job_from_json(payload), _build_part_object
                )
                result.setdefault("engine", _engine_name())
            else:
                result = _build(job_from_json(payload), payload.get("export"), payload.get("analysis"))
        except Exception as error:
            result = {
                "status": "error",
                "message": f"{error}",
                "detail": traceback.format_exc(limit=3),
                "bodies": [],
            }
        sys.stdout.write("\n" + RESULT_PREFIX + json.dumps(result) + "\n")
        sys.stdout.flush()


# freecadcmd executes this file through its own console, NOT as "__main__",
# so the usual guard would never fire. Guard on stdin being a pipe instead:
# that is true when the engine drives us and false if a human opens the file.
if not sys.stdin.isatty():
    main()
