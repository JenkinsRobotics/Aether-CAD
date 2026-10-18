"""Exercise native tessellation on closed curved/concave/imported B-Reps.

The signed mesh volume catches missing caps and reversed triangles; normal
agreement catches shading defects that volume-only feature tests cannot see.
"""

import json
import math
import subprocess
from pathlib import Path

import pytest
from aether_freecad import FreeCADEngine


def test_complex_brep_render_integrity_and_step_roundtrip(tmp_path):
    package = Path(__file__).resolve().parents[1]
    report = tmp_path / "report.json"
    analysis = tmp_path / "analysis.json"
    script = tmp_path / "corpus.py"
    script.write_text(
        f"import sys\nsys.path.insert(0, {str(package)!r})\n"
        "import Part, FreeCAD as App, json\n"
        "from aether_freecad.worker import _geometry\n"
        "from aether_freecad.vertex_reference import vertex_anchors,resolve_vertex\n"
        "V=App.Vector\n"
        "box=Part.makeBox(40,30,20)\n"
        "drilled=box\n"
        "for x in (5,15,25,35):\n"
        " for y in (5,15,25):\n"
        "  drilled=drilled.cut(Part.makeCylinder(2,20,V(x,y,0)))\n"
        "curves=[]\n"
        "for poles in [[[0,0,0],[10/3,10,0],[20/3,15,0],[10,15,0]],[[10,15,0],[40/3,15,0],[50/3,10,0],[20,0,0]]]:\n"
        " c=Part.BSplineCurve();c.buildFromPolesMultsKnots([V(*p) for p in poles],[4,4],[0,1],False,3);curves.append(c.toShape())\n"
        "spine=Part.Wire(curves);section=Part.Wire([Part.makeCircle(0.5,V(0,0,0),V(1,3,0))])\n"
        "pipe=spine.makePipeShell([section],True,False)\n"
        "shapes={\n"
        " 'box':box, 'cylinder':Part.makeCylinder(10,20),\n"
        " 'sphere':Part.makeSphere(10), 'torus':Part.makeTorus(15,4),\n"
        " 'drilled_plate':drilled,\n"
        " 'closed_cavity':box.cut(Part.makeBox(36,26,16,V(2,2,2))),\n"
        " 'concave':box.cut(Part.makeBox(25,20,20,V(15,10,0))),\n"
        " 'compound':Part.makeCompound([box,Part.makeSphere(5,V(60,0,0))]),\n"
        " 'clamped_spline_pipe':pipe,\n"
        "}\n"
        "result={}\n"
        "for name,shape in shapes.items():\n"
        f" path={str(tmp_path)!r}+'/'+name+'.step'\n"
        " shape.exportStep(path)\n"
        " imported=Part.Shape();imported.read(path)\n"
        " for suffix,s in [('created',shape),('imported',imported)]:\n"
        "  g=_geometry(s,0.05)\n"
        "  for anchor in vertex_anchors(s).values():\n"
        "   assert (resolve_vertex(s,anchor)-V(*anchor['positionMillimeters'])).Length<1e-6\n"
        "  result[name+'_'+suffix]={'valid':s.isValid(),'solids':len(s.Solids),'geometry':g}\n"
        f"open({str(report)!r},'w').write(json.dumps(result))\n"
        "half=Part.makeBox(20,30,20,V(20,0,0))\n"
        "inside=Part.makeBox(2,2,2,V(5,5,5))\n"
        "analysis=[box.common(half).Volume,shapes['closed_cavity'].common(half).Volume,"
        "box.common(inside).Volume,shapes['closed_cavity'].common(inside).Volume,"
        "box.common(Part.makeBox(2,2,2,V(40,0,0))).Volume]\n"
        f"open({str(analysis)!r},'w').write(json.dumps(analysis))\n"
    )
    engine = FreeCADEngine()
    process = subprocess.run(
        [engine.command, str(script)],
        input="",
        text=True,
        capture_output=True,
        timeout=60,
        check=True,
    )
    assert report.exists(), process.stdout + process.stderr
    results = json.loads(report.read_text())
    # Native volumetric semantics: a contained solid intersects a filled body
    # even without crossing its surfaces; the same solid inside a cavity does
    # not. These are kernel checks, not a claim of shipped analysis commands.
    assert json.loads(analysis.read_text()) == pytest.approx([12000, 4512, 8, 0, 0])
    assert len(results) == 18
    for name, result in results.items():
        assert result["valid"] and result["solids"] > 0, name
        g = result["geometry"]
        vertices = list(zip(*[iter(g["vertices"])] * 3))
        normals = list(zip(*[iter(g["normals"])] * 3))
        triangles = list(zip(*[iter(g["triangles"])] * 3))
        assert len(vertices) == len(normals) and triangles, name
        if name.startswith("clamped_spline_pipe"):
            # The previous implicit angular settings produced >23k vertices
            # and exceeded the packaged worker deadline doing UV inversion.
            assert len(vertices) < 6000, name
            length = 10*(math.sqrt(10)+math.asinh(3)/3)
            assert g["volume_mm3"] == pytest.approx(math.pi*0.25*length, rel=2e-5)
            assert all(abs(sum(v*v for v in n)-1) < 1e-6 for n in normals), name
        assert len(g["face_ranges"]) == g["face_count"], name
        cursor = 0
        for face in g["face_ranges"]:
            assert face["start"] == cursor and face["count"] > 0, name
            cursor += face["count"]
        assert cursor == len(triangles), name
        volume = 0
        for ids in triangles:
            a, b, c = [vertices[i] for i in ids]
            ab = [b[i] - a[i] for i in range(3)]
            ac = [c[i] - a[i] for i in range(3)]
            cross = (
                ab[1] * ac[2] - ab[2] * ac[1],
                ab[2] * ac[0] - ab[0] * ac[2],
                ab[0] * ac[1] - ab[1] * ac[0],
            )
            volume += sum(a[i] * cross[i] for i in range(3)) / 6
            normal = [sum(normals[j][i] for j in ids) for i in range(3)]
            assert sum(cross[i] * normal[i] for i in range(3)) >= -1e-8, name
        assert volume == pytest.approx(g["volume_mm3"], rel=0.02), name
        if name.endswith("_imported"):
            original = results[name.replace("_imported", "_created")]["geometry"]
            # STEP conversion of the spline pipe's offset surfaces changes
            # native volume integration by ~2.3e-8 relative. Analytic volume,
            # winding and mesh-error checks above independently constrain it.
            precision = 1e-7 if name.startswith("clamped_spline_pipe") else 1e-8
            assert g["volume_mm3"] == pytest.approx(original["volume_mm3"], rel=precision), (
                name
            )
