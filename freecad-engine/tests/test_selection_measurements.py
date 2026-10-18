"""Displayed measurements are native analytic quantities, not tessellation math."""
import math
import pytest
from aether_freecad import BuildJob, Feature, FreeCADEngine


def test_cylinder_face_areas_and_circular_edge_measurements():
    with FreeCADEngine() as engine:
        result = engine.build(BuildJob(features=[
            Feature("circle", "sketch-circle", {"radius_mm": 10}),
            Feature("pad", "pad", {"profile": "circle", "distance_mm": 20, "operation": "new", "body_id": "cylinder"}),
        ]))
    assert result.diagnostics == []
    faces = result.bodies[0].topology
    wall = next(face for face in faces if face["surfaceType"] == "CYLINDRE")
    assert wall["measurements"]["radiusMillimeters"] == pytest.approx(10)
    assert wall["measurements"]["areaSquareMillimeters"] == pytest.approx(400 * math.pi)
    assert "planarNormal" not in wall["measurements"]
    caps = [face for face in faces if face["surfaceType"] == "PLANE"]
    assert len(caps) == 2
    for cap in caps:
        assert cap["measurements"]["areaSquareMillimeters"] == pytest.approx(100 * math.pi)
        circle = next(c["measurements"] for c in cap["candidates"] if c["kind"] == "edge-midpoint" and "radiusMillimeters" in c.get("measurements", {}))
        assert circle["lengthMillimeters"] == pytest.approx(20 * math.pi)
        assert circle["radiusMillimeters"] == pytest.approx(10)
        assert "linearDirection" not in circle
        assert circle["centerMillimeters"][:2] == pytest.approx([0, 0])
        assert circle["centerMillimeters"][2] == pytest.approx(0) or circle["centerMillimeters"][2] == pytest.approx(20)


def test_linear_edge_lengths_and_planar_area():
    with FreeCADEngine() as engine:
        result = engine.build(BuildJob(features=[
            Feature("box", "sketch-rectangle", {"width_mm": 10, "height_mm": 20}),
            Feature("pad", "pad", {"profile": "box", "distance_mm": 30, "operation": "new"}),
        ]))
    assert result.diagnostics == []
    faces = result.bodies[0].topology
    assert sorted(round(f["measurements"]["areaSquareMillimeters"]) for f in faces) == [200, 200, 300, 300, 600, 600]
    lengths = {round(c["measurements"]["lengthMillimeters"]) for face in faces for c in face["candidates"] if c["kind"] == "edge-midpoint"}
    assert lengths == {10, 20, 30}


def test_tilted_planar_normals_and_straight_edge_directions_are_native():
    sine, cosine = 0.5, math.sqrt(3) / 2
    with FreeCADEngine() as engine:
        result = engine.build(BuildJob(features=[
            Feature("box", "sketch-rectangle", {"width_mm": 10, "height_mm": 20,
                "frame": {"originMillimeters": [7, -2, 11], "xDirection": [cosine, 0, -sine], "normal": [sine, 0, cosine]}}),
            Feature("pad", "pad", {"profile": "box", "distance_mm": 30, "operation": "new"}),
        ]))
    assert result.diagnostics == []
    faces = result.bodies[0].topology
    cap = next(face for face in faces if face["measurements"]["areaSquareMillimeters"] == pytest.approx(200)
               and face["measurements"]["planarNormal"][2] > 0)
    assert cap["measurements"]["planarNormal"] == pytest.approx([sine, 0, cosine])
    edges = [candidate["measurements"] for candidate in cap["candidates"] if candidate["kind"] == "edge-midpoint"]
    short = next(edge for edge in edges if edge["lengthMillimeters"] == pytest.approx(10))
    assert abs(short["linearDirection"][0]) == pytest.approx(cosine)
    assert abs(short["linearDirection"][2]) == pytest.approx(sine)
    for face in faces:
        assert math.hypot(*face["measurements"]["planarNormal"]) == pytest.approx(1)
