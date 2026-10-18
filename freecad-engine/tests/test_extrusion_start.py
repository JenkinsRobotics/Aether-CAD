"""Reference starts must change real geometry and fail without partial results."""
import math

import pytest
from aether_freecad import BuildJob, Feature, FreeCADEngine
from test_extrusion_ends import cone
from test_extrusion_point_limit import box, point


@pytest.fixture(scope='module')
def engine():
    with FreeCADEngine() as instance:
        yield instance


def reference():
    return {'kind':'face','sourceFeatureId':'box','bodyId':'stop','normal':[0,0,1]}


def job(height=10, **options):
    return BuildJob(features=box(height)+[
        Feature('s','sketch-circle',{'radius_mm':2}),
        Feature('e','pad',{'operation':'new','body_id':'result','distance_mm':5,
            'region_mode':True,'profiles':['s'],'profile_regions':['s'],
            'starting_reference':reference(),**options})],preview_feature_id='e')


def check(engine,model,volume,low,high):
    result=engine.build(model)
    assert not result.diagnostics,result.diagnostics
    body=next(b for b in result.bodies if b.id=='result')
    assert body.volume_mm3==pytest.approx(volume,rel=1e-6)
    vertices=body.vertices
    assert min(vertices[2::3])==pytest.approx(low,abs=1e-5)
    assert max(vertices[2::3])==pytest.approx(high,abs=1e-5)
    return result


@pytest.mark.parametrize('height,offset',[(10,0),(20,2),(7,-3)])
def test_face_start_follows_upstream_dimension_and_blind_depth(engine,height,offset):
    result=check(engine,job(height,starting_offset_mm=offset),20*math.pi,height+offset,height+offset+5)
    assert result.preview['added'][0]['volume_mm3']==pytest.approx(20*math.pi)


def test_reversed_and_oblique_direction_keep_axial_offset_and_depth(engine):
    check(engine,job(reversed=True,starting_offset_mm=2),20*math.pi,3,8)
    check(engine,job(direction_vector=[.6,0,.8],starting_offset_mm=2),16*math.pi,11.6,15.6)


def test_draft_retains_original_sketch_neutral(engine):
    angle=3
    check(engine,job(draft_angle_deg=angle),cone(2,15,angle)-cone(2,10,angle),10,15)


def test_independent_and_symmetric_ends_share_reference_plane(engine):
    check(engine,job(second_end={'end_type':'blind','distance_mm':3}),32*math.pi,7,15)
    check(engine,job(end_type='symmetric',distance_mm=6),24*math.pi,7,13)


def test_vertex_and_face_limits_are_absolute_after_moving_start(engine):
    check(engine,job(end_type='up-to-vertex',end_point_reference=point(25),end_offset_mm=2),52*math.pi,10,23)
    model=job(end_type='up-to-face',end_reference=reference(),starting_reference={'kind':'plane','frame':{'originMillimeters':[0,0,3],'normal':[0,0,1]}})
    check(engine,model,28*math.pi,3,10)


@pytest.mark.parametrize('operation',['add','cut','intersect'])
def test_start_on_top_face_with_result_operations_and_red_cut_preview(engine,operation):
    options={'operation':operation,'body_id':'stop'}
    if operation=='intersect':options['reversed']=True
    model=job(**options)
    result=engine.build(model)
    assert not result.diagnostics,result.diagnostics
    expected={'add':1000+20*math.pi,'cut':1000-20*math.pi,'intersect':20*math.pi}[operation]
    assert result.bodies[0].volume_mm3==pytest.approx(expected)
    if operation=='cut':assert result.preview['removed'][0]['volume_mm3']==pytest.approx(20*math.pi)


def test_through_all_cut_starts_at_reference(engine):
    result=engine.build(job(operation='cut',body_id='stop',end_type='through-all'))
    assert not result.diagnostics,result.diagnostics
    assert result.bodies[0].volume_mm3==pytest.approx(1000-40*math.pi)


@pytest.mark.parametrize('mutation',['missing','tilted','bad-normal','bad-origin','no-space','unknown','not-reference'])
def test_invalid_reference_refuses_without_partial_preview_and_recovers(engine,mutation):
    model=job()
    p=model.features[-1].parameters
    if mutation=='missing':p['starting_reference']['sourceFeatureId']='missing'
    if mutation=='tilted':p['starting_reference']['normal']=[1,0,0]
    if mutation=='bad-normal':p['starting_reference']['normal']=[0,0,2]
    if mutation=='bad-origin':p['starting_reference']={'kind':'plane','frame':{'originMillimeters':[True,0,2],'normal':[0,0,1]}}
    if mutation=='no-space':p.update(end_type='up-to-vertex',end_point_reference=point(4))
    if mutation=='unknown':p['starting_reference']['kind']='mesh'
    if mutation=='not-reference':p['starting_reference']=None
    result=engine.build(model)
    assert result.diagnostics and not any(b.id=='result' for b in result.bodies)
    assert result.preview is None
    assert engine.export(model,{'format':'step'})['status']=='error'
    assert not engine.build(job()).diagnostics


def test_native_plane_start_thin_and_step_roundtrip(engine):
    model=job(starting_reference={'kind':'plane','frame':{'originMillimeters':[0,0,-4],'normal':[0,0,-1]}},
        thin={'thickness_1_mm':1,'thickness_2_mm':0})
    result=engine.build(model)
    assert not result.diagnostics,result.diagnostics
    expected=next(b.volume_mm3 for b in result.bodies if b.id=='result')
    exported=engine.export(model,{'format':'step','body_ids':['result']})
    assert exported['status']=='ok',exported
    reopened=engine.build(BuildJob(features=[Feature('import','import-step',{'operation':'new','body_id':'imported','data_base64':exported['data_base64']})]))
    assert not reopened.diagnostics
    assert reopened.bodies[0].volume_mm3==pytest.approx(expected)


def test_unqualified_legacy_pad_cannot_ignore_a_start_reference(engine):
    result=engine.build(job(region_mode=False,profile='s'))
    assert result.diagnostics
    assert not any(body.id=='result' for body in result.bodies)


@pytest.mark.parametrize('end_type',['up-to-next','up-to-part'])
def test_body_limits_start_from_reference_plane(engine,end_type):
    model=job(starting_reference={'kind':'plane','frame':{'originMillimeters':[0,0,-4],'normal':[0,0,1]}},end_type=end_type,end_part_id='stop')
    check(engine,model,16*math.pi,-4,0)


def test_scoped_through_all_only_removes_material_beyond_reference_start(engine):
    model=job(20,operation='cut',body_id='stop',target_body_ids=['stop','other'],end_type='through-all')
    model.features[2:2]=[Feature('other-s','sketch-circle',{'radius_mm':4}),
        Feature('other','pad',{'profile':'other-s','distance_mm':30,'operation':'new','body_id':'other'})]
    result=engine.build(model)
    assert not result.diagnostics,result.diagnostics
    volumes={b.id:b.volume_mm3 for b in result.bodies}
    assert volumes['stop']==pytest.approx(2000-80*math.pi)
    assert volumes['other']==pytest.approx(400*math.pi)


def test_ambiguous_start_needs_anchor_and_changed_anchor_requires_repair(engine):
    model=job()
    model.features[2:2]=[Feature('step-s','sketch-polygon',{'points_mm':[[-5,-5],[0,-5],[0,5],[-5,5]],'offset_mm':10}),
        Feature('step','pad',{'profile':'step-s','distance_mm':5,'operation':'add','body_id':'stop'})]
    ref=model.features[-1].parameters['starting_reference'];ref['sourceFeatureId']='step'
    result=engine.build(model)
    assert result.diagnostics and 'ambiguous' in result.diagnostics[-1]['message']
    ref['faceAnchor']={'centerMillimeters':[2.5,0,10],'areaSquareMillimeters':50}
    check(engine,model,20*math.pi,10,15)
    ref['faceAnchor']['centerMillimeters'][2]=11
    result=engine.build(model)
    assert result.diagnostics and not any(b.id=='result' for b in result.bodies)
