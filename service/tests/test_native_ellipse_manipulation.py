"""Actual pointer-operation fixtures reopened by the isolated native worker."""
import json
import math
from pathlib import Path

import pytest
from test_native_connected_profile import bodies, invoke
from test_native_connected_regions import invoke as geometry

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
    # Volume alone cannot establish position or orientation. Every tessellated
    # native edge point must lie on the independently expected analytic ellipse.
    expected = {"secondary-longer": (0, 0, 20, 30, 0), "primary-negative": (0, 0, 35, 10, 0),
                "rotated-translated": (17, 29, 20, 10, math.pi/4), "sized-translated": (12, 8, 20, 10, 0)}
    cx, cy, rx, ry, angle = expected[case["name"]]
    rendered = geometry(tmp_path, "geometry", {"features": case["features"]})
    assert not rendered["diagnostics"], rendered
    edges = rendered["bodies"][0]["edge_lines"]
    assert len(edges) > 30
    for x, y, _z in zip(edges[::3], edges[1::3], edges[2::3], strict=True):
        u = (x-cx)*math.cos(angle)+(y-cy)*math.sin(angle)
        v = -(x-cx)*math.sin(angle)+(y-cy)*math.cos(angle)
        assert (u/rx)**2+(v/ry)**2 == pytest.approx(1, abs=1e-7)
    assert min(edges[2::3]) == pytest.approx(0)
    assert max(edges[2::3]) == pytest.approx(6)
