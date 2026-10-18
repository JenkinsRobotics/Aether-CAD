"""Face edits must match intended native supporting surfaces and independent solids."""
import math

import pytest
from aether_freecad import BuildJob, Feature, FreeCADEngine


@pytest.fixture(scope='module')
def engine():
    with FreeCADEngine() as value:
        yield value


def ref(normal, source='base', body='body'):
    return {'sourceFeatureId':source,'bodyId':body,'normal':normal,'label':'Face'}


def model(transform, refs=None, height=5):
    return BuildJob(features=[Feature('s','sketch-rectangle',{'width_mm':10,'height_mm':20}),
        Feature('base','pad',{'profile':'s','distance_mm':height,'operation':'new','body_id':'body'}),
        Feature('move','offset-face',{'faces':refs or [ref([0,0,1])],'transform':transform})], preview_feature_id='move')


def bounds(body):
    return [min(body.vertices[i::3]) for i in range(3)]+[max(body.vertices[i::3]) for i in range(3)]


def rotate(angle, origin=None, axis=None):
    return {'kind':'rotate','axisOriginMillimeters':origin or [5,10,5],'axisDirection':axis or [1,0,0],'angleDegrees':angle}


def translate(delta):
    return {'kind':'translate','translationMillimeters':delta}


def valid(engine, job):
    result=engine.build(job)
    assert not result.diagnostics,result.diagnostics
    assert result.preview['transform_frame']['resolved_transform']['kind'] in ('rotate','translate')
    assert [b.id for b in result.bodies]==['body']
    assert engine.export(job,{'format':'step'})['status']=='ok'
    return result


@pytest.mark.parametrize('delta',[[2,0,3],[-2,0,-1],[2,3,-1]])
def test_adjacent_planar_faces_translate_by_different_signed_offsets(engine,delta):
    job=model(translate(delta),[ref([1,0,0]),ref([0,0,1])]);r=valid(engine,job)
    expected=[0,0,0,10+delta[0],20,5+delta[2]]
    assert bounds(r.bodies[0])==pytest.approx(expected,abs=1e-6)
    assert r.bodies[0].volume_mm3==pytest.approx((10+delta[0])*20*(5+delta[2]))


@pytest.mark.parametrize('angle',[-20,-10,10,20])
def test_rotated_top_heals_four_neighbors_with_exact_wedge_preview(engine,angle):
    r=valid(engine,model(rotate(angle)))
    rise=10*math.tan(math.radians(abs(angle)))
    assert bounds(r.bodies[0])==pytest.approx([0,0,0,10,20,5+rise],abs=1e-6)
    assert r.bodies[0].volume_mm3==pytest.approx(1000,abs=1e-6)
    assert sum(b['volume_mm3'] for b in r.preview['added'])==pytest.approx(50*rise,abs=1e-6)
    assert sum(b['volume_mm3'] for b in r.preview['removed'])==pytest.approx(50*rise,abs=1e-6)


@pytest.mark.parametrize('height',[5,8,12])
def test_reference_face_rotation_follows_upstream_dimensions(engine,height):
    t=rotate(10,origin=[0,0,5]);r=valid(engine,model(t,height=height))
    # Rotating plane z=height about x through z=5 shifts its Y=0 intercept.
    intercept=5+(height-5)/math.cos(math.radians(10))
    assert r.bodies[0].volume_mm3==pytest.approx(200*(intercept+10*math.tan(math.radians(10))),abs=1e-5)


def test_translation_preserves_and_extends_conical_neighbors(engine):
    job=model(translate([7,0,2]),height=10)
    job.features[0]=Feature('s','sketch-circle',{'radius_mm':10})
    job.features[1].parameters.update(region_mode=True,profiles=['s'],profile_regions=['s'],draft_angle_deg=math.degrees(math.atan(.5)))
    r=valid(engine,job);h=12
    assert r.bodies[0].volume_mm3==pytest.approx(math.pi*(100*h-5*h*h+h**3/12),abs=1e-5)


def test_rotated_planar_cap_keeps_cylindrical_wall_exact(engine):
    job=model(rotate(15,origin=[0,0,5]))
    job.features[0]=Feature('s','sketch-circle',{'radius_mm':5})
    r=valid(engine,job)
    assert r.bodies[0].volume_mm3==pytest.approx(125*math.pi,abs=1e-5)
    assert max(r.bodies[0].vertices[2::3])==pytest.approx(5+5*math.tan(math.radians(15)),abs=.02)


@pytest.mark.parametrize('bad',[translate([0,0,-20]),translate([3,0,0]),rotate(80),rotate(180),{'kind':'scale','scaleFactors':[2,2,2]},translate([True,0,1])])
def test_invalid_motion_preserves_original_and_refuses_export(engine,bad):
    job=model(bad);r=engine.build(job)
    assert r.diagnostics and r.preview is None
    assert bounds(r.bodies[0])==pytest.approx([0,0,0,10,20,5])
    assert engine.export(job,{'format':'step'})['status']=='error'


def test_curved_subset_is_refused_with_actionable_reason(engine):
    job=model(translate([1,0,0]),[{'sourceFeatureId':'base','bodyId':'body','surfaceType':'cylinder','label':'Wall'}])
    job.features[0]=Feature('s','sketch-circle',{'radius_mm':5})
    r=engine.build(job);assert r.diagnostics and 'Curved-face relocation' in r.diagnostics[-1]['message']
    assert r.bodies[0].volume_mm3==pytest.approx(125*math.pi)


def test_all_cylinder_faces_can_move_as_rigid_native_surfaces(engine):
    job=model(translate([2,3,4]),[ref([0,0,1]),ref([0,0,-1]),{'sourceFeatureId':'base','bodyId':'body','surfaceType':'cylinder','label':'Wall'}])
    job.features[0]=Feature('s','sketch-circle',{'radius_mm':5});r=valid(engine,job)
    assert r.bodies[0].volume_mm3==pytest.approx(125*math.pi)
    assert min(r.bodies[0].vertices[2::3])==pytest.approx(4)


def test_referenced_edge_drives_face_rotation_and_native_frame(engine):
    job=model(rotate(10));base=engine.build(BuildJob(features=job.features[:2]))
    edge=next(c for f in base.bodies[0].topology for c in f['candidates'] if c.get('edgeAnchor') and all(a['positionMillimeters'][1:]==[0,5] for a in c['edgeAnchor'].values()))
    job.features[-1].parameters['transform']={'kind':'rotate-reference','reference':{'kind':'solid-edge','sourceFeatureId':'base','bodyId':'body','label':'Top edge','anchor':edge['edgeAnchor']},'angleDegrees':5}
    r=valid(engine,job)
    assert r.preview['transform_frame']['center_mm']==pytest.approx([5,10,5])
    assert r.bodies[0].volume_mm3!=pytest.approx(1000)


def test_multi_part_failure_is_atomic(engine):
    job=model(translate([0,0,-6]),height=10)
    job.features[2:2]=[Feature('short','pad',{'profile':'s','distance_mm':5,'operation':'new','body_id':'short'})]
    job.features[-1].parameters['faces'].append(ref([0,0,1],source='short',body='short'))
    r=engine.build(job);assert r.diagnostics
    assert [b.volume_mm3 for b in r.bodies]==pytest.approx([2000,1000])
    assert engine.export(job,{'format':'step'})['status']=='error'


@pytest.mark.parametrize('mode',['translate','rotate'])
def test_step_imported_planar_faces_have_same_exact_edits(engine,mode):
    source=BuildJob(features=model(translate([0,0,1])).features[:2])
    exported=engine.export(source,{'format':'step'})
    job=model(translate([0,0,2]) if mode=='translate' else rotate(10))
    job.features[:2]=[Feature('base','import-step',{'data_base64':exported['data_base64'],'operation':'new','body_id':'body'})]
    r=valid(engine,job);assert r.bodies[0].volume_mm3==pytest.approx(1400 if mode=='translate' else 1000,abs=1e-6)
    again=engine.export(job,{'format':'step'})
    reopened=engine.build(BuildJob(features=[Feature('import','import-step',{'data_base64':again['data_base64'],'operation':'new','body_id':'body'})]))
    assert not reopened.diagnostics
    assert reopened.bodies[0].volume_mm3==pytest.approx(r.bodies[0].volume_mm3,abs=1e-6)


def test_two_rotated_neighbors_share_healed_edges(engine):
    job=model(rotate(10,origin=[5,10,2.5],axis=[0,1,0]),[ref([0,0,1]),ref([1,0,0])])
    r=valid(engine,job)
    assert r.bodies[0].volume_mm3>0
    # Analytic wedge clipped by unchanged x=0,z=0 planes.
    a=math.radians(10);c,s=math.cos(a),math.sin(a)
    # New top: s*x+c*z=5*s+2.5*c+2.5; new right: c*x-s*z=5*c-2.5*s+5.
    top=5*s+2.5*c+2.5;right=5*c-2.5*s+5
    polygon=[(0,0),(right/c,0),(c*right+s*top,-s*right+c*top),(0,top/c)]
    area=abs(sum(x*polygon[(i+1)%4][1]-y*polygon[(i+1)%4][0] for i,(x,y) in enumerate(polygon)))/2
    assert r.bodies[0].volume_mm3==pytest.approx(area*20,abs=1e-5)


def test_rotated_cap_preserves_through_hole_and_inner_cylindrical_surface(engine):
    job=model(rotate(10))
    job.features[2:2]=[Feature('hs','sketch-circle',{'radius_mm':2,'center_mm':[5,10],'offset_mm':5}),Feature('hole','pocket',{'profile':'hs','depth_mm':5,'body_id':'body','operation':'cut'})]
    job.features[-1].parameters['faces']=[ref([0,0,1],source='hole')]
    r=valid(engine,job)
    assert r.bodies[0].volume_mm3==pytest.approx(1000-20*math.pi,abs=1e-5)
