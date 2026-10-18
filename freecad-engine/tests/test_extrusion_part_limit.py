"""Selected-part limits use solid geometry, including curved stopping surfaces."""
import math
from dataclasses import replace

import pytest
from aether_freecad import BuildJob, Feature, FreeCADEngine
from test_extrusion_ends import cone
from test_up_to_face import job


@pytest.fixture(scope='module')
def engine():
    with FreeCADEngine() as instance:
        yield instance


def planar(**options):
    model = job(**options)
    model.features[-1].parameters.update(end_type='up-to-part', end_part_id='stop')
    model.features[-1].parameters.pop('end_reference')
    return replace(model, preview_feature_id='result')


def curved(end=0, start=0, angle=0):
    return BuildJob(features=[
        Feature('stop-s', 'sketch-circle', {'radius_mm':10, 'frame':{'originMillimeters':[0,-10,20],'normal':[0,1,0],'xDirection':[1,0,0]}}),
        Feature('stop-e','pad',{'profile':'stop-s','distance_mm':20,'operation':'new','body_id':'stop'}),
        Feature('profile','sketch-polygon',{'points_mm':[[-2,-2],[2,-2],[2,2],[-2,2]]}),
        Feature('result','pad',{'body_id':'result','operation':'new','region_mode':True,'profiles':['profile'],'profile_regions':['profile'],'distance_mm':1,'end_type':'up-to-part','end_part_id':'stop','end_offset_mm':end,'starting_offset_mm':start,'draft_angle_deg':angle})],preview_feature_id='result')


@pytest.mark.parametrize('height,end_offset,start_offset',[(20,0,0),(35,2,0),(20,-2,0),(20,0,3)])
def test_selected_planar_stop_and_offsets(engine,height,end_offset,start_offset):
    model=planar(height=height,end_offset=end_offset,start_offset=start_offset)
    result=engine.build(model)
    assert not result.diagnostics,result.diagnostics
    assert result.bodies[-1].volume_mm3==pytest.approx(4*math.pi*(height-end_offset-start_offset))
    assert sum(b['volume_mm3'] for b in result.preview['added'])==pytest.approx(result.bodies[-1].volume_mm3)


@pytest.mark.parametrize('end,start',[(0,0),(2,1),(-2,0)])
def test_curved_limit_analytic_volume_and_step(engine,end,start):
    model=curved(end,start)
    result=engine.build(model)
    assert not result.diagnostics,result.diagnostics
    # Integral of z=20-sqrt(100-x²), over x,y in[-2,2], translated axially.
    expected=16*(20-end-start)-4*(2*math.sqrt(96)+100*math.asin(.2))
    body=result.bodies[-1]
    assert body.volume_mm3==pytest.approx(expected,abs=1e-5)
    exported=engine.export(model,{'format':'step','body_ids':['result']})
    assert exported['status']=='ok',exported
    reopened=engine.build(BuildJob(features=[Feature('import','import-step',{'body_id':'restored','operation':'new','data_base64':exported['data_base64']})]))
    assert not reopened.diagnostics
    assert reopened.bodies[0].volume_mm3==pytest.approx(expected,abs=1e-4)


@pytest.mark.parametrize('angle,height',[(5,20),(-5,20),(5,22.8)])
def test_drafted_stop_does_not_require_valid_tool_past_the_limit(engine,angle,height):
    model=planar(height=height)
    model.features[-1].parameters['draft_angle_deg']=angle
    result=engine.build(model)
    assert not result.diagnostics,result.diagnostics
    assert result.bodies[-1].volume_mm3==pytest.approx(cone(2,height,angle),abs=1e-5)


@pytest.mark.parametrize('mutation',['missing','partial','hole','behind','partial-start'])
def test_incomplete_or_unavailable_stop_fails_and_recovers(engine,mutation):
    model=planar()
    if mutation=='missing':model.features[-1].parameters['end_part_id']='deleted'
    elif mutation=='partial':model.features[2].parameters['center_mm']=[0,0]
    elif mutation=='behind':model.features[0].parameters['offset_mm']=-10
    elif mutation=='partial-start':model=curved(start=10.1)
    else:
        model.features[2:2]=[Feature('hole-s','sketch-circle',{'radius_mm':1,'center_mm':[10,10],'offset_mm':23}),Feature('hole','pocket',{'profile':'hole-s','depth_mm':3,'body_id':'stop','operation':'cut'})]
    result=engine.build(model)
    assert result.diagnostics and all(b.id!='result' for b in result.bodies)
    assert result.preview is None
    assert engine.export(model,{'format':'step'})['status']=='error'
    assert not engine.build(planar()).diagnostics


def test_selected_part_ignores_nearer_parts_and_tracks_current_modifiers(engine):
    model=planar(height=30)
    model.features[2:2]=[Feature('near-s','sketch-rectangle',{'width_mm':20,'height_mm':20,'offset_mm':10}),Feature('near','pad',{'profile':'near-s','distance_mm':2,'operation':'new','body_id':'other'})]
    for height in [30,40]:
        model.features[0].parameters['offset_mm']=height
        result=engine.build(model)
        assert not result.diagnostics,result.diagnostics
        assert result.bodies[-1].volume_mm3==pytest.approx(4*math.pi*height)
    # Adding material to the selected part's underside moves the actual stop.
    model.features.insert(-2,Feature('extend-stop','pad',{'profile':'limit-sketch','distance_mm':5,'operation':'add','body_id':'stop','reversed':True,'region_mode':True,'profiles':['limit-sketch'],'profile_regions':['limit-sketch']}))
    result=engine.build(model)
    assert not result.diagnostics,result.diagnostics
    assert result.bodies[-1].volume_mm3==pytest.approx(4*math.pi*35)


@pytest.mark.parametrize('operation',['new','add','cut','intersect'])
def test_oblique_direction_operations_and_offsets(engine,operation):
    model=planar(height=20,end_offset=2,start_offset=1)
    model.features[0].parameters['width_mm']=100
    model.features[-1].parameters.update(direction_vector=[.6,0,.8],operation=operation,reversed=operation=='cut')
    if operation!='new':
        model.features[:0]=[Feature('base-s','sketch-rectangle',{'width_mm':100,'height_mm':20,'offset_mm':-1}),Feature('base','pad',{'profile':'base-s','distance_mm':31 if operation!='add' else 5,'operation':'new','body_id':'base'})]
        model.features[-1].parameters['body_id']='base'
    result=engine.build(model)
    assert not result.diagnostics,result.diagnostics
    body=next(b for b in result.bodies if b.id==('result' if operation=='new' else 'base'))
    tool=4*math.pi*(20-3*.8)
    overlap=4*math.pi*(4-.8)
    # OCCT integrates the oblique trimmed circular wall numerically (sub-ppm here).
    assert body.volume_mm3==pytest.approx({'new':tool,'add':10000+tool-overlap,'cut':62000-tool,'intersect':tool}[operation],rel=1e-6)
    if operation in ('new','intersect'):
        assert max(body.vertices[2::3])==pytest.approx(18.4,abs=1e-6)
        assert min(body.vertices[2::3])==pytest.approx(.8,abs=1e-6)


def test_independent_second_part_and_draft(engine):
    model=planar(height=20,start_offset=1)
    model.features[:0]=[Feature('bottom-s','sketch-rectangle',{'width_mm':20,'height_mm':20,'offset_mm':-23}),Feature('bottom','pad',{'profile':'bottom-s','distance_mm':3,'operation':'new','body_id':'bottom'})]
    model.features[-1].parameters.update(draft_angle_deg=3,second_end={'end_type':'up-to-part','end_part_id':'bottom','distance_mm':1,'end_offset_mm':2,'draft_angle_deg':-2})
    result=engine.build(model)
    assert not result.diagnostics,result.diagnostics
    assert result.bodies[-1].volume_mm3==pytest.approx(cone(2,19,3,1)+cone(2,19,-2,-1),abs=1e-5)


def test_tilted_part_stops_against_its_real_boundary(engine):
    from test_extrusion_draft_limits import oblique_cone
    from test_up_to_face import tilted_job
    model=tilted_job(height=10,slope=.5)
    model.features[0]=Feature('limit-sketch','sketch-polygon',{'points_mm':[[-50,-50],[50,-50],[50,50],[-50,50]],'frame':model.features[0].parameters['frame']})
    model.features[-1].parameters.update(end_type='up-to-part',end_part_id='stop',draft_angle_deg=3)
    result=engine.build(model)
    assert not result.diagnostics,result.diagnostics
    assert result.bodies[-1].volume_mm3==pytest.approx(oblique_cone(2,10,3,.5),abs=1e-5)


def integral(fn,a,b,tolerance=1e-8,depth=24):
    middle=(a+b)/2
    whole=(b-a)*(fn(a)+4*fn(middle)+fn(b))/6
    left=(middle-a)*(fn(a)+4*fn((a+middle)/2)+fn(middle))/6
    right=(b-middle)*(fn(middle)+4*fn((middle+b)/2)+fn(b))/6
    if depth==0 or abs(left+right-whole)<15*tolerance:
        return left+right+(left+right-whole)/15
    return integral(fn,a,middle,tolerance/2,depth-1)+integral(fn,middle,b,tolerance/2,depth-1)


@pytest.mark.parametrize('angle',[3,-3])
def test_curved_stopping_part_with_draft_has_independent_section_integral(engine,angle):
    model=curved(angle=angle)
    result=engine.build(model)
    assert not result.diagnostics,result.diagnostics
    k=math.tan(math.radians(angle))
    a,b,c=1+k*k,-40-4*k,304
    high=(-b-math.sqrt(b*b-4*a*c))/(2*a)
    # Below the cylinder the whole tapered square remains; above z10 only its
    # outer strips remain, terminating where the cylinder meets its sides.
    expected=4*(40-200*k+1000*k*k/3)+integral(lambda z:4*(2-k*z)*max(0,2-k*z-math.sqrt(max(0,100-(20-z)**2))),10,high)
    assert result.bodies[-1].volume_mm3==pytest.approx(expected,abs=1e-5)


def test_thin_and_scoped_cut_use_selected_part_limit(engine):
    model=planar()
    model.features[2]=Feature('circle','sketch-wire',{'start_mm':[2,10],'segments':[{'type':'line','end':[18,10]}]})
    model.features[-1].parameters['thin']={'thickness_1_mm':2,'thickness_2_mm':1}
    result=engine.build(model)
    assert not result.diagnostics,result.diagnostics
    assert result.bodies[-1].volume_mm3==pytest.approx(16*3*20)
    model=planar()
    bases=[]
    for name,height in [('a',2),('b',12)]:
        bases.extend([Feature(name+'-s','sketch-rectangle',{'width_mm':20,'height_mm':20,'offset_mm':height}),Feature(name,'pad',{'profile':name+'-s','distance_mm':4,'operation':'new','body_id':name})])
    model.features[:0]=bases
    model.features[-1].parameters.update(body_id='a',target_body_ids=['a','b'],operation='cut',reversed=True)
    result=engine.build(model)
    assert not result.diagnostics,result.diagnostics
    assert [b.volume_mm3 for b in result.bodies if b.id in ['a','b']]==pytest.approx([1600-16*math.pi]*2)
    assert sum(b['volume_mm3'] for b in result.preview['removed'])==pytest.approx(32*math.pi)


@pytest.mark.parametrize('start',[20,21])
def test_profile_inside_part_stops_at_its_exit_boundary(engine,start):
    result=engine.build(planar(start_offset=start))
    assert not result.diagnostics,result.diagnostics
    assert result.bodies[-1].volume_mm3==pytest.approx(4*math.pi*(23-start))


@pytest.mark.parametrize('center,height',[([10,10],25),([50,50],20)])
def test_apex_or_tiny_cap_never_substitutes_for_real_part_contact(engine,center,height):
    model=planar(height=height,center=center)
    model.features[-1].parameters['draft_angle_deg']=5
    result=engine.build(model)
    assert result.diagnostics and result.preview is None
    assert [b.id for b in result.bodies]==['stop']
