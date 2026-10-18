"""Native part transforms preserve/copy geometry, identity and downstream history."""
import math

import pytest
from aether_freecad import BuildJob, Feature, FreeCADEngine


@pytest.fixture(scope='module')
def engine():
    with FreeCADEngine() as value:yield value

def base():
    return [Feature('s','sketch-rectangle',{'width_mm':10,'height_mm':20}),Feature('base','pad',{'profile':'s','distance_mm':5,'operation':'new','body_id':'body'})]
def job(transform,copies=None,ids=None):
    return BuildJob(features=[*base(),Feature('transform','transform',{'body_ids':ids or ['body'],'transform':transform,**({'copy_body_ids':copies} if copies is not None else {})})],preview_feature_id='transform')
def bounds(body):
    return [min(body.vertices[i::3]) for i in range(3)]+[max(body.vertices[i::3]) for i in range(3)]

@pytest.mark.parametrize('copy',[False,True])
@pytest.mark.parametrize('transform,expected,volume',[
    ({'kind':'translate','translationMillimeters':[10,-5,7]},[10,-5,7,20,15,12],1000),
    ({'kind':'rotate','axisOriginMillimeters':[1,2,0],'axisDirection':[0,0,1],'angleDegrees':90},[-17,1,0,3,11,5],1000),
    ({'kind':'scale','centerMillimeters':[1,2,3],'scaleFactors':[2,2,2]},[-1,-2,-3,19,38,7],8000),
    ({'kind':'scale','centerMillimeters':[1,2,3],'scaleFactors':[2,.5,3]},[-1,1,-6,19,11,9],3000),
])
def test_transform_bounds_volume_and_copy_identity(engine,copy,transform,expected,volume):
    result=engine.build(job(transform,{'body':'copy'} if copy else None))
    assert not result.diagnostics,result.diagnostics
    moved=result.bodies[-1]
    assert moved.id==('copy' if copy else 'body')
    assert bounds(moved)==pytest.approx(expected,abs=1e-6)
    assert moved.volume_mm3==pytest.approx(volume,abs=1e-6)
    if copy:
        assert bounds(result.bodies[0])==pytest.approx([0,0,0,10,20,5])
        assert sum(b['volume_mm3'] for b in result.preview['added'])==pytest.approx(volume)
        assert not result.preview['removed']
        assert result.body_outputs['transform']==['copy']


def test_copy_in_place_is_independent_and_can_be_modified(engine):
    first=job({'kind':'copy'},{'body':'copy'})
    result=engine.build(first)
    assert not result.diagnostics,result.diagnostics
    assert [b.volume_mm3 for b in result.bodies]==pytest.approx([1000,1000])
    updated=BuildJob(features=[*first.features,Feature('offset','offset-face',{'distance_mm':2,'faces':[{'sourceFeatureId':'transform','bodyId':'copy','label':'Top','normal':[0,0,1]}]})])
    result=engine.build(updated)
    assert not result.diagnostics,result.diagnostics
    assert [b.volume_mm3 for b in result.bodies]==pytest.approx([1000,1400])

@pytest.mark.parametrize('bad',[
    {'kind':'translate','translationMillimeters':[0,0,float('inf')]},
    {'kind':'rotate','axisOriginMillimeters':[0,0,0],'axisDirection':[0,0,0],'angleDegrees':90},
    {'kind':'scale','centerMillimeters':[0,0,0],'scaleFactors':[1,0,1]},
    {'kind':'scale','centerMillimeters':[0,0,0],'scaleFactors':[-1,1,1]},
    {'kind':'scale','centerMillimeters':[0,0,0],'scaleFactors':[1e200,1e200,1e200]},
    {'kind':'scale','centerMillimeters':[0,0,0],'scaleFactors':[1e-200,1e-200,1e-200]},
    {'kind':'unknown'},{'kind':'copy'}])
def test_invalid_transforms_preserve_source_and_refuse_export(engine,bad):
    request=job(bad);r=engine.build(request)
    assert r.diagnostics and r.preview is None
    assert r.bodies[0].volume_mm3==pytest.approx(1000)
    assert engine.export(request,{'format':'step'})['status']=='error'

@pytest.mark.parametrize('mapping',[{}, {'body':'body'}, {'missing':'copy'}])
def test_invalid_copy_mappings_cannot_mutate_sources(engine,mapping):
    r=engine.build(job({'kind':'copy'},mapping))
    assert r.diagnostics and len(r.bodies)==1 and r.preview is None


def test_missing_second_body_is_atomic(engine):
    r=engine.build(job({'kind':'translate','translationMillimeters':[5,0,0]},ids=['body','gone']))
    assert r.diagnostics and r.preview is None
    assert bounds(r.bodies[0])==pytest.approx([0,0,0,10,20,5])


def test_curved_import_uniform_scale_and_step_roundtrip(engine):
    source=BuildJob(features=[Feature('s','sketch-circle',{'radius_mm':5}),Feature('base','pad',{'profile':'s','distance_mm':10,'operation':'new','body_id':'body'})])
    exported=engine.export(source,{'format':'step'})
    factors=[2,2,2]
    features=[Feature('base','import-step',{'operation':'new','body_id':'body','data_base64':exported['data_base64']}),
      Feature('scaled','transform',{'body_ids':['body'],'transform':{'kind':'scale','centerMillimeters':[1,2,3],'scaleFactors':factors}})]
    request=BuildJob(features=features);r=engine.build(request)
    assert not r.diagnostics,r.diagnostics
    assert r.bodies[0].volume_mm3==pytest.approx(250*math.pi*math.prod(factors),rel=1e-7)
    exported=engine.export(request,{'format':'step'});assert exported['status']=='ok'
    restored=engine.build(BuildJob(features=[Feature('reopen','import-step',{'body_id':'restored','operation':'new','data_base64':exported['data_base64']})]))
    assert not restored.diagnostics,restored.diagnostics
    assert restored.bodies[0].volume_mm3==pytest.approx(r.bodies[0].volume_mm3,rel=1e-7)


def test_nonuniform_curved_scale_is_explicitly_refused_without_mutating_sources(engine):
    # FreeCAD's general transform converts circular faces to C0 NURBS and its
    # mass calculation then differs from the analytic determinant by ~0.86%.
    # Keep the BOP/volume guards; accepting that result would break inspection.
    features=[Feature('s','sketch-circle',{'radius_mm':5}),Feature('base','pad',{'profile':'s','distance_mm':10,'operation':'new','body_id':'body'}),
      Feature('scaled','transform',{'body_ids':['body'],'transform':{'kind':'scale','centerMillimeters':[1,2,3],'scaleFactors':[2,3,.5]}})]
    request=BuildJob(features=features,preview_feature_id='scaled');r=engine.build(request)
    assert r.diagnostics and 'Uniform scale' in str(r.diagnostics)
    assert r.preview is None and len(r.bodies)==1
    assert r.bodies[0].volume_mm3==pytest.approx(250*math.pi,rel=1e-7)
    assert engine.export(request,{'format':'step'})['status']=='error'


def test_multi_part_copies_have_stable_outputs_and_follow_upstream_dimensions(engine):
    features=[*base(),Feature('s2','sketch-circle',{'radius_mm':2,'center_mm':[30,0]}),Feature('second','pad',{'profile':'s2','distance_mm':10,'operation':'new','body_id':'second'}),
      Feature('t','transform',{'body_ids':['body','second'],'copy_body_ids':{'body':'copy-box','second':'copy-cylinder'},'transform':{'kind':'translate','translationMillimeters':[0,0,20]}})]
    for depth in [5,8]:
        features[1].parameters['distance_mm']=depth
        r=engine.build(BuildJob(features=features,preview_feature_id='t'))
        assert not r.diagnostics,r.diagnostics
        assert [b.id for b in r.bodies]==['body','second','copy-box','copy-cylinder']
        assert r.body_outputs['t']==['copy-box','copy-cylinder']
        assert [b.volume_mm3 for b in r.bodies]==pytest.approx([200*depth,40*math.pi,200*depth,40*math.pi])
        assert bounds(r.bodies[2])[2::3]==pytest.approx([20,20+depth])


def test_rotation_about_arbitrary_axis_retains_analytic_curved_geometry(engine):
    transform={'kind':'rotate','axisOriginMillimeters':[0,0,0],'axisDirection':[1/math.sqrt(2),1/math.sqrt(2),0],'angleDegrees':180}
    r=engine.build(job(transform))
    assert not r.diagnostics,r.diagnostics
    assert bounds(r.bodies[0])==pytest.approx([0,0,-5,20,10,0],abs=1e-6)
    assert r.bodies[0].volume_mm3==pytest.approx(1000)
