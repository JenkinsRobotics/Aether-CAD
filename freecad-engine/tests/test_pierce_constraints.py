"""Actual native Sketcher target equations, isolation and finite-contact checks."""

import json
import os
import subprocess
from pathlib import Path

import pytest
from aether_freecad.engine import locate_freecad

CASES = json.loads(
    (Path(__file__).resolve().parents[2] / "service/tests/fixtures/pierce-targets.json").read_text()
)

@pytest.fixture(scope="module")
def native(tmp_path_factory):
    folder = tmp_path_factory.mktemp("pierce-solve")
    implementation = os.environ.get(
        "AETHER_PIERCE_TEST_ARCHIVE", str(Path(__file__).resolve().parents[1])
    )
    output, script = folder / "results.json", folder / "solve.py"
    code = r'''
import sys,json,math
sys.path.insert(0,IMPLEMENTATION)
import FreeCAD as App,Part,Sketcher
from FreeCAD import Vector as V
from aether_freecad.pierce_constraints import solve_pierce_sketch
results={}
frame={'originMillimeters':[0,0,0],'xDirection':[1,0,0],'normal':[0,0,1]}
source=Part.makeLine(V(10,1,-10),V(10,1,10))
def item(index=0,position=None,point=(10,1,0),edge=None):
 return {'geometry':index,'world_point':list(point),'source_edge':edge or source,**({'position':position} if position is not None else {})}
def geometry(kind):
 if kind in ['point','line']:return Part.LineSegment(V(0,0,0),V(20,2,0))
 if kind in ['circle','circle-center']:return Part.Circle(V(0,0,0),V(0,0,1),7)
 if kind=='arc':return Part.Arc(V(0,0,0),V(5,5,0),V(10,0,0))
 if kind=='ellipse':return Part.Ellipse(V(0,0,0),8,4)
 if kind=='ellipse-arc':return Part.ArcOfEllipse(Part.Ellipse(V(0,0,0),8,4),0,math.pi)
 if kind=='bspline':
  g=Part.BezierCurve();g.setPoles([V(0,0,0),V(3,8,0),V(7,8,0),V(10,0,0)]);return g.toBSpline()
 g=Part.BezierCurve();g.setPoles([V(0,0,0),V(5,8,0),V(10,0,0)]);g.setWeight(2,.8);return g.toBSpline()

keep=App.newDocument('UserDocument');keep.addObject('Part::Feature','Source').Shape=source
for kind in ['point','circle-center','line','circle','arc','ellipse','ellipse-arc','bspline','conic']:
 try:
  g=geometry(kind);before=g.toShape().exportBrepToString()
  position=1 if kind=='point' else 3 if kind=='circle-center' else None
  result=solve_pierce_sketch([g],[],frame,[item(position=position)])
  solved=result[0]
  error=(solved.StartPoint-V(10,1,0)).Length if kind=='point' else (solved.Center-V(10,1,0)).Length if kind=='circle-center' else solved.toShape().distToShape(Part.Vertex(V(10,1,0)))[0]
  results[kind]={'error':error,'count':len(result),'unchanged':before==g.toShape().exportBrepToString(),'isolated':list(App.listDocuments())==[keep.Name] and App.activeDocument().Name==keep.Name}
 except Exception as error:results[kind]={'exception':str(error)}

line=Part.LineSegment(V(0,0,0),V(6,0,0))
dimensions=[Sketcher.Constraint('Horizontal',0),Sketcher.Constraint('Distance',0,6.)]
try:
 first=solve_pierce_sketch([line],dimensions,frame,[item(position=1)])[0]
 changed=Part.makeLine(V(20,3,-10),V(20,3,10))
 second=solve_pierce_sketch([first],dimensions,frame,[item(position=1,point=(20,3,0),edge=changed)])[0]
 results['dimensions-follow']={'first':[list(first.StartPoint),list(first.EndPoint)],'second':[list(second.StartPoint),list(second.EndPoint)],'length':second.length()}
except Exception as error:results['dimensions-follow']={'exception':str(error)}

failures={
 'fixed-conflict':([line],[Sketcher.Constraint('Block',0)],[item(position=1)]),
 'finite-extension':([line],[Sketcher.Constraint('Block',0)],[item(point=(10,0,0),edge=Part.makeLine(V(10,0,-1),V(10,0,1)))]),
 'wrong-point':([line],[],[item(point=(9,1,0))]),
 'missing-target':([line],[],[item(index=1)]),
 'invalid-position':([line],[],[item(position=3)]),
 'circle-endpoint':([geometry('circle')],[],[item(position=1)]),
 'nan-contact':([line],[],[item(point=(float('nan'),1,0))]),
 'coplanar-source':([line],[],[item(edge=Part.makeLine(V(0,0,0),V(20,0,0)))]),
 'empty-targets':([line],[],[]),
 'fixed-endpoint-along-same-line':([line],[Sketcher.Constraint('Block',0)],[item(position=1,point=(2,0,0),edge=Part.makeLine(V(2,0,-1),V(2,0,1)))]),
 'conflicting-source-points':([line],[],[item(position=1),item(position=1,point=(20,3,0),edge=Part.makeLine(V(20,3,-1),V(20,3,1)))]),
}
for name,(curves,constraints,targets) in failures.items():
 before=[g.toShape().exportBrepToString() for g in curves]
 try:solve_pierce_sketch(curves,constraints,frame,targets);results[name]={'exception':None}
 except Exception as error:results[name]={'exception':str(error)}
 results[name]['unchanged']=before==[g.toShape().exportBrepToString() for g in curves]
 results[name]['isolated']=list(App.listDocuments())==[keep.Name] and App.activeDocument().Name==keep.Name

try:
 edge=Part.makeLine(V(3,0,-1),V(3,0,1))
 result=solve_pierce_sketch([line],[Sketcher.Constraint('Block',0)],frame,[item(point=(3,0,0),edge=edge)])[0]
 results['satisfied-fixed']={'same':line.isSame(result,1e-7,1e-9),'start':list(result.StartPoint),'end':list(result.EndPoint)}
except Exception as error:results['satisfied-fixed']={'exception':str(error)}

try:
 oblique={'originMillimeters':[4,3,2],'xDirection':[0,1,0],'normal':[2**-.5,0,2**-.5]}
 # local(10,1) = origin +10*x +1*(normal cross x)
 p=V(4-2**-.5,13,2+2**-.5);n=V(2**-.5,0,2**-.5)
 e=Part.makeLine(p-n*10,p+n*10)
 result=solve_pierce_sketch([line],[],oblique,[item(position=1,point=tuple(p),edge=e)])[0]
 results['oblique']={'start':list(result.StartPoint)}
except Exception as error:results['oblique']={'exception':str(error)}
# Cross-runtime fixtures came from actual browser authoring/constraint solving.
# The exact native wire mapping must accept those finite contact positions.
class Input:
 def isatty(self):return True
original=sys.stdin;sys.stdin=Input()
from aether_freecad.worker import _wire_sketch,_circle_sketch
sys.stdin=original
for case in CASES_JSON:
 try:
  w=case['wire'];parameters={**w,'frame':case['targetFrame']}
  sketch=(_circle_sketch if w['kind']=='circle' else _wire_sketch)(keep,None,parameters)
  curves=sketch.Geometry
  e=Part.makeLine(V(0,-5,0),V(20,5,0))
  solved=solve_pierce_sketch(curves,[],case['targetFrame'],[item(position=case.get('position'),point=case['expectedWorld'],edge=e)])
  results['browser-'+case['name']]={'matches':all(a.isSame(b,1e-7,1e-9) for a,b in zip(curves,solved,strict=True)),'count':len(solved)}
  keep.removeObject(sketch.Name)
 except Exception as error:results['browser-'+case['name']]={'exception':str(error)}
App.closeDocument(keep.Name)
from pathlib import Path
Path(OUTPUT).write_text(json.dumps(results))
print('PIERCE_SOLVE_COMPLETE')
'''
    script.write_text(
        code.replace("IMPLEMENTATION", repr(implementation)).replace(
            "OUTPUT", repr(str(output))
        ).replace("CASES_JSON", repr(CASES))
    )
    result = subprocess.run(
        [locate_freecad(), str(script)],
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    assert "PIERCE_SOLVE_COMPLETE" in result.stdout, result.stdout + result.stderr
    return json.loads(output.read_text())


@pytest.mark.parametrize(
    "kind",
    ["point", "circle-center", "line", "circle", "arc", "ellipse", "ellipse-arc", "bspline", "conic"],
)
def test_actual_native_point_or_curve_contact(native, kind):
    result = native[kind]
    assert "exception" not in result, result
    assert result["error"] < 1e-7
    assert result["count"] == 1
    assert result["unchanged"] and result["isolated"]


def test_native_source_edit_preserves_existing_dimensions(native):
    result = native["dimensions-follow"]
    assert "exception" not in result, result
    assert result["first"][0] == pytest.approx([10, 1, 0], abs=1e-7)
    assert result["second"][0] == pytest.approx([20, 3, 0], abs=1e-7)
    assert result["second"][1] == pytest.approx([26, 3, 0], abs=1e-7)
    assert result["length"] == pytest.approx(6, abs=1e-7)


@pytest.mark.parametrize(
    "name",
    ["fixed-conflict", "finite-extension", "wrong-point", "missing-target", "invalid-position", "circle-endpoint", "nan-contact", "coplanar-source", "empty-targets", "fixed-endpoint-along-same-line", "conflicting-source-points"],
)
def test_native_rejection_never_changes_existing_geometry_or_documents(native, name):
    result = native[name]
    assert result["exception"], result
    assert result["unchanged"] and result["isolated"]


def test_native_oblique_plane_uses_local_sketch_coordinates(native):
    result = native["oblique"]
    assert "exception" not in result, result
    assert result["start"] == pytest.approx([10, 1, 0], abs=1e-7)


def test_native_satisfied_fixed_curve_retains_its_endpoints(native):
    result = native["satisfied-fixed"]
    assert "exception" not in result, result
    assert result["same"]
    assert result["start"] == pytest.approx([0, 0, 0], abs=1e-7)
    assert result["end"] == pytest.approx([6, 0, 0], abs=1e-7)


@pytest.mark.parametrize("case", CASES, ids=lambda c: c["name"])
def test_native_preserves_browser_authored_target_contact(native, case):
    result = native["browser-" + case["name"]]
    assert "exception" not in result, result
    assert result["matches"]
    assert result["count"] == 1
