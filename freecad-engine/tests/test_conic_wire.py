"""Independent analytic native conic/solid/round-trip acceptance."""

import json
import math
import subprocess
from pathlib import Path

import pytest
from aether_freecad import BuildJob, Feature, FreeCADEngine
from aether_freecad.conic_wire import conic_wire_segment
from aether_freecad.engine import locate_freecad

CASES = [
    {
        "name": "ellipse",
        "start": [10, 0],
        "control": [10, 10],
        "end": [0, 10],
        "rho": math.sqrt(0.5) / (1 + math.sqrt(0.5)),
        "area": 100 * (math.pi / 4 - 0.5),
    },
    {
        "name": "parabola",
        "start": [0, 0],
        "control": [10, 20],
        "end": [20, 0],
        "rho": 0.5,
        "area": 400 / 3,
    },
    {
        "name": "hyperbola",
        "start": [10, 0],
        "control": [10, 10 / math.sqrt(3)],
        "end": [20, 10 * math.sqrt(3)],
        "rho": math.sqrt(1.5) / (1 + math.sqrt(1.5)),
        "area": 100 * (math.sqrt(3) - math.acosh(2)) / 2,
    },
]


def conic_feature(case, **placement):
    return Feature(
        "profile",
        "sketch-wire",
        dict(
            start_mm=case["start"],
            blocked_geometry=[0, 1],
            segments=[
                {
                    "type": "conic",
                    "end": case["end"],
                    "control": case["control"],
                    "rho": case["rho"],
                },
                {"type": "line", "end": case["start"]},
            ],
            **placement,
        ),
    )


@pytest.mark.parametrize("case", CASES, ids=lambda c: c["name"])
@pytest.mark.parametrize("plane,axis", [("XY", 2), ("XZ", 1), ("YZ", 0)])
def test_native_exact_conic_pad_volume_and_plane(case, plane, axis):
    with FreeCADEngine() as engine:
        assert "sketch-conic" in engine.describe()["capabilities"]
        result = engine.build(
            BuildJob(
                features=[
                    conic_feature(case, plane=plane, offset_mm=7),
                    Feature(
                        "pad",
                        "pad",
                        {
                            "profile": "profile",
                            "operation": "new",
                            "body_id": "conic",
                            "distance_mm": 6,
                        },
                    ),
                ]
            )
        )
    assert not result.diagnostics, result.diagnostics
    assert result.bodies[0].volume_mm3 == pytest.approx(case["area"] * 6, rel=1e-8)
    assert max(result.bodies[0].vertices[axis::3]) - min(
        result.bodies[0].vertices[axis::3]
    ) == pytest.approx(6)


def test_native_conic_quadratic_weights_block_equations_and_fcstd_step_roundtrip(
    tmp_path,
):
    script = tmp_path / "conic_proof.py"
    root = Path(__file__).resolve().parents[1]
    fixtures = json.loads(
        (root.parent / "service/tests/fixtures/conic-geometry.json").read_text()
    )
    script.write_text(f"""
import sys, json, math
sys.path.insert(0, {str(root)!r})
class Input:
 def isatty(self): return True
original=sys.stdin;sys.stdin=Input()
from aether_freecad.worker import _wire_sketch
sys.stdin=original
import FreeCAD, Part
cases=json.loads({json.dumps(fixtures)!r})
d=FreeCAD.newDocument('ConicAcceptance')
def check(s,case):
 assert s.FullyConstrained and s.solve()==0, (case['name'],s.SolverMessages)
 curve=s.Geometry[0]
 assert curve.Degree==2 and len(curve.getPoles())==3
 assert curve.getMultiplicities()==[3,3] and curve.getKnots()==[0.,1.]
 rho=case['segment']['rho']
 expected=rho/(1-rho)
 assert abs(curve.getWeights()[1]-expected)<1e-12
 assert curve.isRational()==(rho!=.5)
 for j in range(101):
  p=curve.value(j/100)
  if case['kind']=='ellipse': error=p.x*p.x+p.y*p.y-100
  elif case['kind']=='parabola': error=p.y-(2*p.x-p.x*p.x/10)
  else: error=p.x*p.x-p.y*p.y-100
  assert abs(error)<1e-7, (case['name'],j,p,error)
 for j,expected in enumerate(case['points']):
  assert (curve.value(j/16)-FreeCAD.Vector(*expected,0)).Length<1e-8
for i,case in enumerate(cases):
 b=d.addObject('PartDesign::Body','Body'+str(i))
 s=_wire_sketch(d,b,dict(start_mm=case['start'],segments=[case['segment'],dict(type='line',end=case['start'])],blocked_geometry=[0,1]))
 d.recompute();check(s,case)
 # Exact face/solid and STEP export readback; no mesh participates.
 shape=Part.Face(s.Shape.Wires[0]).extrude(FreeCAD.Vector(0,0,6))
 assert shape.isValid() and len(shape.Solids)==1
 assert abs(shape.Volume-case['area']*6)<1e-6
 filename={str(tmp_path)!r}+'/'+case['name']+'.step'
 shape.exportStep(filename)
 restored=Part.read(filename)
 assert restored.isValid() and len(restored.Solids)==1
 assert abs(restored.Volume-case['area']*6)<1e-5
 s.Label=case['name']
path={str(tmp_path / "conics.FCStd")!r}
d.recompute();d.saveAs(path);FreeCAD.closeDocument(d.Name)
d=FreeCAD.openDocument(path);d.recompute()
for case in cases:
 s=next(o for o in d.Objects if o.TypeId=='Sketcher::SketchObject' and o.Label==case['name'])
 check(s,case)
 s.delConstraint(0);s.solve();assert not s.FullyConstrained
FreeCAD.closeDocument(d.Name)
print('CONIC_NATIVE_PROOF 15')
""")
    result = subprocess.run(
        [locate_freecad(), str(script)],
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    assert "CONIC_NATIVE_PROOF 15" in result.stdout, result.stdout + result.stderr


@pytest.mark.parametrize(
    "rho", [0, 1, -0.2, 1.2, float("nan"), float("inf"), True, "0.5", None]
)
def test_native_conic_rejects_invalid_rho_before_calling_kernel(rho):
    with pytest.raises(ValueError, match="rho"):
        conic_wire_segment([0, 0], [20, 0], [10, 20], rho, None, None)


@pytest.mark.parametrize(
    "start,end,control",
    [
        ([0, 0], [0, 0], [10, 20]),
        ([0, 0], [20, 0], [10, 0]),
        ([0, 0], [20, 0], [0, 0]),
        ([0, 0], [20, 0], [20, 0]),
        ([0, 0], [20, 0], None),
        ([0], [20, 0], [10, 20]),
        ([True, 0], [20, 0], [10, 20]),
        ([0, 0], ["20", 0], [10, 20]),
        ([0, 0], [20, float("inf")], [10, 20]),
    ],
)
def test_native_conic_rejects_degenerate_and_malformed_points(start, end, control):
    with pytest.raises(ValueError):
        conic_wire_segment(start, end, control, 0.5, None, None)


def test_native_invalid_conic_returns_diagnostic_without_partial_solid():
    case = dict(CASES[1], rho=1)
    with FreeCADEngine() as engine:
        result = engine.build(
            BuildJob(
                features=[
                    conic_feature(case),
                    Feature(
                        "pad",
                        "pad",
                        {
                            "profile": "profile",
                            "operation": "new",
                            "body_id": "conic",
                            "distance_mm": 6,
                        },
                    ),
                ]
            )
        )
    assert result.diagnostics and "rho" in result.diagnostics[0]["message"].lower()
    assert not result.bodies
