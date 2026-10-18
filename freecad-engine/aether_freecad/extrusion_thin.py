"""Native planar walls around authored sketch wires, before normal extrusion.

FreeCAD's public TopoShape.makeOffset2D supplies OCCT curve offsets. Open
endpoints are joined by straight caps; closed curves retain their inner hole.
All geometry is built in the sketch's XY frame and then placed back in space.
Offset splines use OCCT's BSpline conversion with bounded area preservation.
"""
import math


def wall_sides(thin):
    if not isinstance(thin, dict):
        raise TypeError("Thin extrusion requires wall thicknesses.")
    for flag in ("midplane", "flipped"):
        if flag in thin and not isinstance(thin[flag], bool):
            raise TypeError("Thin extrusion options must be true or false.")
    a, b = thin.get("thickness_1_mm"), thin.get("thickness_2_mm")
    if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v)
           or v < 0 or v > 1e6 for v in (a, b)):
        raise ValueError("Wall thicknesses must be finite nonnegative distances up to 1000000 mm.")
    if thin.get("midplane"):
        total = thin.get("midplane_thickness_mm")
        if isinstance(total, bool) or not isinstance(total, (int, float)) or not math.isfinite(total) or not 0 < total <= 1e6:
            raise ValueError("Mid plane thickness must be positive and at most 1000000 mm.")
        a = b = total / 2
    if a + b <= 1e-7:
        raise ValueError("The total wall thickness must be positive.")
    return (b, a) if thin.get("flipped") else (a, b)


def _endpoints(wire):
    return wire.OrderedVertexes[0].Point, wire.OrderedVertexes[-1].Point


def _end_tangent(edge, point, into):
    at_start = (edge.valueAt(edge.FirstParameter) - point).Length < 1e-7
    tangent = edge.tangentAt(edge.FirstParameter if at_start else edge.LastParameter)
    return tangent * (1 if at_start == into else -1)


def _open_offset(wire, distance):
    import Part
    from FreeCAD import Vector

    if abs(distance) < 1e-12:
        return wire.copy(), *_endpoints(wire)
    start, end = _endpoints(wire)
    first = _end_tangent(wire.OrderedEdges[0], start, True)
    last = _end_tangent(wire.OrderedEdges[-1], end, False)
    start_target = start + first.cross(Vector(0, 0, 1)) * distance
    end_target = end + last.cross(Vector(0, 0, 1)) * distance
    # A straight wire does not define a plane for OCCT's automatic plane finder.
    if all(isinstance(e.Curve, Part.Line) for e in wire.Edges) and all(
            first.cross(v.Point - start).Length < 1e-7 for v in wire.Vertexes):
        copy = wire.copy()
        copy.translate(first.cross(Vector(0, 0, 1)) * distance)
        return copy, start_target, end_target
    # OCCT's inferred plane can reverse an open arc's sign. Match both endpoints
    # against the authored XY orientation instead of depending on that inference.
    tolerance = max(1e-6, abs(distance) * 1e-6)
    for sign in (1, -1):
        try:
            result = wire.makeOffset2D(sign * distance, join=2, fill=False, openResult=True)
        except (Part.OCCError, RuntimeError):
            continue
        if len(result.Wires) != 1:
            continue
        candidate = result.Wires[0]
        if candidate.isClosed() or not candidate.isValid():
            continue
        p, q = _endpoints(candidate)
        if (min((p - start_target).Length, (q - start_target).Length) < tolerance
                and min((p - end_target).Length, (q - end_target).Length) < tolerance):
            ordered = (p, q) if (p-start_target).Length < (q-start_target).Length else (q, p)
            return candidate, *ordered
    raise ValueError("This wall offset collapses or changes the open contour. Reduce thickness or repair the sketch.")


def _face(wire):
    """Give native offset splines fresh plane curves, preserving their area."""
    import Part

    face = Part.Face(wire)
    area = face.Area
    if any(isinstance(edge.Curve, Part.OffsetCurve) for edge in wire.Edges):
        edges = [edge.Curve.toBSpline(edge.FirstParameter, edge.LastParameter).toShape()
                 if isinstance(edge.Curve, Part.OffsetCurve) else edge for edge in wire.Edges]
        converted = Part.Wire(Part.__sortEdges__(edges))
        if not converted.isClosed() or len(converted.Edges) != len(wire.Edges):
            raise ValueError("The spline wall offset does not form a complete boundary.")
        face = Part.Face(converted)
    if not face.isValid():
        face.fix(1e-7, 1e-7, 1e-6)
    if abs(face.Area - area) > max(1e-8, abs(area) * 1e-8):
        raise ValueError("The thin wall boundary cannot be repaired without changing its area.")
    return face


def _closed_face(wire, distance):
    result = wire.copy() if abs(distance) < 1e-12 else wire.makeOffset2D(distance, join=2, fill=False)
    if len(result.Wires) != 1 or not result.Wires[0].isClosed():
        raise ValueError("The wall offset splits or collapses the closed contour. Reduce thickness.")
    face = _face(result.Wires[0])
    if not face.isValid() or face.Area <= 1e-9:
        raise ValueError("The wall offset does not produce a valid planar face.")
    return face


def thin_profile_face(sketch, thin):
    import Part

    a, b = wall_sides(thin)
    if len(sketch.Shape.Wires) != 1:
        raise ValueError("Choose one connected sketch contour for each thin wall.")
    wire = sketch.Shape.Wires[0].copy()
    wire.transformShape(sketch.Placement.inverse().toMatrix())
    if not wire.isValid() or wire.Length <= 1e-7:
        raise ValueError("Thin extrusion requires a valid nonzero sketch curve.")
    if wire.isClosed():
        outer, inner = _closed_face(wire, a), _closed_face(wire, -b)
        if outer.Area <= inner.Area or inner.cut(outer).Area > max(1e-8, inner.Area * 1e-8):
            raise ValueError("Wall offsets cross. Reduce thickness or repair the contour.")
        face = outer.cut(inner).removeSplitter()
        if len(face.Faces) != 1 or len(face.Wires) != 2:
            raise ValueError("The wall offset collapses the inner contour. Reduce thickness.")
    else:
        right, r0, r1 = _open_offset(wire, a)
        left, l0, l1 = _open_offset(wire, -b)
        boundary = Part.Wire(Part.__sortEdges__([*right.Edges, Part.makeLine(r1, l1), *left.Edges, Part.makeLine(l0, r0)]))
        if not boundary.isClosed() or len(boundary.Edges) != len(right.Edges) + len(left.Edges) + 2:
            raise ValueError("The wall offset does not form a complete capped boundary.")
        face = _face(boundary)
    if not face.isValid() or len(face.Faces) != 1 or face.Area <= 1e-9:
        raise ValueError("The thin wall self-intersects or collapses. Repair the sketch or reduce thickness.")
    face.check(True)
    face.transformShape(sketch.Placement.toMatrix())
    return face
