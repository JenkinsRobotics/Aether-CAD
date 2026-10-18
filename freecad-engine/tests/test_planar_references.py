"""Explicit geometric anchors select parallel and coplanar faces conservatively."""
import math
import pytest
from aether_freecad import BuildJob, Feature, FreeCADEngine


@pytest.fixture(scope="module")
def engine():
    with FreeCADEngine() as instance:
        yield instance


def stepped(height=5):
    return [
        Feature("s", "sketch-rectangle", {"width_mm": 10, "height_mm": 20}),
        Feature("base", "pad", {"profile": "s", "distance_mm": 10, "operation": "new", "body_id": "body"}),
        Feature("top", "sketch-rectangle", {"width_mm": 5, "height_mm": 20, "offset_mm": 10}),
        Feature("step", "pad", {"profile": "top", "distance_mm": height, "operation": "add", "body_id": "body"}),
    ]


def anchor(center, area=100):
    return {"centerMillimeters": center, "areaSquareMillimeters": area}


def pull(reference, distance=2, **changes):
    return Feature("pull", "face-extrude", {"body_id": "body", "source_feature_id": "step",
        "normal": [0, 0, 1], "face_anchor": reference, "distance_mm": distance, **changes})


@pytest.mark.parametrize("center,xlow,z", [([2.5,10,15],0,15),([7.5,10,10],5,10)])
@pytest.mark.parametrize("depth", [2,-2])
def test_selects_only_requested_step_face_with_exact_signed_preview(engine,center,xlow,z,depth):
    result = engine.build(BuildJob(features=stepped()+[pull(anchor(center), depth)], preview_feature_id="pull"))
    assert result.diagnostics == []
    assert result.bodies[0].volume_mm3 == pytest.approx(2500+100*depth)
    role = "added" if depth > 0 else "removed"
    delta = result.preview[role]
    assert sum(p["volume_mm3"] for p in delta) == pytest.approx(200)
    assert not result.preview["removed" if depth > 0 else "added"]
    vertices = delta[0]["vertices"]
    assert min(vertices[0::3]) == pytest.approx(xlow)
    assert max(vertices[0::3]) == pytest.approx(xlow+5)
    assert min(vertices[2::3]) == pytest.approx(min(z,z+depth))
    assert max(vertices[2::3]) == pytest.approx(max(z,z+depth))


def test_coplanar_towers_are_distinguished_by_center_not_face_order(engine):
    features = [
        Feature("s", "sketch-rectangle", {"width_mm":20,"height_mm":10}),
        Feature("base", "pad", {"profile":"s","distance_mm":5,"operation":"new","body_id":"body"}),
        Feature("left", "sketch-circle", {"radius_mm":2,"center_mm":[3,5],"offset_mm":5}),
        Feature("right", "sketch-circle", {"radius_mm":2,"center_mm":[17,5],"offset_mm":5}),
        Feature("step", "pad", {"profiles":["left","right"],"profile_regions":["left","right"],"region_mode":True,"distance_mm":5,"operation":"add","body_id":"body"}),
    ]
    for x in [3,17]:
        result = engine.build(BuildJob(features=features+[pull(anchor([x,5,10],4*math.pi))],preview_feature_id="pull"))
        assert result.diagnostics == []
        assert result.bodies[0].volume_mm3 == pytest.approx(1000+48*math.pi)
        assert min(result.preview["added"][0]["vertices"][0::3]) == pytest.approx(x-2,abs=.1)


def test_changed_anchor_fails_then_explicit_reselection_repairs_without_partial_result(engine):
    request = BuildJob(features=stepped(7)+[pull(anchor([2.5,10,15]))],preview_feature_id="pull")
    failed = engine.build(request)
    assert "Reselect" in failed.diagnostics[0]["message"]
    assert failed.bodies[0].volume_mm3 == pytest.approx(2700)
    assert failed.preview is None
    assert engine.export(request,{"format":"step"})["status"] == "error"
    request.features[-1] = pull(anchor([2.5,10,17]))
    fixed = engine.build(request)
    assert fixed.diagnostics == []
    assert fixed.bodies[0].volume_mm3 == pytest.approx(2900)
    assert engine.export(request,{"format":"step"})["status"] == "ok"


def test_anchored_step_survives_step_export_import_and_further_edit(engine):
    exported = engine.export(BuildJob(features=stepped()+[pull(anchor([2.5,10,15]))]),{"format":"step"})
    assert exported["status"] == "ok"
    imported = Feature("import","import-step",{"data_base64":exported["data_base64"],"operation":"new","body_id":"body"})
    result = engine.build(BuildJob(features=[imported,pull(anchor([2.5,10,17]),-1,source_feature_id="import")]))
    assert result.diagnostics == []
    assert result.bodies[0].volume_mm3 == pytest.approx(2600,abs=1e-4)


@pytest.mark.parametrize("reference", [anchor([999,10,15]),anchor([2.5,10,15],99),anchor([2.5,10,float('nan')]),anchor([2.5,10,15],-1),{},"Face3"])
def test_invalid_or_missing_anchor_never_falls_back_to_a_unique_normal(engine,reference):
    result = engine.build(BuildJob(features=stepped()[:2]+[pull(reference,source_feature_id="base")]))
    assert result.diagnostics
    assert result.bodies[0].volume_mm3 == pytest.approx(2000)


@pytest.mark.parametrize("center,height", [([7.5,10,10],10),([2.5,10,15],15)])
def test_anchored_stop_selects_the_requested_plane_and_sketch_support(engine,center,height):
    reference = {"sourceFeatureId":"step","bodyId":"body","normal":[0,0,1],"faceAnchor":anchor(center)}
    stop = Feature("out", "sketch-circle", {"radius_mm":1,"center_mm":[30,0]})
    extrude = Feature("to-face", "pad", {"operation":"new","body_id":"new","profiles":["out"],"profile_regions":["out"],"region_mode":True,"distance_mm":1,"end_type":"up-to-face","end_reference":reference})
    result = engine.build(BuildJob(features=stepped()+[stop,extrude]))
    assert result.diagnostics == []
    assert result.bodies[-1].volume_mm3 == pytest.approx(math.pi*height)
    sketch = Feature("attached", "sketch-circle", {"radius_mm":1,"source_profile_id":"attached",
        "support":{**reference,"xDirection":[1,0,0]},"frame":{"originMillimeters":[0,0,0],"normal":[0,0,1],"xDirection":[1,0,0]}})
    pad = Feature("boss", "pad", {"profile":"attached","operation":"add","body_id":"body","distance_mm":2})
    result = engine.build(BuildJob(features=stepped()+[sketch,pad]))
    assert result.diagnostics == []
    assert result.sketch_frames["attached"]["originMillimeters"] == pytest.approx(center)
    assert result.bodies[0].volume_mm3 == pytest.approx(2500+2*math.pi)
