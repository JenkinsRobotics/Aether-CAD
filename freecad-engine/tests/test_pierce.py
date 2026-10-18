"""Native B-rep contacts agree with browser geometry and independent coordinates."""

import json
import os
import subprocess
from pathlib import Path

import pytest
from aether_freecad.engine import locate_freecad
from aether_freecad.pierce import _root_direction, _roots

ROOT = Path(__file__).resolve().parents[1]
CASES = json.loads(
    (ROOT.parent / "service/tests/fixtures/pierce-intersections.json").read_text()
)


@pytest.fixture(scope="module")
def native_contacts(tmp_path_factory):
    folder = tmp_path_factory.mktemp("pierce")
    output = folder / "contacts.json"
    script = folder / "check.py"
    implementation = os.environ.get("AETHER_PIERCE_TEST_ARCHIVE", str(ROOT))
    script.write_text(f"""
import sys,json,math
sys.path.insert(0,{implementation!r})
class Input:
 def isatty(self):return True
original=sys.stdin;sys.stdin=Input()
from aether_freecad.worker import _wire_sketch,_circle_sketch
sys.stdin=original
from aether_freecad.pierce import edge_plane_contacts
import FreeCAD as App, Part
from FreeCAD import Vector
cases=json.loads({json.dumps(CASES)!r})
document=App.newDocument('PierceAcceptance')
results={{}}
for case in cases:
 try:
  parameters={{**case['wire'],'frame':case['source']}}
  sketch=(_circle_sketch if case['curve']['type']=='circle' else _wire_sketch)(document,None,parameters)
  document.recompute()
  contacts=edge_plane_contacts(sketch.Shape.Edges[0],case['target'])
  results[case['name']]={{'contacts':contacts,'valid':sketch.Shape.isValid()}}
 except Exception as error:results[case['name']]={{'error':str(error)}}
# A truly spatial cubic and a native helix are not planar browser projections.
frame={{'originMillimeters':[0,0,0],'xDirection':[1,0,0],'normal':[0,0,1]}}
c=Part.BSplineCurve();c.buildFromPolesMultsKnots([Vector(0,0,-8),Vector(10/3,3,14),Vector(20/3,-3,-14),Vector(10,0,8)],[4,4],[0.,1.],False,3)
reverse=c.copy();reverse.reverse()
corner=Part.BSplineCurve();corner.buildFromPolesMultsKnots([Vector(0,0,1),Vector(1,0,0),Vector(2,0,1)],[2,1,2],[0.,1.,2.],False,1)
coplanar=Part.BSplineCurve();coplanar.buildFromPolesMultsKnots([Vector(0,0,0),Vector(1,0,0),Vector(2,0,1)],[2,1,2],[0.,1.,2.],False,1)
extras={{'spatial-cubic':c.toShape(), 'trimmed-cubic':c.toShape(.3,.7), 'reversed-cubic':reverse.toShape(), 'corner-tangent':corner.toShape(), 'coplanar-span':coplanar.toShape(), 'helix':Part.makeHelix(10,30,5).Edges[0]}}
for name,edge in extras.items():
 try:
  target={{**frame,'originMillimeters':[0,0,15]}} if name=='helix' else frame
  results[name]={{'contacts':edge_plane_contacts(edge,target)}}
 except Exception as error:results[name]={{'error':str(error)}}
# A circular boundary selected from an actual solid uses the same exact path.
cylinder=Part.makeCylinder(5,10)
edge=next(e for e in cylinder.Edges if isinstance(e.Curve,Part.Circle) and abs(e.CenterOfMass.z)<1e-7)
results['solid-circle']={{'contacts':edge_plane_contacts(edge,{{'originMillimeters':[0,0,0],'xDirection':[1,0,0],'normal':[0,-1,0]}})}}
for name,bad in [('bad-normal',{{**frame,'normal':[0,0,2]}}),('nan-origin',{{**frame,'originMillimeters':[float('nan'),0,0]}})]:
 try:edge_plane_contacts(edge,bad);results[name]={{'error':None}}
 except Exception as error:results[name]={{'error':str(error)}}
App.closeDocument(document.Name)
from pathlib import Path
Path({str(output)!r}).write_text(json.dumps(results))
print('PIERCE_NATIVE_COMPLETE')
""")
    result = subprocess.run(
        [locate_freecad(), str(script)],
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    assert "PIERCE_NATIVE_COMPLETE" in result.stdout, result.stdout + result.stderr
    return json.loads(output.read_text())


@pytest.mark.parametrize("case", CASES, ids=lambda c: c["name"])
def test_native_finite_contact_matches_browser_and_independent_coordinates(
    native_contacts, case
):
    result = native_contacts[case["name"]]
    if case.get("error"):
        assert "lies in" in result.get("error", ""), result
        return
    assert "error" not in result, result
    assert result["valid"]
    contacts = result["contacts"]
    assert len(contacts) == len(case["expected"]), result
    # Native arc ordering may differ from authored traversal; match geometric
    # contacts rather than inferring a source identity from an EdgeN ordering.
    for expected, browser in zip(case["expected"], case["hits"], strict=True):
        closest = min(
            contacts,
            key=lambda c: sum(
                (a - b) ** 2 for a, b in zip(c["worldPoint"], expected, strict=True)
            ),
        )
        assert closest["worldPoint"] == pytest.approx(expected, abs=1e-7)
        assert closest["point"] == pytest.approx(browser["point"], abs=1e-7)
        assert closest["direction"] == browser["direction"]
        assert 0 <= closest["parameter"] <= 1


def test_spatial_cubic_has_three_exact_contacts(native_contacts):
    result = native_contacts["spatial-cubic"]
    assert "error" not in result, result
    contacts = result["contacts"]
    assert [c["parameter"] for c in contacts] == pytest.approx(
        [0.2, 0.5, 0.8], abs=1e-8
    )
    assert [c["worldPoint"][0] for c in contacts] == pytest.approx([2, 5, 8], abs=1e-7)
    assert [c["worldPoint"][2] for c in contacts] == pytest.approx([0, 0, 0], abs=1e-7)
    assert [c["direction"] for c in contacts] == [1, -1, 1]


def test_native_helix_is_trimmed_and_pierces_the_plane(native_contacts):
    result = native_contacts["helix"]
    assert "error" not in result, result
    assert len(result["contacts"]) == 1
    contact = result["contacts"][0]
    assert contact["worldPoint"] == pytest.approx([-5, 0, 15], abs=1e-7)
    assert contact["direction"] == 1


def test_native_solid_edge_contacts(native_contacts):
    contacts = native_contacts["solid-circle"]["contacts"]
    assert len(contacts) == 2
    assert sorted(c["worldPoint"][0] for c in contacts) == pytest.approx(
        [-5, 5], abs=1e-7
    )


@pytest.mark.parametrize("name", ["bad-normal", "nan-origin"])
def test_native_invalid_frame_is_rejected(native_contacts, name):
    assert native_contacts[name]["error"]


@pytest.mark.parametrize("degree", [2, 3, 4, 7, 8, 14])
def test_repeated_rational_numerator_roots_remain_single(degree):
    coefficients = [(-1) ** (degree - i) for i in range(degree + 1)]
    assert _roots(coefficients) == [0.5]
    assert _root_direction(coefficients, 0.5)[0] == (1 if degree % 2 else 0)


@pytest.mark.parametrize("scale", [1e-20, 1, 1e20])
def test_numerator_roots_are_weight_scale_invariant(scale):
    assert _roots([scale * v for v in [-8, 14, -14, 8]]) == pytest.approx(
        [0.2, 0.5, 0.8], abs=1e-10
    )


def test_coplanar_span_is_rejected_without_inventing_a_contact():
    with pytest.raises(ValueError, match="span in the sketch plane"):
        _roots([0, 0, 0, 0])


def test_native_trimmed_cubic_excludes_other_contacts(native_contacts):
    result = native_contacts["trimmed-cubic"]
    assert "error" not in result, result
    assert len(result["contacts"]) == 1
    assert result["contacts"][0]["parameter"] == pytest.approx(0.5, abs=1e-9)
    assert result["contacts"][0]["worldPoint"] == pytest.approx([5, 0, 0], abs=1e-7)


def test_native_reversed_cubic_retains_parameter_direction(native_contacts):
    result = native_contacts["reversed-cubic"]
    assert "error" not in result, result
    assert [c["worldPoint"][0] for c in result["contacts"]] == pytest.approx(
        [8, 5, 2], abs=1e-7
    )
    assert [c["direction"] for c in result["contacts"]] == [-1, 1, -1]


def test_native_contact_at_c0_knot_is_a_single_tangency(native_contacts):
    result = native_contacts["corner-tangent"]
    assert "error" not in result, result
    assert len(result["contacts"]) == 1
    assert result["contacts"][0]["worldPoint"] == pytest.approx([1, 0, 0], abs=1e-7)
    assert result["contacts"][0]["direction"] == 0


def test_native_partially_coplanar_edge_is_ambiguous(native_contacts):
    assert "span in the sketch plane" in native_contacts["coplanar-span"].get(
        "error", ""
    )
