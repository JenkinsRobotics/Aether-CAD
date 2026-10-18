"""Drafted Next checked with independent section integrals and exact roundtrips."""
import math

import pytest
from aether_freecad import BuildJob, Feature, FreeCADEngine
from test_extrusion_draft_limits import oblique_cone
from test_extrusion_next import box, next_curved, stepped
from test_extrusion_part_limit import integral
from test_up_to_face import tilted_job


@pytest.fixture(scope='module')
def engine():
    with FreeCADEngine() as instance:
        yield instance


def curved_volume(angle,low=0,end=0,height=20):
    k=math.tan(math.radians(angle));h=height-end
    a,b,c=1+k*k,-2*h-4*k,h*h-96
    high=(-b-math.sqrt(b*b-4*a*c))/(2*a)
    first=h-10
    full=lambda z:4*(4*z-2*k*z*z+k*k*z**3/3)
    return full(first)-full(low)+integral(lambda z:4*(2-k*z)*max(0,2-k*z-math.sqrt(max(0,100-(h-z)**2))),first,high)


@pytest.mark.parametrize('angle,low,end',[(3,0,0),(-3,0,0),(3,2,2),(-3,-1,-2),(5,0,-2)])
def test_curved_next_with_sketch_neutral_draft_and_signed_offsets(engine,angle,low,end):
    model=next_curved(end,low);model.features[-1].parameters['draft_angle_deg']=angle
    result=engine.build(model)
    assert not result.diagnostics,result.diagnostics
    expected=curved_volume(angle,low,end)
    assert result.bodies[-1].volume_mm3==pytest.approx(expected,abs=1e-5)
    assert sum(b['volume_mm3'] for b in result.preview['added'])==pytest.approx(expected,abs=1e-5)


@pytest.mark.parametrize('angle,height,slope,low,end',[(3,20,.5,0,0),(-3,20,.5,0,0),(3,20,2,-1,-2),(5,22.8,2,0,0),(4,15,-.5,2,3)])
def test_tilted_next_is_exact_and_does_not_need_a_tool_past_its_apex(engine,angle,height,slope,low,end):
    model=tilted_job(height=height,slope=slope,start=low,end=end)
    model.features[0]=Feature('limit-sketch','sketch-polygon',{'points_mm':[[-50,-50],[50,-50],[50,50],[-50,50]],'frame':model.features[0].parameters['frame']})
    model.features[-1].parameters.update(end_type='up-to-next',draft_angle_deg=angle)
    model.features[-1].parameters.pop('end_reference')
    result=engine.build(model)
    assert not result.diagnostics,result.diagnostics
    assert result.bodies[-1].volume_mm3==pytest.approx(oblique_cone(2,height-end,angle,slope,low),abs=1e-5)


@pytest.mark.parametrize('angle,end',[(3,0),(-3,0),(3,2),(-3,-2)])
def test_first_partial_stops_do_not_leave_material_behind_nearer_part(engine,angle,end):
    model=stepped(end=end)
    # Cover both complete tapered half-sections even with widening.
    model.features[:4]=box('near',-20,-20,5,20,40,2)+box('far',-20,-20,10,40,40,2)
    model.features[-1].parameters['draft_angle_deg']=angle
    result=engine.build(model)
    assert not result.diagnostics,result.diagnostics
    k=math.tan(math.radians(angle))
    primitive=lambda h:2*(4*h-2*k*h*h+k*k*h**3/3)
    assert result.bodies[-1].volume_mm3==pytest.approx(primitive(5-end)+primitive(10-end),abs=1e-5)


@pytest.mark.parametrize('mutation',['miss','partial','apex','offset','hole'])
def test_invalid_drafted_next_fails_without_a_partial_preview_and_recovers(engine,mutation):
    model=next_curved();model.features[-1].parameters['draft_angle_deg']=5
    if mutation=='miss':model.features[-2].parameters['points_mm']=[[40,40],[44,40],[44,44],[40,44]]
    elif mutation=='partial':model.features[1].parameters['distance_mm']=8
    elif mutation=='apex':model.features[0].parameters['frame']['originMillimeters'][2]=40
    elif mutation=='offset':model.features[-1].parameters['end_offset_mm']=12
    else:
        model=stepped();model.features[0].parameters['points_mm']=[[-2,-5],[-1,-5],[-1,5],[-2,5]]
        model.features[2].parameters['points_mm']=[[1,-5],[2,-5],[2,5],[1,5]]
        model.features[-1].parameters['draft_angle_deg']=-3
    result=engine.build(model)
    assert result.diagnostics and result.preview is None
    assert all(b.id!='result' for b in result.bodies)
    assert engine.export(model,{'format':'step'})['status']=='error'
    healthy=next_curved();healthy.features[-1].parameters['draft_angle_deg']=3
    assert not engine.build(healthy).diagnostics

@pytest.mark.parametrize('operation',['add','cut','intersect'])
def test_drafted_curved_operations_and_exact_material_preview(engine,operation):
    model=next_curved();model.features[-1].parameters['draft_angle_deg']=3
    model.features[:0]=box('base',-5,-5,0,10,10,5 if operation=='add' else 40)
    model.features[-2].parameters['offset_mm']=5 if operation=='add' else 40
    model.features[-1].parameters.update(operation=operation,body_id='base',reversed=operation=='intersect')
    result=engine.build(model)
    assert not result.diagnostics,result.diagnostics
    tool=curved_volume(3,height=15 if operation=='add' else 20)
    body=next(b for b in result.bodies if b.id=='base')
    assert body.volume_mm3==pytest.approx(500+tool if operation=='add' else 4000-tool if operation=='cut' else tool,abs=1e-5)
    if operation=='cut':assert sum(b['volume_mm3'] for b in result.preview['removed'])==pytest.approx(tool,abs=1e-5)


def test_independent_curved_ends_have_separate_tapers_and_offsets(engine):
    model=next_curved(end=1);model.features[-2].parameters['offset_mm']=20
    model.features[-1].parameters.update(draft_angle_deg=3,second_end={'end_type':'up-to-next','distance_mm':1,'draft_angle_deg':-2,'end_offset_mm':2})
    def half(angle,end):
        k=math.tan(math.radians(angle))
        return integral(lambda t:4*(2-k*t)*min(2-k*t,math.sqrt(max(0,100-(t+end)**2))),0,10-end)
    result=engine.build(model)
    assert not result.diagnostics,result.diagnostics
    assert result.bodies[-1].volume_mm3==pytest.approx(half(3,1)+half(-2,2),abs=1e-5)


def test_native_rebuild_upstream_height_and_step_exchange(engine):
    model=next_curved();model.features[-1].parameters['draft_angle_deg']=3
    for height in [20,30,20]:
        model.features[0].parameters['frame']['originMillimeters'][2]=height
        result=engine.build(model)
        assert not result.diagnostics,result.diagnostics
        assert result.bodies[-1].volume_mm3==pytest.approx(curved_volume(3,height=height),abs=1e-5)
    exported=engine.export(model,{'format':'step','body_ids':['result']})
    assert exported['status']=='ok'
    restored=engine.build(BuildJob(features=[Feature('import','import-step',{'operation':'new','body_id':'result','data_base64':exported['data_base64']})]))
    assert not restored.diagnostics
    assert restored.bodies[0].volume_mm3==pytest.approx(curved_volume(3),abs=1e-5)


@pytest.mark.parametrize('reverse',[False,True])
def test_coincident_start_skips_starting_face_in_either_direction(engine,reverse):
    model=stepped(far=False)
    model.features[:2]=box('near',-20,-20,5,40,40,2)
    model.features[-2].parameters['offset_mm']=7 if reverse else 5
    model.features[-1].parameters.update(draft_angle_deg=3,reversed=reverse)
    result=engine.build(model)
    assert not result.diagnostics,result.diagnostics
    k=math.tan(math.radians(3))
    assert result.bodies[-1].volume_mm3==pytest.approx(4*(8-8*k+8*k*k/3),abs=1e-5)


@pytest.mark.parametrize('angle',[3,-3])
def test_thin_wall_curved_next_preserves_exact_drafted_thickness(engine,angle):
    model=next_curved()
    model.features[-2]=Feature('profile','sketch-wire',{'start_mm':[-2,0],'segments':[{'type':'line','end':[2,0]}]})
    model.features[-1].parameters.update(draft_angle_deg=angle,thin={'thickness_1_mm':1,'thickness_2_mm':1})
    result=engine.build(model)
    assert not result.diagnostics,result.diagnostics
    k=math.tan(math.radians(angle));h=20
    a,b,c=1+k*k,-2*h-4*k,h*h-96
    high=(-b-math.sqrt(b*b-4*a*c))/(2*a)
    expected=integral(lambda z:4*(2-k*z)*(1-k*z),0,10)+integral(lambda z:4*(1-k*z)*max(0,2-k*z-math.sqrt(max(0,100-(h-z)**2))),10,high)
    assert result.bodies[-1].volume_mm3==pytest.approx(expected,abs=1e-5)


@pytest.mark.parametrize('angle',[2,-2])
def test_annular_draft_stops_on_exact_sphere_without_losing_hole(engine,angle):
    model=BuildJob(features=[
        Feature('sphere-profile','sketch-wire',{'plane':'XZ','start_mm':[0,10],'segments':[{'type':'arc','middle':[10,20],'end':[0,30]},{'type':'line','end':[0,10]}]}),
        Feature('sphere','revolve',{'profile':'sphere-profile','operation':'new','body_id':'sphere','axis':'Z','angle_deg':360}),
        Feature('outer','sketch-circle',{'radius_mm':3}),Feature('inner','sketch-circle',{'radius_mm':1}),
        Feature('e','pad',{'region_mode':True,'profiles':['outer'],'profile_regions':['outer','inner'],'operation':'new','body_id':'result','end_type':'up-to-next','distance_mm':1,'draft_angle_deg':angle})])
    k=math.tan(math.radians(angle))
    def crossing(radius,slope):
        a,b,c=1+slope*slope,-40+2*radius*slope,300+radius*radius
        return (-b-math.sqrt(b*b-4*a*c))/(2*a)
    first=crossing(1,k);last=crossing(3,-k)
    expected=integral(lambda z:math.pi*((3-k*z)**2-(1+k*z)**2),0,first)+integral(lambda z:math.pi*max(0,(3-k*z)**2-(100-(20-z)**2)),first,last)
    result=engine.build(model)
    assert not result.diagnostics,result.diagnostics
    assert result.bodies[-1].volume_mm3==pytest.approx(expected,abs=1e-5)
