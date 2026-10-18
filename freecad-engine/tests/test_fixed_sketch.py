"""Qualify actual FreeCAD Block constraints, not only their rendered shapes."""

import json
import subprocess
from pathlib import Path

import pytest
from aether_freecad import BuildJob, Feature, FreeCADEngine
from aether_freecad.engine import locate_freecad
from aether_freecad.fixed_sketch import apply_fixed_geometry


def test_native_worker_advertises_fixed_geometry_and_exact_ellipses():
    with FreeCADEngine() as engine:
        assert {"sketch-fixed-geometry", "sketch-ellipse"} <= set(
            engine.describe()["capabilities"]
        )


@pytest.mark.parametrize("indices", [[-1], [1], [True], [0.0], [0, 0], "0", None])
def test_bad_native_indices_are_rejected_before_mutation(indices):
    class Sketch:
        GeometryCount = 1

        def addConstraint(self, value):
            pytest.fail("Invalid input mutated the sketch")

    with pytest.raises(ValueError, match="blocked_geometry"):
        apply_fixed_geometry(
            Sketch(), {"blocked_geometry": indices}, lambda *args: args
        )


def test_native_blocks_cover_line_arc_circle_and_spline_and_release_dof(tmp_path):
    script = tmp_path / "blocks.py"
    root = Path(__file__).resolve().parents[1]
    script.write_text(f"""
import sys, json
sys.path.insert(0, {str(root)!r})
# The worker normally enters its JSON loop when launched. Import its actual
# constructors in this native fixture without starting that loop.
class Input:
    def isatty(self): return True
original = sys.stdin
sys.stdin = Input()
from aether_freecad.worker import _circle_sketch, _wire_sketch
sys.stdin = original
import FreeCAD
document = FreeCAD.newDocument('BlockAcceptance')
cases = [
 ('circle', _circle_sketch, dict(radius_mm=6, center_mm=[2,3])),
 ('line', _wire_sketch, dict(start_mm=[0,0], segments=[dict(type='line',end=[10,0])])),
 ('arc', _wire_sketch, dict(start_mm=[0,0], segments=[dict(type='arc',middle=[5,5],end=[10,0])])),
 ('spline', _wire_sketch, dict(start_mm=[0,0], segments=[dict(type='bezier',controls=[[2,4],[8,4]],end=[10,0])])),
]
proof=[]
for name, create, parameters in cases:
 body=document.addObject('PartDesign::Body', 'Body'+name)
 sketch=create(document, body, dict(parameters, blocked_geometry=[0]))
 document.recompute()
 before=sketch.Geometry[0].copy()
 assert sketch.solve()==0, name
 assert sketch.FullyConstrained, (name, sketch.FullyConstrained)
 assert [c.Type for c in sketch.Constraints]==['Block'], name
 # A native attempt to move the locked curve cannot change its geometry.
 sketch.moveGeometry(0, 1, FreeCAD.Vector(30,20,0), 0)
 document.recompute()
 expected=before.toShape().discretize(Number=17)
 actual=sketch.Geometry[0].toShape().discretize(Number=17)
 assert len(actual)==len(expected) and all((a-b).Length < 1e-7 for a,b in zip(actual,expected)), name
 fixed=sketch.FullyConstrained
 sketch.delConstraint(0); sketch.solve(); document.recompute()
 assert not sketch.FullyConstrained, name
 proof.append(dict(kind=name, fixed=fixed, unlocked=not sketch.FullyConstrained))
print('BLOCK_PROOF '+json.dumps(proof))
FreeCAD.closeDocument(document.Name)
""")
    result = subprocess.run(
        [locate_freecad(), str(script)],
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    lines = [
        line.split("BLOCK_PROOF ", 1)[1]
        for line in result.stdout.splitlines()
        if "BLOCK_PROOF " in line
    ]
    assert lines, result.stdout + result.stderr
    assert len(json.loads(lines[0])) == 4


@pytest.mark.parametrize("blocked", [[], [0, 1, 2, 3]])
def test_fixed_closed_wire_builds_the_same_native_solid(blocked):
    with FreeCADEngine() as engine:
        result = engine.build(
            BuildJob(
                features=[
                    Feature(
                        "s",
                        "sketch-wire",
                        {
                            "start_mm": [0, 0],
                            "segments": [
                                {"type": "line", "end": end}
                                for end in [[10, 0], [10, 10], [0, 10], [0, 0]]
                            ],
                            "blocked_geometry": blocked,
                        },
                    ),
                    Feature(
                        "pad",
                        "pad",
                        {
                            "profile": "s",
                            "operation": "new",
                            "body_id": "b",
                            "distance_mm": 5,
                        },
                    ),
                ]
            )
        )
        assert not result.diagnostics, result.diagnostics
        assert result.bodies[0].volume_mm3 == pytest.approx(500)
