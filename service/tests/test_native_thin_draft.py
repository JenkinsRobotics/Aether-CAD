"""Thin + Draft is an editable native feature through the same agent operations."""

import json
import math

import pytest

from test_native_feature_operations import native, run, volume
from test_native_program import empty, invoke


@native
@pytest.mark.parametrize("thin", [False, True])
@pytest.mark.parametrize("curved", [False, True])
def test_agent_oblique_draft_edits_and_reopens(tmp_path, thin, curved):
    contour = {"id": "outline", "type": "circle", "center": [0, 0], "radius": 10} if curved else {
        "id": "outline", "type": "path", "start": [0, 0],
        "segments": [{"type": "line", "end": p} for p in [[20, 0], [20, 10], [0, 10], [0, 0]]],
    }
    authored = run(tmp_path, empty(), [
        {"id": "sketch", "tool": "aether_cad_feature_add", "arguments": {"feature_json": {
            "type": "profile", "name": "Draft sketch", "plane": "XY", "offsetMillimeters": 0,
            "profile": {"type": "drawing", "contours": [contour]},
        }}},
        {"id": "draft", "tool": "aether_cad_feature_add", "arguments": {"feature_json": {
            "type": "extrude", "name": "Angled draft", "profileFeatureId": {"$ref": "sketch.feature_id"},
            "profileContourId": "outline", "distanceMillimeters": 10, "operation": "new",
            "directionVector": [0.6, 0, 0.8], "startingOffsetMillimeters": 2, "draftAngleDegrees": 3,
            **({"thin": {"thickness1Millimeters": 2, "thickness2Millimeters": 1}} if thin else {}),
        }}},
    ])

    def integral(z, angle, width=20, height=10):
        a, theta = math.radians(angle), math.atan2(0.6, 0.8)
        wx = math.tan(theta + a) - math.tan(theta - a)
        wy = 2 * math.sin(a) / math.sqrt(0.8**2 - math.sin(a)**2)
        return width * height * z - (width * wy + height * wx) * z**2 / 2 + wx * wy * z**3 / 3

    def expected(angle):
        def section(z):
            if curved:
                return circle_integral(12, z, angle) - circle_integral(9, z, -angle) if thin else circle_integral(10, z, angle)
            return integral(z, angle, 24, 14) - integral(z, -angle, 18, 8) if thin else integral(z, angle)
        return section(9.6) - section(1.6)

    # Native B-spline integration and the 1e-7 mm fitting budget use the same
    # 5e-5 mm^3 bound as the independent engine volume gate. Planar tolerance
    # remains unchanged; wall-angle and position tolerances are tested directly.
    volume_tolerance = 5e-5 if curved else 1e-5
    assert volume(authored) == pytest.approx(expected(3), abs=volume_tolerance)
    feature_id = authored["result"]["references"]["draft"]["feature_id"]
    edited = run(tmp_path, authored["content"], [
        {"id": "resize", "tool": "aether_cad_feature_update", "arguments": {
            "feature_id": feature_id, "changes_json": '{"draftAngleDegrees":-3}',
        }},
    ])
    assert volume(edited) == pytest.approx(expected(-3), abs=volume_tolerance)
    reopened = invoke(tmp_path, "cad.part.verify", edited["content"], {})
    assert reopened["result"]["measurements"][0]["volume_mm3"] == pytest.approx(expected(-3), abs=volume_tolerance)
    failed = invoke(tmp_path, "cad.part.runprogram", edited["content"], {"program_json": json.dumps({"version": 1, "steps": [
        {"id": "collapse", "tool": "aether_cad_feature_update", "arguments": {
            "feature_id": feature_id, "changes_json": '{"draftAngleDegrees":40,"distanceMillimeters":100}',
        }},
    ]})})
    assert "error" in failed and "content" not in failed, failed
    unchanged = invoke(tmp_path, "cad.part.verify", edited["content"], {})
    assert unchanged["result"]["measurements"][0]["volume_mm3"] == pytest.approx(expected(-3), abs=volume_tolerance)


def circle_integral(radius, height, angle):
    """Independent tangent-support area integral, not kernel surface fitting."""
    sine = math.sin(math.radians(angle))
    denominator = .8**2 - sine**2
    step = 2 * math.pi / 4096
    integral_k = integral_q = 0
    for i in range(4096):
        phi = i * step
        q = .6 * math.cos(phi)
        root = math.sqrt(.8**2 + q*q - sine*sine)
        k = (-q * .8 + sine * root) / denominator
        derivative = (-.8 + sine * q / root) * (-.6 * math.sin(phi)) / denominator
        integral_k += k * step
        integral_q += (k*k - derivative*derivative) * step
    return math.pi * radius**2 * height - radius * height**2 / 2 * integral_k + height**3 / 6 * integral_q


@native
def test_agent_authors_edits_and_reopens_drafted_thin_wall(tmp_path):
    authored = run(tmp_path, empty(), [
        {"id": "sketch", "tool": "aether_cad_feature_add", "arguments": {"feature_json": {
            "type": "profile", "name": "Circular wall sketch", "plane": "XY", "offsetMillimeters": 0,
            "profile": {"type": "drawing", "contours": [{"id": "wall", "type": "circle", "center": [0, 0], "radius": 10}]},
        }}},
        {"id": "wall", "tool": "aether_cad_feature_add", "arguments": {"feature_json": {
            "type": "extrude", "name": "Drafted thin wall", "profileFeatureId": {"$ref": "sketch.feature_id"},
            "profileContourId": "wall", "distanceMillimeters": 10, "operation": "new", "draftAngleDegrees": 3,
            "thin": {"thickness1Millimeters": 2, "thickness2Millimeters": 1},
        }}},
    ])
    expected = math.pi * 21 * (30 - 100 * math.tan(math.radians(3)))
    assert volume(authored) == pytest.approx(expected, abs=1e-4)
    feature_id = authored["result"]["references"]["wall"]["feature_id"]
    edited = run(tmp_path, authored["content"], [
        {"id": "resize", "tool": "aether_cad_feature_update", "arguments": {
            "feature_id": feature_id,
            "changes_json": json.dumps({"draftAngleDegrees": 5, "thin": {"thickness1Millimeters": 3, "thickness2Millimeters": 1}}),
        }},
    ])
    expected = math.pi * 22 * (40 - 100 * math.tan(math.radians(5)))
    assert volume(edited) == pytest.approx(expected, abs=1e-4)
    reopened = invoke(tmp_path, "cad.part.verify", edited["content"], {})
    assert reopened["result"]["measurements"][0]["volume_mm3"] == pytest.approx(expected, abs=1e-4)

    invalid = invoke(tmp_path, "cad.part.runprogram", edited["content"], {"program_json": json.dumps({"version": 1, "steps": [
        {"id": "collapse", "tool": "aether_cad_feature_update", "arguments": {"feature_id": feature_id, "changes_json": '{"draftAngleDegrees":80}'}},
    ]})})
    assert "error" in invalid and "content" not in invalid, invalid
    unchanged = invoke(tmp_path, "cad.part.verify", edited["content"], {})
    assert unchanged["result"]["measurements"][0]["volume_mm3"] == pytest.approx(expected, abs=1e-4)


@native
def test_agent_drafted_face_stop_edits_offset_and_reopens(tmp_path):
    authored = run(tmp_path, empty(), [
        {"id": "limitSketch", "tool": "aether_cad_sketch_circle", "arguments": {
            "plane": "XY", "offset_mm": 10, "center_x_mm": 0, "center_y_mm": 0, "radius_mm": 20,
        }},
        {"id": "limit", "tool": "aether_cad_feature_add", "arguments": {"feature_json": {
            "type": "extrude", "name": "Stopping part", "profileFeatureId": {"$ref": "limitSketch.feature_id"},
            "distanceMillimeters": 5, "operation": "new",
        }}},
        {"id": "profile", "tool": "aether_cad_sketch_circle", "arguments": {
            "plane": "XY", "offset_mm": 0, "center_x_mm": 0, "center_y_mm": 0, "radius_mm": 10,
        }},
        {"id": "draft", "tool": "aether_cad_feature_add", "arguments": {"feature_json": {
            "type": "extrude", "name": "Draft to face", "profileFeatureId": {"$ref": "profile.feature_id"},
            "distanceMillimeters": 1, "operation": "new", "draftAngleDegrees": 3, "endType": "up-to-face",
            "endOffsetMillimeters": 1, "endReference": {
                "sourceFeatureId": {"$ref": "limit.feature_id"}, "bodyId": {"$ref": "limit.body_id"},
                "normal": [0, 0, -1], "label": "Lower face",
            },
        }}},
    ])
    slope = math.tan(math.radians(3))

    def expected(height):
        return math.pi * (2000 + 100 * height - 10 * slope * height**2 + slope**2 * height**3 / 3)

    assert sum(body["volume_mm3"] for body in authored["result"]["evaluated_bodies"]) == pytest.approx(expected(9), abs=1e-4)
    feature_id = authored["result"]["references"]["draft"]["feature_id"]
    edited = run(tmp_path, authored["content"], [
        {"id": "offset", "tool": "aether_cad_feature_update", "arguments": {
            "feature_id": feature_id, "changes_json": '{"endOffsetMillimeters":-2}',
        }},
    ])
    assert sum(body["volume_mm3"] for body in edited["result"]["evaluated_bodies"]) == pytest.approx(expected(12), abs=1e-4)
    reopened = invoke(tmp_path, "cad.part.verify", edited["content"], {})
    assert sum(body["volume_mm3"] for body in reopened["result"]["measurements"]) == pytest.approx(expected(12), abs=1e-4)


@native
@pytest.mark.parametrize("end_type", ["up-to-next", "up-to-part"])
def test_agent_draft_reaches_smaller_stop_and_reopens_offset(tmp_path, end_type):
    """The initial profile exceeds the stop; only the actual taper fits it."""
    termination = {"endType": end_type}
    if end_type == "up-to-part":
        termination["endPartId"] = {"$ref": "limit.body_id"}
    authored = run(tmp_path, empty(), [
        {"id": "limitSketch", "tool": "aether_cad_sketch_circle", "arguments": {
            "plane": "XY", "offset_mm": 10, "center_x_mm": 0, "center_y_mm": 0, "radius_mm": 8,
        }},
        {"id": "limit", "tool": "aether_cad_feature_add", "arguments": {"feature_json": {
            "type": "extrude", "name": "Smaller stopping part", "profileFeatureId": {"$ref": "limitSketch.feature_id"},
            "distanceMillimeters": 100, "operation": "new",
        }}},
        {"id": "profile", "tool": "aether_cad_sketch_circle", "arguments": {
            "plane": "XY", "offset_mm": 0, "center_x_mm": 0, "center_y_mm": 0, "radius_mm": 10,
        }},
        {"id": "draft", "tool": "aether_cad_feature_add", "arguments": {"feature_json": {
            "type": "extrude", "name": "Taper to stop", "profileFeatureId": {"$ref": "profile.feature_id"},
            "distanceMillimeters": 1, "operation": "new", "draftAngleDegrees": 15, **termination,
        }}},
    ])
    slope = math.tan(math.radians(15))

    def expected(height):
        return math.pi * (6400 + 100 * height - 10 * slope * height**2 + slope**2 * height**3 / 3)

    assert sum(body["volume_mm3"] for body in authored["result"]["evaluated_bodies"]) == pytest.approx(expected(10), abs=1e-4)
    feature_id = authored["result"]["references"]["draft"]["feature_id"]
    edited = run(tmp_path, authored["content"], [
        {"id": "offset", "tool": "aether_cad_feature_update", "arguments": {
            "feature_id": feature_id, "changes_json": '{"endOffsetMillimeters":1}',
        }},
    ])
    assert sum(body["volume_mm3"] for body in edited["result"]["evaluated_bodies"]) == pytest.approx(expected(9), abs=1e-4)
    reopened = invoke(tmp_path, "cad.part.verify", edited["content"], {})
    assert sum(body["volume_mm3"] for body in reopened["result"]["measurements"]) == pytest.approx(expected(9), abs=1e-4)
