import json
import math
import subprocess
from pathlib import Path

import pytest
from aether_freecad import BuildJob, Feature, FreeCADEngine
from aether_freecad.ellipse_wire import ellipse_wire_segment
from aether_freecad.engine import locate_freecad


def ellipse_frame(rx=12, ry=5, rotation=0, begin=0, sweep=math.pi):
    return {
        "center": [3, -2],
        "radiusX": rx,
        "radiusY": ry,
        "rotation": rotation,
        "startAngle": begin,
        "sweep": sweep,
    }


def at(frame, t):
    angle = frame["startAngle"] + t * frame["sweep"]
    x, y = frame["radiusX"] * math.cos(angle), frame["radiusY"] * math.sin(angle)
    c, s = math.cos(frame["rotation"]), math.sin(frame["rotation"])
    return [frame["center"][0] + c * x - s * y, frame["center"][1] + s * x + c * y]


@pytest.mark.parametrize(
    "rx,ry,rotation,direction",
    [
        (12, 5, 0, 1),
        (5, 12, 0.7, 1),
        (12, 5, 0.4, -1),
        (5, 12, -0.5, -1),
        (8, 8, 0.2, 1),
    ],
)
def test_native_ellipse_solid_retains_exact_axes_sweep_and_blocks(
    rx, ry, rotation, direction
):
    frames = [
        ellipse_frame(rx, ry, rotation, direction * math.pi * i, direction * math.pi)
        for i in (0, 1)
    ]
    with FreeCADEngine() as engine:
        result = engine.build(
            BuildJob(
                features=[
                    Feature(
                        "s",
                        "sketch-wire",
                        {
                            "start_mm": at(frames[0], 0),
                            "segments": [
                                {
                                    "type": "ellipse",
                                    "end": at(frame, 1),
                                    "ellipse_frame": frame,
                                }
                                for frame in frames
                            ],
                            "blocked_geometry": [0, 1],
                        },
                    ),
                    Feature(
                        "p",
                        "pad",
                        {
                            "profile": "s",
                            "operation": "new",
                            "body_id": "ellipse",
                            "distance_mm": 7,
                        },
                    ),
                ]
            )
        )
        assert not result.diagnostics, result.diagnostics
        assert result.bodies[0].volume_mm3 == pytest.approx(
            math.pi * rx * ry * 7, rel=1e-9
        )


def test_native_partial_ellipses_match_independent_analytic_points_and_are_fixed(
    tmp_path,
):
    frames = [
        ellipse_frame(rx, ry, angle, 0.3, sweep)
        for rx, ry, angle, sweep in [
            (12, 5, 0.7, 1.7),
            (5, 12, 0.4, -4.8),
            (12, 5, -0.4, -2.1),
            (8, 8, 0, 4.2),
        ]
    ]
    cases = [
        {
            "start": at(f, 0),
            "end": at(f, 1),
            "frame": f,
            "expected": [at(f, t / 8) for t in range(9)],
        }
        for f in frames
    ]
    script = tmp_path / "ellipses.py"
    root = Path(__file__).resolve().parents[1]
    script.write_text(f"""
import sys, json
sys.path.insert(0,{str(root)!r})
class Input:
 def isatty(self): return True
original=sys.stdin;sys.stdin=Input()
from aether_freecad.worker import _wire_sketch
sys.stdin=original
import FreeCAD
cases=json.loads({json.dumps(cases)!r})
d=FreeCAD.newDocument('EllipseAcceptance')
for i,case in enumerate(cases):
 b=d.addObject('PartDesign::Body','Body'+str(i))
 s=_wire_sketch(d,b,dict(start_mm=case['start'],segments=[dict(type='ellipse',end=case['end'],ellipse_frame=case['frame'])],blocked_geometry=[0]))
 d.recompute()
 assert s.FullyConstrained and s.solve()==0, i
 curve=s.Geometry[0]
 for j,expected in enumerate(case['expected']):
  p=curve.value(curve.FirstParameter+(curve.LastParameter-curve.FirstParameter)*j/8)
  assert (p-FreeCAD.Vector(*expected,0)).Length < 1e-7, (i,j,p,expected)
 s.delConstraint(0);s.solve();assert not s.FullyConstrained
print('ELLIPSE_PROOF '+str(len(cases)))
FreeCAD.closeDocument(d.Name)
""")
    result = subprocess.run(
        [locate_freecad(), str(script)],
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    assert "ELLIPSE_PROOF 4" in result.stdout, result.stdout + result.stderr


@pytest.mark.parametrize(
    "change",
    [{"radiusX": 0}, {"sweep": 0}, {"center": [0, 0]}, {"startAngle": float("nan")}],
)
def test_invalid_or_mismatched_native_frame_is_rejected(change):
    frame = ellipse_frame()
    start, end = at(frame, 0), at(frame, 1)
    with pytest.raises(ValueError):
        ellipse_wire_segment(start, end, dict(frame, **change), None, None)
