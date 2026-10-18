"""Actual selected vertices and sketch points terminate exact native tools."""
import math
from dataclasses import replace

import pytest
from aether_freecad import BuildJob, Feature, FreeCADEngine
from test_extrusion_ends import cone


@pytest.fixture(scope='module')
def engine():
    with FreeCADEngine() as instance:
        yield instance


def point(z=20, x=50):
    return {'kind':'sketch-point','local_point':[x,3],'frame':{'originMillimeters':[0,0,z],'normal':[0,0,1],'xDirection':[1,0,0]}}


def job(z=20, **options):
    return BuildJob(features=[Feature('s','sketch-circle',{'radius_mm':2}),
        Feature('e','pad',{'operation':'new','body_id':'result','distance_mm':1,
            'region_mode':True,'profiles':['s'],'profile_regions':['s'],
            'end_type':'up-to-vertex','end_point_reference':point(z),**options})],preview_feature_id='e')


@pytest.mark.parametrize('height,start,end',[(20,0,0),(30,3,2),(20,-2,-3)])
def test_point_stops_at_parallel_plane_not_radial_distance(engine,height,start,end):
    model=job(height,starting_offset_mm=start,end_offset_mm=end)
    result=engine.build(model)
    assert not result.diagnostics,result.diagnostics
    assert result.bodies[0].volume_mm3==pytest.approx(4*math.pi*(height-start-end))
    assert result.preview['added'][0]['volume_mm3']==pytest.approx(result.bodies[0].volume_mm3)
    exported=engine.export(model,{'format':'step'})
    assert exported['status']=='ok',exported
    reopened=engine.build(BuildJob(features=[Feature('import','import-step',{'operation':'new','body_id':'solid','data_base64':exported['data_base64']})]))
    assert not reopened.diagnostics
    assert reopened.bodies[0].volume_mm3==pytest.approx(result.bodies[0].volume_mm3)


@pytest.mark.parametrize('angle',[5,-5])
def test_point_draft_and_independent_opposite_end(engine,angle):
    model=job(20,draft_angle_deg=angle,second_end={'end_type':'up-to-vertex','distance_mm':1,'end_point_reference':point(-8),'end_offset_mm':2,'draft_angle_deg':-angle})
    result=engine.build(model)
    assert not result.diagnostics,result.diagnostics
    assert result.bodies[0].volume_mm3==pytest.approx(cone(2,20,angle)+cone(2,6,-angle))


def test_oblique_point_and_axial_offsets(engine):
    result=engine.build(job(20,direction_vector=[.6,0,.8],starting_offset_mm=2,end_offset_mm=3))
    assert not result.diagnostics,result.diagnostics
    assert result.bodies[0].volume_mm3==pytest.approx(4*math.pi*(20-5*.8),rel=1e-6)


def box(height=20,width=10):
    return [Feature('box-s','sketch-polygon',{'points_mm':[[-width/2,-5],[width/2,-5],[width/2,5],[-width/2,5]]}),
        Feature('box','pad',{'profile':'box-s','distance_mm':height,'body_id':'stop','operation':'new'})]


def top_anchor(engine,source):
    built=engine.build(BuildJob(features=source))
    assert not built.diagnostics,built.diagnostics
    candidates=[c for f in built.bodies[0].topology for c in f['candidates'] if c['kind']=='vertex']
    chosen=max(candidates,key=lambda c:tuple(c['origin'][i] for i in [2,0,1]))
    assert chosen['vertexAnchor']
    return {'kind':'solid-vertex','sourceFeatureId':source[-1].id,'bodyId':'stop','anchor':chosen['vertexAnchor']}


def test_solid_vertex_follows_dimension_changes_and_survives_rebuild(engine):
    reference=top_anchor(engine,box())
    for height,width in [(20,10),(32,14),(12,5),(20,10)]:
        model=job(end_point_reference=reference)
        model=replace(model,features=box(height,width)+model.features)
        result=engine.build(model)
        assert not result.diagnostics,result.diagnostics
        assert result.bodies[-1].volume_mm3==pytest.approx(4*math.pi*height)


def test_cylinder_vertex_follows_length_and_radius(engine):
    source=[Feature('circle','sketch-circle',{'radius_mm':5}),Feature('cylinder','pad',{'profile':'circle','distance_mm':20,'operation':'new','body_id':'stop'})]
    reference=top_anchor(engine,source)
    source[0].parameters['radius_mm']=8
    source[1].parameters['distance_mm']=27
    model=job(end_point_reference=reference)
    result=engine.build(replace(model,features=source+model.features))
    assert not result.diagnostics,result.diagnostics
    assert result.bodies[-1].volume_mm3==pytest.approx(4*math.pi*27)


@pytest.mark.parametrize('mutation',['missing-source','signature','point-behind','point-at-start','offset-too-large','bad-frame','bad-point'])
def test_missing_invalid_or_empty_limit_fails_atomically_and_recovers(engine,mutation):
    model=job()
    params=model.features[-1].parameters
    if mutation=='missing-source':params['end_point_reference']={'kind':'solid-vertex','sourceFeatureId':'missing','bodyId':'stop'}
    elif mutation=='signature':
        ref=top_anchor(engine,box());ref['anchor']['signature']='changed'
        params['end_point_reference']=ref;model=replace(model,features=box()+model.features)
    elif mutation=='point-behind':params['end_point_reference']=point(-3)
    elif mutation=='point-at-start':params['starting_offset_mm']=20
    elif mutation=='offset-too-large':params['end_offset_mm']=21
    elif mutation=='bad-frame':params['end_point_reference']['frame']['normal']=[0,0,2]
    else:params['end_point_reference']['local_point']=[True,2]
    result=engine.build(model)
    assert result.diagnostics and not any(b.id=='result' for b in result.bodies)
    assert result.preview is None
    assert engine.export(model,{'format':'step'})['status']=='error'
    assert not engine.build(job()).diagnostics


@pytest.mark.parametrize('operation',['add','cut','intersect'])
def test_point_result_operations(engine,operation):
    model=job(8,operation=operation,body_id='stop',reversed=operation=='cut')
    result=engine.build(replace(model,features=box(5 if operation=='add' else 20)+model.features))
    assert not result.diagnostics,result.diagnostics
    expected=500+12*math.pi if operation=='add' else 2000-32*math.pi if operation=='cut' else 32*math.pi
    assert result.bodies[0].volume_mm3==pytest.approx(expected)
    if operation=='cut':assert result.preview['removed'][0]['volume_mm3']==pytest.approx(32*math.pi)


def test_ambiguous_changed_source_requires_repair_never_nearest_vertex(engine):
    source=[Feature('a','sketch-circle',{'radius_mm':3,'center_mm':[-10,0]}),
        Feature('b','sketch-circle',{'radius_mm':3,'center_mm':[10,0]}),
        Feature('twins','pad',{'region_mode':True,'profiles':['a','b'],'profile_regions':['a','b'],'distance_mm':20,'operation':'new','body_id':'stop'})]
    reference=top_anchor(engine,source)
    model=job(end_point_reference=reference)
    assert not engine.build(replace(model,features=source+model.features)).diagnostics
    for feature in source[:2]:feature.parameters['radius_mm']=4
    failed=engine.build(replace(model,features=source+model.features))
    assert failed.diagnostics and 'ambiguous' in failed.diagnostics[-1]['message']
    assert failed.preview is None
    model.features[-1].parameters['end_point_reference']=top_anchor(engine,source)
    assert not engine.build(replace(model,features=source+model.features)).diagnostics


def test_supported_sketch_point_tracks_current_native_face_not_cached_frame(engine):
    reference=point(999)
    reference['support']={'sourceFeatureId':'box','bodyId':'stop','normal':[0,0,1],'xDirection':[1,0,0]}
    for height in [10,28]:
        model=job(end_point_reference=reference)
        result=engine.build(replace(model,features=box(height)+model.features))
        assert not result.diagnostics,result.diagnostics
        assert result.bodies[-1].volume_mm3==pytest.approx(4*math.pi*height)


def test_thin_and_reversed_point_limits(engine):
    model=job(-10,reversed=True,thin={'thickness_1_mm':1,'thickness_2_mm':.5})
    result=engine.build(model)
    assert not result.diagnostics,result.diagnostics
    assert result.bodies[-1].volume_mm3==pytest.approx(math.pi*(3**2-1.5**2)*10)


def test_vertex_cut_respects_explicit_multiple_part_scope(engine):
    source=[]
    for name,z in [('a',0),('b',12)]:
        source.extend([Feature(name+'s','sketch-polygon',{'points_mm':[[-5,-5],[5,-5],[5,5],[-5,5]],'offset_mm':z}),
            Feature(name,'pad',{'profile':name+'s','distance_mm':5,'operation':'new','body_id':name})])
    model=job(15,operation='cut',body_id='a',target_body_ids=['a','b'],reversed=True)
    result=engine.build(replace(model,features=source+model.features))
    assert not result.diagnostics,result.diagnostics
    assert [b.id for b in result.bodies]==['a','b']
    assert [b.volume_mm3 for b in result.bodies]==pytest.approx([500-20*math.pi,500-12*math.pi])


def test_symmetric_rotation_cannot_retarget_a_corner_by_world_geometry(engine):
    source=box()
    reference=top_anchor(engine,source)
    source[0].parameters['frame']={'originMillimeters':[0,0,0],'normal':[0,0,1],'xDirection':[0,1,0]}
    model=job(end_point_reference=reference)
    result=engine.build(replace(model,features=source+model.features))
    assert result.diagnostics and 'changed or is ambiguous' in result.diagnostics[-1]['message']
    assert result.preview is None
    model.features[-1].parameters['end_point_reference']=top_anchor(engine,source)
    repaired=engine.build(replace(model,features=source+model.features))
    assert not repaired.diagnostics,repaired.diagnostics
    assert repaired.bodies[-1].volume_mm3==pytest.approx(80*math.pi)
