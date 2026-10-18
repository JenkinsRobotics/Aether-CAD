"""First-boundary extents checked against independent exact volume formulas."""
import math
from dataclasses import replace

import pytest
from aether_freecad import BuildJob, Feature, FreeCADEngine
from test_extrusion_part_limit import curved
from test_up_to_face import tilted_job


@pytest.fixture(scope='module')
def engine():
    with FreeCADEngine() as value:
        yield value


def next_curved(end=0, start=0):
    model=curved(end,start)
    model.features[-1].parameters.update(end_type='up-to-next')
    model.features[-1].parameters.pop('end_part_id')
    return model


def box(identity,x,y,z,width,height,depth):
    return [Feature(identity+'-s','sketch-polygon',{'points_mm':[[x,y],[x+width,y],[x+width,y+height],[x,y+height]],'offset_mm':z}),
            Feature(identity,'pad',{'profile':identity+'-s','distance_mm':depth,'operation':'new','body_id':identity})]


def stepped(*,far=True,split=False,end=0):
    features=box('near',-2,-5,5,2,10,2)
    if far:features+=box('far',0 if split else -5,-5,10,2 if split else 10,10,2)
    features += [Feature('profile','sketch-polygon',{'points_mm':[[-2,-2],[2,-2],[2,2],[-2,2]]}),
        Feature('result','pad',{'body_id':'result','operation':'new','region_mode':True,'profiles':['profile'],'profile_regions':['profile'],'distance_mm':1,'end_type':'up-to-next','end_offset_mm':end})]
    return BuildJob(features=features,preview_feature_id='result')


def build(engine,model):
    result=engine.build(model)
    assert not result.diagnostics,result.diagnostics
    return result


@pytest.mark.parametrize('offset,start',[(0,0),(2,1),(-2,0),(0,20),(2,20),(-2,20)])
def test_cylinder_entry_exit_and_signed_offsets(engine,offset,start):
    model=next_curved(offset,start)
    integral=4*(2*math.sqrt(96)+100*math.asin(.2))
    expected=16*(20-offset-start)+(-integral if start<10 else integral)
    result=build(engine,model)
    assert result.bodies[-1].volume_mm3==pytest.approx(expected,abs=1e-5)
    assert sum(b['volume_mm3'] for b in result.preview['added'])==pytest.approx(expected,abs=1e-5)
    assert result.preview['extrusion_axes']==[]


@pytest.mark.parametrize('split',[False,True])
@pytest.mark.parametrize('offset',[0,2,-2])
def test_multiple_faces_stop_different_profile_portions_at_first_encounter(engine,split,offset):
    result=build(engine,stepped(split=split,end=offset))
    # Near half stops at5, other half at10. Nothing remains behind near thickness2.
    assert result.bodies[-1].volume_mm3==pytest.approx(8*(5-offset)+8*(10-offset))
    assert max(result.bodies[-1].vertices[2::3])==pytest.approx(10-offset)


@pytest.mark.parametrize('mutation',['partial','hole','behind','too-far-offset','no-solid'])
def test_incomplete_next_is_an_error_and_never_a_partial_result(engine,mutation):
    model=stepped(far=mutation!='partial')
    if mutation=='hole':
        model.features[4:4]=[Feature('hole-s','sketch-circle',{'radius_mm':.5,'center_mm':[1,0],'offset_mm':12}),Feature('hole','pocket',{'profile':'hole-s','depth_mm':2,'operation':'cut','body_id':'far'})]
    elif mutation=='behind':
        model.features[-2].parameters['offset_mm']=30
    elif mutation=='too-far-offset':model.features[-1].parameters['end_offset_mm']=6
    elif mutation=='no-solid':model=replace(model,features=model.features[-2:])
    result=engine.build(model)
    assert result.diagnostics and result.preview is None
    assert all(body.id!='result' for body in result.bodies)
    assert engine.export(model,{'format':'step'})['status']=='error'
    assert not engine.build(stepped()).diagnostics


@pytest.mark.parametrize('height,slope,offset',[(10,.5,0),(20,-.5,2),(10,.5,-2)])
def test_tilted_next_uses_actual_surface_and_tracks_height(engine,height,slope,offset):
    model=tilted_job(height=height,slope=slope)
    model.features[0]=Feature('limit-sketch','sketch-polygon',{'points_mm':[[-50,-50],[50,-50],[50,50],[-50,50]],'frame':model.features[0].parameters['frame']})
    model.features[-1].parameters.update(end_type='up-to-next',end_offset_mm=offset)
    model.features[-1].parameters.pop('end_reference')
    assert build(engine,model).bodies[-1].volume_mm3==pytest.approx(4*math.pi*(height-offset),abs=1e-5)


def test_start_on_face_uses_next_exit_and_reversal(engine):
    model=stepped(far=False)
    model.features[0].parameters['points_mm']=[[-5,-5],[5,-5],[5,5],[-5,5]]
    model.features[-2].parameters['offset_mm']=5
    assert build(engine,model).bodies[-1].volume_mm3==pytest.approx(32)
    model.features[-2].parameters['offset_mm']=7
    model.features[-1].parameters['reversed']=True
    assert build(engine,model).bodies[-1].volume_mm3==pytest.approx(32)


def test_first_stop_follows_upstream_moves_and_ignores_farther_geometry(engine):
    model=next_curved()
    for height in [20,35,20]:
        model.features[0].parameters['frame']['originMillimeters'][2]=height
        expected=16*height-4*(2*math.sqrt(96)+100*math.asin(.2))
        assert build(engine,model).bodies[-1].volume_mm3==pytest.approx(expected,abs=1e-5)
    model.features[2:2]=box('closer',-5,-5,5,10,10,1)
    assert build(engine,model).bodies[-1].volume_mm3==pytest.approx(80)


def test_native_step_export_reimport_preserves_stepped_termination(engine):
    model=stepped(split=True,end=-2)
    export=engine.export(model,{'format':'step','body_ids':['result']})
    assert export['status']=='ok'
    model=BuildJob(features=[Feature('import','import-step',{'operation':'new','body_id':'restored','data_base64':export['data_base64']})])
    result=build(engine,model)
    assert result.bodies[0].volume_mm3==pytest.approx(152,abs=1e-5)

@pytest.mark.parametrize('operation',['add','cut','intersect'])
def test_operations_use_exact_first_boundary_material_preview(engine,operation):
    model=next_curved()
    model.features[:0]=box('base',-5,-5,0,10,10,5 if operation=='add' else 40)
    model.features[-2].parameters['offset_mm']=5 if operation=='add' else 40
    model.features[-1].parameters.update(operation=operation,body_id='base',reversed=operation=='intersect')
    result=build(engine,model)
    integral=4*(2*math.sqrt(96)+100*math.asin(.2))
    tool=16*(15 if operation=='add' else 20)-integral
    target=next(b for b in result.bodies if b.id=='base')
    assert target.volume_mm3==pytest.approx(500+tool if operation=='add' else 4000-tool if operation=='cut' else tool,abs=1e-5)
    if operation=='cut':assert sum(b['volume_mm3'] for b in result.preview['removed'])==pytest.approx(tool,abs=1e-5)
    if operation=='add':assert sum(b['volume_mm3'] for b in result.preview['added'])==pytest.approx(tool,abs=1e-5)


def test_both_curved_ends_and_thin_profiles(engine):
    model=next_curved(start=20)
    model.features[-1].parameters['second_end']={'end_type':'up-to-next','distance_mm':1,'end_offset_mm':2}
    integral=4*(2*math.sqrt(96)+100*math.asin(.2))
    assert build(engine,model).bodies[-1].volume_mm3==pytest.approx(2*integral-32,abs=1e-5)
    model=next_curved()
    model.features[-2]=Feature('profile','sketch-wire',{'start_mm':[-2,0],'segments':[{'type':'line','end':[2,0]}]})
    model.features[-1].parameters['thin']={'thickness_1_mm':1,'thickness_2_mm':1}
    assert build(engine,model).bodies[-1].volume_mm3==pytest.approx((320-integral)/2,abs=1e-5)


def test_oblique_next_preserves_axial_offset_units(engine):
    model=stepped(far=False)
    model.features[0].parameters['points_mm']=[[-20,-20],[20,-20],[20,20],[-20,20]]
    model.features[-1].parameters.update(direction_vector=[.6,0,.8],starting_offset_mm=1,end_offset_mm=2)
    result=build(engine,model)
    assert result.bodies[-1].volume_mm3==pytest.approx(16*(5-.8*3))
    assert min(result.bodies[-1].vertices[2::3])==pytest.approx(.8)
    assert max(result.bodies[-1].vertices[2::3])==pytest.approx(3.4)


def test_spherical_stop_and_step_preserve_exact_first_surface(engine):
    model=BuildJob(features=[
        Feature('sphere-profile','sketch-wire',{'plane':'XZ','start_mm':[0,10],'segments':[{'type':'arc','middle':[10,20],'end':[0,30]},{'type':'line','end':[0,10]}]}),
        Feature('sphere','revolve',{'profile':'sphere-profile','operation':'new','body_id':'sphere','axis':'Z','angle_deg':360}),
        Feature('circle','sketch-circle',{'radius_mm':2}),
        Feature('e','pad',{'region_mode':True,'profiles':['circle'],'profile_regions':['circle'],'operation':'new','body_id':'result','end_type':'up-to-next','distance_mm':1})])
    expected=math.pi*4*20-2*math.pi/3*(1000-96**1.5)
    assert build(engine,model).bodies[-1].volume_mm3==pytest.approx(expected,abs=1e-5)
    exported=engine.export(model,{'format':'step','body_ids':['result']})
    assert exported['status']=='ok'
    restored=BuildJob(features=[Feature('import','import-step',{'body_id':'result','operation':'new','data_base64':exported['data_base64']})])
    assert build(engine,restored).bodies[0].volume_mm3==pytest.approx(expected,abs=1e-5)
