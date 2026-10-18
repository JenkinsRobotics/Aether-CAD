"""Native source anchors remain stable through a transform, independent of meshes."""
import math

import pytest
from aether_freecad import BuildJob, Feature, FreeCADEngine


@pytest.fixture(scope='module')
def engine():
    with FreeCADEngine() as value:
        yield value


def source():
    return [Feature('s','sketch-rectangle',{'width_mm':10,'height_mm':20}),Feature('base','pad',{'profile':'s','distance_mm':5,'operation':'new','body_id':'body'})]

@pytest.mark.parametrize('transform',[
    {'kind':'translate','translationMillimeters':[30,-50,10]},
    {'kind':'rotate','axisOriginMillimeters':[10,30,4],'axisDirection':[0,0,1],'angleDegrees':32},
    {'kind':'scale','centerMillimeters':[0,0,0],'scaleFactors':[2,3,4]},
    {'kind':'copy'},
])
def test_bounds_use_selected_sources_before_transform(engine,transform):
    features=[*source(),Feature('t','transform',{'body_ids':['body'],'copy_body_ids':{'body':'copy'},'transform':transform})]
    for tolerance in [.05,.5]:
        r=engine.build(BuildJob(features=features,preview_feature_id='t',tessellation_tolerance_mm=tolerance))
        assert not r.diagnostics,r.diagnostics
        assert r.preview['transform_frame']['center_mm']==pytest.approx([5,10,2.5])
        assert r.preview['transform_frame']['radius_mm']==pytest.approx(math.sqrt(525)/2)
    assert engine.build(BuildJob(features=features)).preview is None


def test_multiple_selected_sources_include_prior_placements_and_exclude_other_parts(engine):
    features=[*source(),Feature('second','pad',{'profile':'s','distance_mm':5,'operation':'new','body_id':'second'}),
      Feature('prior','transform',{'body_ids':['second'],'transform':{'kind':'translate','translationMillimeters':[30,0,0]}})]
    for ids,center,radius in [(['body'],[5,10,2.5],math.sqrt(525)/2),(['body','second'],[20,10,2.5],22.5)]:
        final=Feature('t','transform',{'body_ids':ids,'transform':{'kind':'translate','translationMillimeters':[100,0,0]}})
        r=engine.build(BuildJob(features=[*features,final],preview_feature_id='t'))
        assert not r.diagnostics,r.diagnostics
        assert r.preview['transform_frame']['center_mm']==pytest.approx(center)
        assert r.preview['transform_frame']['radius_mm']==pytest.approx(radius)


def test_invalid_transform_does_not_publish_an_anchor(engine):
    r=engine.build(BuildJob(features=[*source(),Feature('t','transform',{'body_ids':['missing'],'transform':{'kind':'translate','translationMillimeters':[1,0,0]}})],preview_feature_id='t'))
    assert r.diagnostics and r.preview is None
    r=engine.build(BuildJob(features=source(),preview_feature_id='base'))
    assert not r.diagnostics and 'transform_frame' not in r.preview


@pytest.mark.parametrize('imported',[False,True])
def test_curved_native_and_imported_sources_keep_the_same_anchor_at_different_mesh_tolerances(engine,imported):
    features=[Feature('s','sketch-circle',{'radius_mm':5,'center_mm':[-12,0]}),Feature('base','pad',{'profile':'s','distance_mm':10,'operation':'new','body_id':'body'})]
    if imported:
        exported=engine.export(BuildJob(features=features),{'format':'step'})
        assert exported['status']=='ok'
        features=[Feature('base','import-step',{'operation':'new','body_id':'body','data_base64':exported['data_base64']})]
    features.append(Feature('t','transform',{'body_ids':['body'],'transform':{'kind':'translate','translationMillimeters':[100,20,-10]}}))
    frames=[]
    for tolerance in [.01,1]:
        r=engine.build(BuildJob(features=features,preview_feature_id='t',tessellation_tolerance_mm=tolerance))
        assert not r.diagnostics,r.diagnostics
        frames.append(r.preview['transform_frame'])
    assert frames[0]==frames[1]
    assert frames[0]['center_mm']==pytest.approx([-12,0,5])
    assert frames[0]['radius_mm']==pytest.approx(math.sqrt(300)/2)
