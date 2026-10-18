"""One feature modifies explicit parts atomically and preserves their identities."""
from dataclasses import replace
import math
import pytest
from aether_freecad import BuildJob, Feature, FreeCADEngine

@pytest.fixture(scope="module")
def engine():
    with FreeCADEngine() as instance:
        yield instance

def job(scope=None, operation="cut", end="through-all", radius=2):
    features=[]
    for key,z in [("a",0),("b",20),("untouched",40)]:
        features.extend([
            Feature(key+"-s","sketch-rectangle",{"width_mm":10,"height_mm":10,"offset_mm":z}),
            Feature(key,"pad",{"profile":key+"-s","distance_mm":5,"operation":"new","body_id":key}),
        ])
    features.extend([
        Feature("circle","sketch-circle",{"radius_mm":radius,"center_mm":[5,5],"offset_mm":30}),
        Feature("cut","pocket" if operation=="cut" else "pad",{"operation":operation,"body_id":(scope or ["a","b"])[0],"target_body_ids":scope if scope is not None else ["a","b"],"region_mode":True,"profiles":["circle"],"profile_regions":["circle"],"distance_mm":30,"end_type":end,"reversed":operation=="intersect"}),
    ])
    return BuildJob(features=features,preview_feature_id="cut")

@pytest.mark.parametrize("operation,volume",[("cut",500-20*math.pi),("intersect",20*math.pi)])
def test_scoped_solids_and_exact_preview(engine,operation,volume):
    result=engine.build(job(operation=operation))
    assert result.diagnostics==[]
    assert [b.id for b in result.bodies]==["a","b","untouched"]
    assert [b.volume_mm3 for b in result.bodies]==pytest.approx([volume,volume,500])
    assert len(result.preview["removed"])==2
    assert result.preview["added"]==[]

def test_failure_on_later_target_leaves_every_body_unchanged(engine):
    request=job(scope=["a","missing"])
    result=engine.build(request)
    assert result.diagnostics
    assert [b.volume_mm3 for b in result.bodies]==pytest.approx([500,500,500])
    assert result.preview is None
    assert engine.export(request,{"format":"step"})["status"]=="error"
    assert engine.build(job()).diagnostics==[]

def test_empty_later_result_does_not_partially_apply_scope(engine):
    request=job(operation="intersect",end="blind")
    request.features[-1].parameters["distance_mm"]=8
    request.features[-1].parameters.update({"body_id":"b","target_body_ids":["b","a"]})
    result=engine.build(request)
    assert result.diagnostics
    assert [b.volume_mm3 for b in result.bodies]==pytest.approx([500,500,500])

@pytest.mark.parametrize("scope",[["a","a"],[],["a",None]])
def test_invalid_scope_refused(engine,scope):
    result=engine.build(job(scope=scope))
    assert result.diagnostics
    assert result.preview is None

def test_no_overlap_target_stays_unchanged_while_other_selected_part_is_cut(engine):
    request=job(scope=["a","untouched"])
    result=engine.build(request)
    assert result.diagnostics==[]
    assert [b.volume_mm3 for b in result.bodies]==pytest.approx([500-20*math.pi,500,500])

def test_multi_target_step_roundtrip(engine):
    export=engine.export(replace(job(),preview_feature_id=None),{"format":"step"})
    assert export["status"]=="ok"
    imported=engine.build(BuildJob(features=[Feature("import","import-step",{"data_base64":export["data_base64"],"operation":"new","body_id":"imported"})]))
    assert imported.diagnostics==[]
    assert sum(b.volume_mm3 for b in imported.bodies)==pytest.approx(1500-40*math.pi,abs=1e-4)


def test_complete_removal_of_second_target_cannot_commit_first_target(engine):
    request=job(radius=8)
    request.features[0].parameters.update({"width_mm":20,"height_mm":20})
    result=engine.build(request)
    assert result.diagnostics
    assert [b.volume_mm3 for b in result.bodies]==pytest.approx([2000,500,500])
    assert result.preview is None


def merge_job(scope=None, start=5, depth=15):
    request = job(scope=scope, operation="add", end="blind")
    request.features[-2].parameters["offset_mm"] = start
    request.features[-1].parameters["distance_mm"] = depth
    return request


@pytest.mark.parametrize("start,depth,scope", [(5,15,["a","b"]),(0,25,["b","a"])])
def test_add_merges_touching_or_overlapping_parts_with_only_new_material_blue(engine,start,depth,scope):
    result = engine.build(merge_job(scope,start,depth))
    assert result.diagnostics == []
    assert [b.id for b in result.bodies] == [scope[0],"untouched"]
    assert [b.volume_mm3 for b in result.bodies] == pytest.approx([1000+60*math.pi,500])
    assert sum(b["volume_mm3"] for b in result.preview["base"]) == pytest.approx(1500)
    assert sum(b["volume_mm3"] for b in result.preview["added"]) == pytest.approx(60*math.pi)
    assert [b["id"] for b in result.preview["added"]] == [f"preview:added:{scope[0]}"]
    assert result.preview["removed"] == []


@pytest.mark.parametrize("scope,depth", [(["a","b"],10),(["a","b","untouched"],15),(["a","missing"],15)])
def test_invalid_merge_keeps_all_original_outputs_and_refuses_export(engine,scope,depth):
    request = merge_job(scope,depth=depth)
    result = engine.build(request)
    assert result.diagnostics
    assert [b.id for b in result.bodies] == ["a","b","untouched"]
    assert [b.volume_mm3 for b in result.bodies] == pytest.approx([500,500,500])
    assert result.preview is None
    assert engine.export(request,{"format":"step"})["status"] == "error"


def test_merged_primary_has_a_face_snapshot_and_step_roundtrips(engine):
    request = merge_job()
    # A full-width bridge has a unique upper planar face. The narrower bridge
    # retains two +Z faces, intentionally ambiguous for the current face picker.
    request.features[-2] = Feature("circle","sketch-rectangle",{"width_mm":10,"height_mm":10,"offset_mm":5})
    request = replace(request,preview_feature_id=None)
    request.features.append(Feature("pull","face-extrude",{"source_feature_id":"cut","body_id":"a","normal":[0,0,1],"distance_mm":2}))
    result = engine.build(request)
    assert result.diagnostics == []
    assert result.bodies[0].volume_mm3 == pytest.approx(2700)
    exported = engine.export(request,{"format":"step"})
    assert exported["status"] == "ok"
    imported = engine.build(BuildJob(features=[Feature("import","import-step",{"data_base64":exported["data_base64"],"operation":"new","body_id":"imported"})]))
    assert imported.diagnostics == []
    assert sum(b.volume_mm3 for b in imported.bodies) == pytest.approx(3200,abs=1e-4)
