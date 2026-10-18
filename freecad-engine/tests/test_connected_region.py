"""Native region projections preserve exact source curves and frame semantics."""

import copy
import json
import math
import subprocess
from pathlib import Path

import pytest
from aether_freecad import BuildJob, Feature, FreeCADEngine
from aether_freecad.engine import locate_freecad


def line(key, start, end, **placement):
    return Feature(key, "sketch-wire", dict(
        start_mm=start, segments=[{"type": "line", "end": end}], **placement,
    ))


def rectangle(prefix="", x=0, y=0, w=20, h=10, **placement):
    return [
        line(prefix + "bottom", [x, y], [x + w, y], **placement),
        # Deliberately reverse and shuffle directions; source ordering is not
        # the user's face identity and must not change the selected result.
        line(prefix + "right", [x + w, y + h], [x + w, y], **placement),
        line(prefix + "top", [x + w, y + h], [x, y + h], **placement),
        line(prefix + "left", [x, y], [x, y + h], **placement),
    ]


def region(key, sources):
    return Feature(key, "sketch-region", {"profiles": [s.id for s in sources]})


def pad(selected, candidates=None, **extra):
    return Feature("pad", "pad", dict(
        operation="new", body_id="connected", region_mode=True,
        profiles=selected, profile_regions=candidates or selected,
        distance_mm=6, **extra,
    ))


@pytest.mark.parametrize("plane,axis", [("XY", 2), ("XZ", 1), ("YZ", 0)])
def test_joined_rectangle_exact_volume_on_each_sketch_plane(plane, axis):
    sources = rectangle(plane=plane, offset_mm=7)
    sources = [sources[2], sources[0], sources[3], sources[1]]
    with FreeCADEngine() as engine:
        assert "sketch-connected-region" in engine.describe()["capabilities"]
        result = engine.build(BuildJob(features=sources + [region("region", sources), pad(["region"])]))
    assert not result.diagnostics, result.diagnostics
    body = result.bodies[0]
    assert body.volume_mm3 == pytest.approx(1200, rel=1e-10)
    assert max(body.vertices[axis::3]) - min(body.vertices[axis::3]) == pytest.approx(6)


def test_joined_spline_profile_rebuilds_when_original_controls_change():
    # x=20t, y=4h*t*(1-t); exact area 40h/3. The browser's separate
    # fit/control identities remain separate native source sketches.
    with FreeCADEngine() as engine:
        identities = []
        for height in (12, 18, 12):
            spline = Feature("spline", "sketch-wire", {
                "start_mm": [0, 0], "blocked_geometry": [0],
                "segments": [{"type": "bezier", "controls": [[20/3, 4*height/3], [40/3, 4*height/3]], "end": [20, 0]}],
            })
            base = line("base", [0, 0], [20, 0])
            result = engine.build(BuildJob(features=[spline, base, region("r", [base, spline]), pad(["r"])]))
            assert not result.diagnostics, result.diagnostics
            assert result.bodies[0].volume_mm3 == pytest.approx(80 * height, rel=1e-8)
            identities.append(result.bodies[0].id)
        assert len(set(identities)) == 1


@pytest.mark.parametrize("kind,area", [("arc", 50 * math.pi), ("ellipse", 20 * math.pi)])
def test_separate_curved_contour_and_same_direction_chord_keep_exact_geometry(kind, area):
    segment = {"type": kind, "end": [20, 0]}
    if kind == "arc":
        segment["middle"] = [10, 10]
    else:
        segment["ellipse_frame"] = {"center": [10, 0], "radiusX": 10, "radiusY": 4, "rotation": 0, "startAngle": math.pi, "sweep": -math.pi}
    curve = Feature("curve", "sketch-wire", {"start_mm": [0, 0], "segments": [segment]})
    chord = line("chord", [0, 0], [20, 0])
    with FreeCADEngine() as engine:
        result = engine.build(BuildJob(features=[curve, chord, region("r", [chord, curve]), pad(["r"])]))
    assert not result.diagnostics, result.diagnostics
    assert result.bodies[0].volume_mm3 == pytest.approx(area * 6, rel=1e-9)


@pytest.mark.parametrize("selected,area", [(["outer"], 160), (["inner"], 40), (["outer", "inner"], 200)])
def test_nested_joined_loops_keep_hole_selection_semantics(selected, area):
    outer, inner = rectangle(), rectangle("inner-", 5, 3, 10, 4)
    with FreeCADEngine() as engine:
        result = engine.build(BuildJob(features=outer + inner + [
            region("outer", outer), region("inner", inner), pad(selected, ["outer", "inner"]),
        ]))
    assert not result.diagnostics, result.diagnostics
    assert sum(b.volume_mm3 for b in result.bodies) == pytest.approx(area * 6)


def test_arbitrary_translated_frame_is_applied_once():
    frame = {"originMillimeters": [12, -8, 20], "xDirection": [1, 0, 0], "normal": [0, 1, 1]}
    sources = rectangle(frame=frame)
    with FreeCADEngine() as engine:
        result = engine.build(BuildJob(features=sources + [region("r", sources), pad(["r"])]))
    assert not result.diagnostics, result.diagnostics
    body = result.bodies[0]
    assert body.volume_mm3 == pytest.approx(1200, rel=1e-9)
    # Project world vertices back onto the shared normalized frame.
    vertices = list(zip(*[iter(body.vertices)] * 3))
    x = [p[0] - 12 for p in vertices]
    normal = [(p[1] + 8 + p[2] - 20) / math.sqrt(2) for p in vertices]
    assert (min(x), max(x)) == pytest.approx((0, 20))
    assert (min(normal), max(normal)) == pytest.approx((0, 6))


@pytest.mark.parametrize("operation,volume", [("revolve", 2800 * math.pi), ("sweep", 2400), ("loft", 2000)])
def test_joined_profiles_work_with_other_native_solid_features(operation, volume):
    sources = rectangle(x=5 if operation == "revolve" else 0, y=2 if operation == "revolve" else 0)
    features = sources + [region("r", sources)]
    parameters = {"operation": "new", "body_id": "part"}
    if operation == "revolve":
        parameters.update(profile="r", axis="X", angle_deg=360)
    elif operation == "sweep":
        features.append(line("path", [0, 0], [0, 12], plane="XZ"))
        parameters.update(profile="r", path="path")
    else:
        upper = rectangle("upper-", offset_mm=10)
        features += upper + [region("upper", upper)]
        parameters.update(sections=["r", "upper"], ruled=True)
    features.append(Feature("solid", operation, parameters))
    with FreeCADEngine() as engine:
        result = engine.build(BuildJob(features=features))
        assert not result.diagnostics, result.diagnostics
        assert result.bodies[0].volume_mm3 == pytest.approx(volume, rel=1e-7)
        exported = engine.export(BuildJob(features=features), {"format": "step"})
        assert exported["status"] == "ok", exported
        imported = engine.build(BuildJob(features=[Feature("import", "import-step", {
            "data_base64": exported["data_base64"], "operation": "new", "body_id": "part",
        })]))
        assert not imported.diagnostics, imported.diagnostics
        assert imported.bodies[0].volume_mm3 == pytest.approx(volume, rel=1e-7)


@pytest.mark.parametrize("problem", ["gap", "branch", "duplicate", "missing", "different-frame", "closed-source", "disconnected", "crossed", "overlap", "cubic-loop"])
def test_invalid_joined_regions_fail_without_a_partial_solid(problem):
    sources = rectangle()
    ids = [s.id for s in sources]
    if problem == "gap":
        sources[0].parameters["segments"][0]["end"] = [19.99, 0]
    elif problem == "branch":
        sources.append(line("branch", [0, 0], [-5, 0])); ids.append("branch")
    elif problem == "duplicate":
        ids.append("top")
    elif problem == "missing":
        ids[0] = "missing"
    elif problem == "different-frame":
        sources[0].parameters["offset_mm"] = 1
    elif problem == "closed-source":
        sources[0] = Feature("bottom", "sketch-circle", {"radius_mm": 5})
    elif problem == "disconnected":
        others = rectangle("other-", 30, 0); sources += others; ids += [s.id for s in others]
    elif problem == "crossed":
        sources = [line("a", [0, 0], [20, 10]), line("b", [20, 10], [0, 10]), line("c", [0, 10], [20, 0]), line("d", [20, 0], [0, 0])]
        ids = [s.id for s in sources]
    elif problem == "overlap":
        sources = [line("a", [0, 0], [20, 0]), line("b", [20, 0], [0, 0])]; ids = ["a", "b"]
    elif problem == "cubic-loop":
        sources = [Feature("a", "sketch-wire", {
            "start_mm": [0, 0], "segments": [{"type": "bezier", "controls": [[-0.28, -1/3], [-0.56, -1/3]], "end": [0.16, 0]}],
        }), line("b", [0.16, 0], [0, 0])]; ids = ["a", "b"]
    before = copy.deepcopy(sources)
    with FreeCADEngine() as engine:
        result = engine.build(BuildJob(features=sources + [Feature("r", "sketch-region", {"profiles": ids}), pad(["r"])]))
    assert result.diagnostics, problem
    assert any(item["feature_id"] == "r" for item in result.diagnostics)
    assert not result.bodies
    assert sources == before


def test_region_links_preserve_original_native_sketch_constraints_and_exact_curve(tmp_path):
    root = Path(__file__).resolve().parents[1]
    report = tmp_path / "report.json"
    script = tmp_path / "linked_profile.py"
    script.write_text(f"""
import sys, json
sys.path.insert(0, {str(root)!r})
import FreeCAD, Part
from aether_freecad.worker import _wire_sketch
from aether_freecad.connected_region import connected_region
d=FreeCAD.newDocument('ConnectedRegionProof')
frame=dict(originMillimeters=[12,-8,20],xDirection=[1,0,0],normal=[0,1,1])
curve=_wire_sketch(d,None,dict(start_mm=[0,0],segments=[dict(type='bezier',controls=[[20/3,16],[40/3,16]],end=[20,0])],blocked_geometry=[0],frame=frame))
base=_wire_sketch(d,None,dict(start_mm=[20,0],segments=[dict(type='line',end=[0,0])],frame=frame))
d.recompute()
before=[tuple(p) for p in curve.Geometry[0].getPoles()]
r=connected_region(d,dict(profiles=['curve','base']),dict(curve=curve,base=base))
d.recompute()
assert curve.FullyConstrained and curve.ConstraintCount==1 and curve.solve()==0
assert before==[tuple(p) for p in curve.Geometry[0].getPoles()]
assert r.SourceProfiles==[curve,base]
assert sum(o.TypeId=='Sketcher::SketchObject' for o in d.Objects)==2
splines=[edge.Curve for edge in r.Shape.Edges if isinstance(edge.Curve,Part.BSplineCurve)]
assert len(splines)==1 and splines[0].Degree==3 and splines[0].NbPoles==4
result=dict(area=Part.Face(r.Shape).Area,linked=len(r.SourceProfiles),constraints=curve.ConstraintCount)
open({str(report)!r},'w').write(json.dumps(result))
FreeCAD.closeDocument(d.Name)
""")
    process = subprocess.run([locate_freecad(), str(script)], input="", capture_output=True, text=True, timeout=30, check=False)
    assert report.exists(), process.stdout + process.stderr
    assert json.loads(report.read_text()) == pytest.approx({"area": 160, "linked": 2, "constraints": 1})
