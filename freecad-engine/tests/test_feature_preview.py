"""Exact material changes rather than coloring an entire result body."""
from dataclasses import replace
import pytest
from aether_freecad import BuildJob, Feature, FreeCADEngine
from aether_freecad.protocol import job_to_json, job_from_json

@pytest.fixture(scope="module")
def engine():
    with FreeCADEngine() as instance:
        yield instance

def base():
    return [Feature("s", "sketch-rectangle", {"width_mm": 10, "height_mm": 20}),
            Feature("pad", "pad", {"profile": "s", "distance_mm": 10, "operation": "new", "body_id": "base"})]

def volumes(result, role):
    return sum(b["volume_mm3"] for b in result.preview[role])

@pytest.mark.parametrize("distance,retained,added,removed", [(5,2000,1000,0),(-3,1400,0,600)])
def test_push_pull_changes_are_exact_and_never_output_bodies(engine,distance,retained,added,removed):
    features=base()+[Feature("pull","face-extrude",{"source_feature_id":"pad","body_id":"base","normal":[0,0,1],"distance_mm":distance})]
    job=BuildJob(features=features,preview_feature_id="pull")
    result=engine.build(job_from_json(job_to_json(job)))
    assert result.diagnostics == []
    assert [b.id for b in result.bodies] == ["base"]
    assert volumes(result,"base") == pytest.approx(retained)
    assert volumes(result,"added") == pytest.approx(added)
    assert volumes(result,"removed") == pytest.approx(removed)
    assert engine.build(replace(job,preview_feature_id=None)).preview is None

def test_new_extrusion_is_blue_volume_without_base(engine):
    result=engine.build(BuildJob(features=base(),preview_feature_id="pad"))
    assert result.diagnostics == []
    assert volumes(result,"added") == pytest.approx(2000)
    assert result.preview["base"] == result.preview["removed"] == []

def test_cut_preview_preserves_other_body_and_shows_only_removed_volume(engine):
    features=base()+[
      Feature("other-outline","sketch-circle",{"radius_mm":2,"center_mm":[30,0]}),
      Feature("other","pad",{"profile":"other-outline","distance_mm":5,"operation":"new","body_id":"other"}),
      Feature("hole-outline","sketch-circle",{"radius_mm":2,"center_mm":[5,10],"offset_mm":10}),
      Feature("cut","pocket",{"profile":"hole-outline","depth_mm":4,"operation":"cut","body_id":"base"}),
    ]
    result=engine.build(BuildJob(features=features,preview_feature_id="cut"))
    assert result.diagnostics == []
    assert volumes(result,"removed") == pytest.approx(16*3.141592653589793)
    assert result.preview["added"] == []
    assert len(result.preview["base"]) == 2
    assert next(b for b in result.bodies if b.id=="other").volume_mm3 == pytest.approx(20*3.141592653589793)

def test_invalid_feature_never_leaves_colored_partial_preview(engine):
    features=base()+[Feature("pull","face-extrude",{"source_feature_id":"pad","body_id":"base","normal":[0,0,1],"distance_mm":-30})]
    result=engine.build(BuildJob(features=features,preview_feature_id="pull"))
    assert result.diagnostics
    assert result.preview is None
    assert engine.build(BuildJob(features=base(),preview_feature_id="pad")).preview
