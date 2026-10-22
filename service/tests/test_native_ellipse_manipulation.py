"""Actual pointer-operation fixtures reopened by the isolated native worker."""
import json
import math
from pathlib import Path

import pytest
from test_native_connected_profile import bodies, invoke

FIXTURES = json.loads((Path(__file__).parent / "fixtures/ellipse-manipulation.json").read_text())


@pytest.mark.parametrize("case", FIXTURES, ids=lambda c: c["name"])
def test_edited_exact_ellipse_survives_disk_and_native_rebuild(tmp_path, case):
    path = tmp_path / f"{case['name']}.acpart"
    content = json.dumps(case["document"])
    path.write_text(content)
    first = bodies(invoke(tmp_path, json.loads(path.read_text())))
    assert len(first) == 1
    assert first[0]["volume_mm3"] == pytest.approx(case["piVolume"] * math.pi, rel=1e-8)
    assert bodies(invoke(tmp_path, json.loads(path.read_text()))) == first
    assert path.read_text() == content
    assert not any(c.get("id", "").startswith("drag-") for c in case["document"]["features"][0]["profile"]["constraints"])
    # Volume alone cannot establish position or orientation: the exact body's bounds
    # must be the analytic ellipse's, which fixes centre, radii and rotation.
    expected = {"secondary-longer": (0, 0, 20, 30, 0), "primary-negative": (0, 0, 35, 10, 0),
                "rotated-translated": (17, 29, 20, 10, math.pi/4), "sized-translated": (12, 8, 20, 10, 0)}
    cx, cy, rx, ry, angle = expected[case["name"]]
    half_x = math.hypot(rx*math.cos(angle), ry*math.sin(angle))
    half_y = math.hypot(rx*math.sin(angle), ry*math.cos(angle))
    built = invoke(tmp_path, json.loads(path.read_text()))["result"]
    (x0, y0, z0), (x1, y1, z1) = built["evaluated_bodies"][0]["bbox_mm"]
    assert (x0, x1) == pytest.approx((cx-half_x, cx+half_x), abs=1e-6)
    assert (y0, y1) == pytest.approx((cy-half_y, cy+half_y), abs=1e-6)
    assert (z0, z1) == pytest.approx((0, 6), abs=1e-6)
