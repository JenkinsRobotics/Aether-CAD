"""Native polynomial surfaces have independent analytic/integrated volumes."""
import json
import math
import subprocess
from pathlib import Path

import pytest
from aether_freecad import locate_freecad
from test_extrusion_part_limit import integral


@pytest.fixture(scope='module')
def surfaces(tmp_path_factory):
    folder = tmp_path_factory.mktemp('curved-surfaces')
    report = folder/'results.json'
    script = folder/'surfaces.py'
    script.write_text(f'''
import sys,json
sys.path.insert(0,{str(Path(__file__).resolve().parents[1])!r})
import Part,FreeCAD as App
from aether_freecad.extrusion_surface_limit import to_surface
from aether_freecad.surface_reference import surface_type
V=App.Vector
document=App.newDocument('CurvedStop')
profile=Part.Face(Part.makePolygon([V(-2,-2,0),V(2,-2,0),V(2,2,0),V(-2,2,0),V(-2,-2,0)]))
# Exact z = 10 + x*x/10, with full domain x[-10,10], y[-50,50].
b=Part.BezierSurface();b.increase(2,1)
for i,(x,z) in enumerate([(-10,20),(0,0),(10,20)],1):
 for j,y in enumerate([-50,50],1):b.setPole(i,j,V(x,y,z))
curve=Part.BezierCurve();curve.setPoles([V(0,0,10),V(5,0,10),V(10,0,20)])
revolution=Part.SurfaceOfRevolution(curve,V(0,0,0),V(0,0,1))
result={{}}
for kind,s in [('bezier',b),('bspline',b.toBSpline()),('revolution',revolution)]:
 # The selected trimmed face does not cover the extrusion. Its native surface does.
 face=s.toShape(.1,.2,.7,.8) if kind!='revolution' else s.toShape(0,.3,.2,.4)
 assert surface_type(face)==kind
 for angle,offset in ([(0,0),(0,2),(3,0),(-3,2)] if kind!='revolution' else [(0,0),(0,2)]):
  shape=to_surface(document,profile,V(0,0,1),0,angle,face,offset)
  result[f'{{kind}}:{{angle}}:{{offset}}']={{'valid':shape.isValid(),'solids':len(shape.Solids),'volume':shape.Volume}}
open({str(report)!r},'w').write(json.dumps(result))
App.closeDocument(document.Name)
''')
    process = subprocess.run([locate_freecad(),str(script)],input='',text=True,capture_output=True,timeout=60,check=True)
    assert report.exists(),process.stdout+process.stderr
    return json.loads(report.read_text())


@pytest.mark.parametrize('kind,angle,offset',[
    (kind,angle,offset) for kind in ['bezier','bspline'] for angle,offset in [(0,0),(0,2),(3,0),(-3,2)]
] + [('revolution',0,0),('revolution',0,2)])
def test_untrimmed_polynomial_surface_with_draft_and_offsets(surfaces,kind,angle,offset):
    result=surfaces[f'{kind}:{angle}:{offset}']
    h=10-offset
    if kind=='revolution':
        expected=16*h+64/15
    elif angle==0:
        expected=16*h+32/15
    else:
        k=math.tan(math.radians(angle))
        # Width of the square is 2*(2-k*z); beyond h, only its outer x strips
        # remain beneath the parabolic stop. Integrate the remaining material.
        high=2*(4+10*h)/(4*k+10+math.sqrt((4*k+10)**2-4*k*k*(4+10*h)))
        expected=4*(4*h-2*k*h*h+k*k*h*h*h/3)+integral(
            lambda z:4*(2-k*z)*max(0,2-k*z-math.sqrt(max(0,10*(z-h)))),h,high)
    assert result['valid'] and result['solids']==1
    assert result['volume']==pytest.approx(expected,abs=1e-5)
