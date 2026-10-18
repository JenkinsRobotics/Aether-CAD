"""Checked geometric vertex references, independent of transient VertexN order.

Unique incident surface/edge signatures follow dimensional edits. Repeated
signatures require an unchanged geometric fingerprint and exact point; a changed
ambiguous source fails for repair, never nearest-neighbour substitution.
"""
import hashlib
import json
import math
from collections import Counter


def _numbers(values):
    return [round(float(v), 7) + 0.0 for v in values]


def point_key(point):
    return tuple(_numbers(point))


def vertex_anchors(shape):
    import Part

    records = {point_key(v.Point): {"point": list(v.Point), "faces": [], "edges": [], "face_indices": [], "edge_indices": []}
               for v in shape.Vertexes}
    structure = [sorted(Counter(type(f.Surface).__name__ for f in shape.Faces).items()),
                 len(shape.Edges), len(shape.Vertexes), len(shape.Solids)]
    faces = []
    for face_index, face in enumerate(shape.Faces):
        kind = type(face.Surface).__name__
        faces.append([kind, _numbers(face.CenterOfMass), round(face.Area, 7)])
        seen = set()
        for vertex in face.Vertexes:
            key = point_key(vertex.Point)
            if key in seen:
                continue
            seen.add(key)
            try:
                u, v = face.Surface.parameter(vertex.Point)
                normal = _numbers(face.normalAt(u, v))
            except (Part.OCCError, RuntimeError, ValueError):
                normal = None
            records[key]["faces"].append([kind, normal])
            records[key]["face_indices"].append(face_index)
    edges = []
    for edge_index, edge in enumerate(shape.Edges):
        try:
            kind = type(edge.Curve).__name__
        except (Part.OCCError, TypeError):
            # Sphere/cone poles carry zero-length topological edges without
            # an underlying curve. Keep them in the adjacency signature.
            kind = "Degenerate"
        edges.append([kind, round(edge.Length, 7), _numbers(edge.CenterOfMass)])
        for key in {point_key(v.Point) for v in edge.Vertexes}:
            records[key]["edges"].append(kind)
            records[key]["edge_indices"].append(edge_index)
    encode = lambda value: json.dumps(value, sort_keys=True, separators=(",", ":"))
    fingerprint = hashlib.sha256(encode([sorted(records), sorted(faces, key=encode),
                                        sorted(edges, key=encode)]).encode()).hexdigest()
    return {key: {"positionMillimeters": record["point"], "shapeFingerprint": fingerprint,
                  "incidence": encode([record["face_indices"], record["edge_indices"]]),
                  "signature": encode([structure, sorted(record["faces"], key=encode), sorted(record["edges"])])}
            for key, record in records.items()}


def resolve_vertex(shape, anchor):
    from FreeCAD import Vector

    position = anchor.get("positionMillimeters") if isinstance(anchor, dict) else None
    if (not isinstance(position, list) or len(position) != 3
            or any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in position)
            or not isinstance(anchor.get("signature"), str) or not 1 <= len(anchor["signature"]) <= 16384
            or not isinstance(anchor.get("incidence"), str) or not 1 <= len(anchor["incidence"]) <= 16384
            or not isinstance(anchor.get("shapeFingerprint"), str) or len(anchor["shapeFingerprint"]) != 64):
        raise ValueError("Invalid stopping vertex anchor. Reselect the point.")
    anchors = list(vertex_anchors(shape).values())
    matches = [item for item in anchors if item["signature"] == anchor["signature"]]
    if len(matches) > 1:
        matches = [item for item in matches if item["shapeFingerprint"] == anchor["shapeFingerprint"]
                   and (Vector(*item["positionMillimeters"]) - Vector(*position)).Length <= 1e-6]
    # Incidence order is only a refusal guard, never the primary selector.
    # It catches symmetric rotations/permutations that preserve world geometry
    # but exchange authored corners; unrelated kernel reorder may need repair.
    if len(matches) != 1 or matches[0]["incidence"] != anchor["incidence"]:
        raise ValueError("Stopping vertex changed or is ambiguous. Reselect it on the earlier part.")
    return Vector(*matches[0]["positionMillimeters"])
