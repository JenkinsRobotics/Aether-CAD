import FreeCAD
import Part
import hashlib
import math
import struct

KIND_PREFERENCE = {
    "face-center": 0,
    "sphere-center": 1,
    "torus-center": 1,
    "cylinder-axis": 1,
    "cone-axis": 1,
    "circle-center": 1,
    "ellipse-center": 1,
    "edge-midpoint": 2,
    "vertex": 3,
}

def _same_origin(a, b, tol=1e-6):
    return abs(a[0] - b[0]) < tol and abs(a[1] - b[1]) < tol and abs(a[2] - b[2]) < tol

def _add_unique_candidate(candidates, candidate):
    for i, existing in enumerate(candidates):
        if _same_origin(existing["origin"], candidate["origin"]):
            if KIND_PREFERENCE.get(candidate["kind"], 99) < KIND_PREFERENCE.get(existing["kind"], 99):
                candidates[i] = candidate
            return
    candidates.append(candidate)

def _safe_normalize(vec, fallback=(1,0,0)):
    length = vec.Length
    if length < 1e-9:
        return FreeCAD.Vector(*fallback)
    # `*` returns a new vector; Vector.multiply() would scale the caller's
    # own vector in place, and callers reuse what they pass in.
    return vec * (1.0 / length)

def _connector_axes(z_axis, x_axis_fallback):
    z = _safe_normalize(z_axis, (0,0,1))
    
    # Project X onto plane orthogonal to Z
    dot = x_axis_fallback.dot(z)
    # z.multiply(dot) would scale z itself — when the fallback X is square
    # to the face, dot is 0 and the normal we are about to return becomes
    # the zero vector.
    x = x_axis_fallback.sub(z * dot)
    
    if x.Length < 1e-9:
        # fallback if X is parallel to Z
        if abs(z.z) < 0.99:
            x = FreeCAD.Vector(0,0,1).cross(z)
        else:
            x = FreeCAD.Vector(1,0,0).cross(z)
            
    x = _safe_normalize(x, (1,0,0))
    y = _safe_normalize(z.cross(x), (0,1,0))
    
    return {
        "xAxis": [x.x, x.y, x.z],
        "yAxis": [y.x, y.y, y.z],
        "zAxis": [z.x, z.y, z.z],
    }

def _frame_at_edge(edge, position, fallback_frame):
    try:
        tangent = edge.tangentAt(position)
        fallback_z = FreeCAD.Vector(*fallback_frame["zAxis"])
        return _connector_axes(fallback_z, tangent)
    except Exception:
        return fallback_frame

def _curve_candidates(face_id, edge, face_frame, edge_index, anchors=None):
    candidates = []
    try:
        curve = getattr(edge, "Curve", None)
    except TypeError:
        # Degenerate pole edges have no curve, but their vertices are real.
        curve = None
    
    if isinstance(curve, Part.Circle):
        try:
            axis = curve.Axis
            candidates.append({
                "id": f"face-{face_id}-circle-{edge_index}",
                "faceId": face_id,
                "kind": "circle-center",
                "label": f"Circular edge {edge_index + 1} center",
                "origin": [curve.Center.x, curve.Center.y, curve.Center.z],
                **_connector_axes(axis, FreeCAD.Vector(1, 0, 0)) # simplified X direction
            })
        except Exception:
            pass
    elif isinstance(curve, Part.Ellipse):
        try:
            candidates.append({
                "id": f"face-{face_id}-ellipse-{edge_index}",
                "faceId": face_id,
                "kind": "ellipse-center",
                "label": f"Elliptical edge {edge_index + 1} center",
                "origin": [curve.Center.x, curve.Center.y, curve.Center.z],
                **_connector_axes(curve.Axis, FreeCAD.Vector(1, 0, 0))
            })
        except Exception:
            pass

    from aether_freecad.edge_reference import edge_anchor
    anchor = edge_anchor(edge, anchors) if anchors is not None else None
    measurements = {"lengthMillimeters": edge.Length}
    if isinstance(curve, Part.Circle):
        measurements.update({"radiusMillimeters": curve.Radius, "centerMillimeters": [curve.Center.x, curve.Center.y, curve.Center.z]})
    mid = (edge.FirstParameter + edge.LastParameter) / 2
    try:
        mid_pt = edge.valueAt(mid)
        if isinstance(curve, Part.Line):
            direction = edge.tangentAt(mid)
            measurements["linearDirection"] = [direction.x, direction.y, direction.z]
        candidates.append({
            "id": f"face-{face_id}-edge-{edge_index}",
            "faceId": face_id,
            "kind": "edge-midpoint",
            **({"edgeAnchor": anchor} if anchor is not None else {}),
            "measurements": measurements,
            "label": f"Edge {edge_index + 1} midpoint",
            "origin": [mid_pt.x, mid_pt.y, mid_pt.z],
            **_frame_at_edge(edge, mid, face_frame)
        })
    except Exception:
        pass
        
    if edge.Vertexes:
        try:
            v0 = edge.Vertexes[0].Point
            candidates.append({
                "id": f"face-{face_id}-vertex-{edge_index}-a",
                "faceId": face_id,
                "kind": "vertex",
                "label": f"Vertex {edge_index + 1}A",
                "origin": [v0.x, v0.y, v0.z],
                **_frame_at_edge(edge, edge.FirstParameter, face_frame)
            })
            
            v1 = edge.Vertexes[-1].Point
            candidates.append({
                "id": f"face-{face_id}-vertex-{edge_index}-b",
                "faceId": face_id,
                "kind": "vertex",
                "label": f"Vertex {edge_index + 1}B",
                "origin": [v1.x, v1.y, v1.z],
                **_frame_at_edge(edge, edge.LastParameter, face_frame)
            })
        except Exception:
            pass
            
    return candidates

def _cylinder_axis_stations(first_v, last_v):
    return [
        {"role": "bottom", "parameter": first_v},
        {"role": "middle", "parameter": (first_v + last_v) / 2},
        {"role": "top", "parameter": last_v},
    ]

def _append_axial_stations(candidates, face_id, kind, axis_origin, axis_direction, frame, first_v, last_v, axial_scale=1.0):
    for station in _cylinder_axis_stations(first_v, last_v):
        # Scaling in place here would compound across stations: the second
        # one would walk along an axis the first had already stretched.
        pt = axis_origin.add(axis_direction * (station["parameter"] * axial_scale))
        _add_unique_candidate(candidates, {
            "id": f"face-{face_id}-{kind}-{station['role']}",
            "faceId": face_id,
            "kind": kind,
            "label": f"Exact {'cone' if kind == 'cone-axis' else 'cylinder'} axis {station['role']}",
            "origin": [pt.x, pt.y, pt.z],
            **frame
        })

def extract_face_topology(face, face_id, anchors=None):
    candidates = []
    
    try:
        center = face.CenterOfMass
        center_vec = [center.x, center.y, center.z]
    except Exception:
        center_vec = [0.0, 0.0, 0.0]
        
    surface = getattr(face, "Surface", None)
    surface_type = type(surface).__name__ if surface else "UNAVAILABLE"
    face_frame = _connector_axes(FreeCAD.Vector(0,0,1), FreeCAD.Vector(1,0,0))
    
    if isinstance(surface, Part.Plane):
        surface_type = "PLANE"
        try:
            u, v = surface.parameter(face.CenterOfMass)
            axis = face.normalAt(u, v)
            x_dir = getattr(surface.Position, "XDirection", FreeCAD.Vector(1,0,0))
            if x_dir is None:
                x_dir = surface.Position.Rotation.multVec(FreeCAD.Vector(1,0,0))
            face_frame = _connector_axes(axis, x_dir)
        except Exception:
            pass
    elif isinstance(surface, Part.Cylinder):
        surface_type = "CYLINDRE"
        try:
            axis = surface.Axis
            loc = surface.Position.Base
            x_dir = surface.Position.Rotation.multVec(FreeCAD.Vector(1,0,0))
            face_frame = _connector_axes(axis, x_dir)
            _append_axial_stations(candidates, face_id, "cylinder-axis", loc, axis, face_frame, face.ParameterRange[2], face.ParameterRange[3])
        except Exception:
            pass
    elif isinstance(surface, Part.Cone):
        surface_type = "CONE"
        try:
            axis = surface.Axis
            loc = surface.Position.Base
            x_dir = surface.Position.Rotation.multVec(FreeCAD.Vector(1,0,0))
            face_frame = _connector_axes(axis, x_dir)
            _append_axial_stations(candidates, face_id, "cone-axis", loc, axis, face_frame, face.ParameterRange[2], face.ParameterRange[3], math.cos(surface.SemiAngle))
        except Exception:
            pass
    elif isinstance(surface, Part.Sphere):
        surface_type = "SPHERE"
        try:
            loc = surface.Position.Base
            _add_unique_candidate(candidates, {
                "id": f"face-{face_id}-sphere-center",
                "faceId": face_id,
                "kind": "sphere-center",
                "label": "Exact sphere center",
                "origin": [loc.x, loc.y, loc.z],
                **face_frame
            })
        except Exception:
            pass
    elif isinstance(surface, Part.Toroid):
        surface_type = "TORUS"
        try:
            loc = surface.Position.Base
            _add_unique_candidate(candidates, {
                "id": f"face-{face_id}-torus-center",
                "faceId": face_id,
                "kind": "torus-center",
                "label": "Exact torus center and revolution axis",
                "origin": [loc.x, loc.y, loc.z],
                **face_frame
            })
        except Exception:
            pass
    else:
        try:
            # Fallback to normal at center for other types
            u, v = surface.parameter(face.CenterOfMass)
            normal = face.normalAt(u, v)
            if face.Orientation == "Reversed":
                normal = normal.negative()
            face_frame = _connector_axes(normal, FreeCAD.Vector(1,0,0))
        except Exception:
            pass

    _add_unique_candidate(candidates, {
        "id": f"face-{face_id}-center",
        "faceId": face_id,
        "kind": "face-center",
        "label": f"{surface_type.lower()} face center",
        "origin": center_vec,
        **face_frame
    })

    for edge_idx, edge in enumerate(face.Edges):
        for candidate in _curve_candidates(face_id, edge, face_frame, edge_idx, anchors):
            _add_unique_candidate(candidates, candidate)
            
    measurements = {"areaSquareMillimeters": face.Area}
    if isinstance(surface, Part.Plane):
        normal = face.normalAt(0, 0)
        measurements["planarNormal"] = [normal.x, normal.y, normal.z]
    if isinstance(surface, (Part.Cylinder, Part.Sphere)):
        measurements["radiusMillimeters"] = surface.Radius
    return {
        "id": face_id,
        "measurements": measurements,
        "surfaceType": surface_type,
        "candidates": candidates
    }

def _face_signature(face):
    """What makes this face this face, in terms that survive a rebuild.

    Deliberately geometric: surface kind, centre of mass and area. FreeCAD's
    own `hashCode` is the address of the underlying TShape, so it is a fresh
    number on every build — fine for de-duplicating handles inside one pass,
    useless as the id a saved construction plane points at.
    """
    surface = getattr(face, "Surface", None)
    kind = type(surface).__name__ if surface else "UNAVAILABLE"
    try:
        centre = face.CenterOfMass
        measures = (centre.x, centre.y, centre.z, float(face.Area))
    except Exception:
        measures = (0.0, 0.0, 0.0, 0.0)
    # `+ 0.0` collapses -0.0, which formats differently but means the same
    # place. 6dp is a nanometre at millimetre scale: far below any tolerance
    # we build to, far above the float noise a rebuild introduces.
    return kind + "|" + "|".join(f"{round(float(v), 6) + 0.0:.6f}" for v in measures)


def stable_face_ids(shape):
    """A deterministic id per face, in `shape.Faces` order.

    Tessellation and topology both label faces, and the viewer looks one up by
    the other's id, so they must agree — hence one list, built once.
    """
    ids = []
    seen = {}
    for index, face in enumerate(shape.Faces):
        try:
            signature = _face_signature(face)
        except Exception:
            signature = f"UNAVAILABLE|{index}"
        # Coincident faces can share a signature. The occurrence keeps their
        # ids apart and stays deterministic, because face order is stable.
        occurrence = seen.get(signature, 0)
        seen[signature] = occurrence + 1
        digest = hashlib.blake2b(
            f"{signature}|{occurrence}".encode(), digest_size=4
        ).digest()
        # Signed 32-bit: the wire contract and the viewer both say `number`.
        ids.append(struct.unpack("<i", digest)[0])
    return ids


def extract_topology(shape, face_ids=None):
    from aether_freecad.vertex_reference import point_key, vertex_anchors
    anchors = vertex_anchors(shape)
    topology = []
    if face_ids is None:
        face_ids = stable_face_ids(shape)
    for face, face_id in zip(shape.Faces, face_ids):
        try:
            entry=extract_face_topology(face, face_id, anchors)
            from aether_freecad.surface_reference import reference_for_surface
            reference=reference_for_surface(shape,face)
            if reference is not None:
                entry['surfaceReference']=reference
            topology.append(entry)
        except Exception as e:
            import sys
            print(f"Exception in extract_topology: {e}", file=sys.stderr)
            topology.append({"id": face_id, "surfaceType": "UNAVAILABLE", "candidates": []})
    for face in topology:
        for candidate in face["candidates"]:
            if candidate["kind"] == "vertex":
                candidate["vertexAnchor"] = anchors.get(point_key(candidate["origin"]))
    return topology
