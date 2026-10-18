"""Underlying curved face limits checked with independent volume integrals."""
import math

import pytest
from aether_freecad import BuildJob, Feature, FreeCADEngine
from test_extrusion_drafted_next import curved_volume
from test_extrusion_next import next_curved


@pytest.fixture(scope='module')
def engine():
    with FreeCADEngine() as instance:
        yield instance


def cylinder(angle=0, end=0, low=0, height=20):
    model=next_curved(end,low)
    # The actual trimmed face is nowhere over the extruded profile.
    model.features[0].parameters['frame']['originMillimeters']=[0,30,height]
    model.features[1].parameters['distance_mm']=1
    model.features[-1].parameters.update(end_type='up-to-face',draft_angle_deg=angle,
        end_reference={'sourceFeatureId':'stop-e','bodyId':'stop','surfaceType':'cylinder','label':'Cylinder surface'})
    return model


@pytest.mark.parametrize('angle,end,low,height',[(0,0,0,20),(0,2,1,20),(0,-2,-1,20),(3,0,0,20),(-3,2,0,20),(5,-2,1,20),(5,0,0,30)])
def test_infinite_cylinder_beyond_trimmed_edges_with_draft_and_signed_offsets(engine,angle,end,low,height):
    model=cylinder(angle,end,low,height)
    result=engine.build(model)
    assert not result.diagnostics,result.diagnostics
    expected=curved_volume(angle,low,end,height)
    assert result.bodies[-1].volume_mm3==pytest.approx(expected,abs=1e-5)
    assert sum(b['volume_mm3'] for b in result.preview['added'])==pytest.approx(expected,abs=1e-5)


@pytest.mark.parametrize('angle',[0,3,-3])
def test_explicit_curved_reference_follows_source_height(engine,angle):
    model=cylinder(angle)
    for height in [20,25,20]:
        model.features[0].parameters['frame']['originMillimeters'][2]=height
        result=engine.build(model)
        assert not result.diagnostics,result.diagnostics
        assert result.bodies[-1].volume_mm3==pytest.approx(curved_volume(angle,height=height),abs=1e-5)
    exported=engine.export(model,{'format':'step','body_ids':['result']})
    assert exported['status']=='ok'
    restored=engine.build(BuildJob(features=[Feature('import','import-step',{'operation':'new','body_id':'result','data_base64':exported['data_base64']})]))
    assert not restored.diagnostics
    assert restored.bodies[0].volume_mm3==pytest.approx(curved_volume(angle),abs=1e-5)


@pytest.mark.parametrize('mutation',['missing','wrong-type','changed-anchor','miss','partial','offset','apex'])
def test_invalid_reference_or_incomplete_surface_never_publishes_partial_geometry(engine,mutation):
    model=cylinder(5 if mutation=='apex' else 0)
    p=model.features[-1].parameters
    if mutation=='missing':p['end_reference']['sourceFeatureId']='gone'
    elif mutation=='wrong-type':p['end_reference']['surfaceType']='sphere'
    elif mutation=='changed-anchor':p['end_reference']['faceAnchor']={'centerMillimeters':[0,0,0],'areaSquareMillimeters':1}
    elif mutation in ('miss','partial'):
        x=40 if mutation=='miss' else 9
        model.features[-2].parameters['points_mm']=[[x,-2],[x+4,-2],[x+4,2],[x,2]]
    elif mutation=='offset':p['end_offset_mm']=12
    else:model.features[0].parameters['frame']['originMillimeters'][2]=40
    result=engine.build(model)
    assert result.diagnostics and result.preview is None
    assert all(b.id!='result' for b in result.bodies)
    assert engine.export(model,{'format':'step'})['status']=='error'
    assert not engine.build(cylinder()).diagnostics


def test_native_face_reference_tracks_radius_changes(engine):
    model=cylinder()
    for radius in [10,12,10]:
        model.features[0].parameters['radius_mm']=radius
        result=engine.build(model)
        assert not result.diagnostics,result.diagnostics
        expected=320-4*(2*math.sqrt(radius*radius-4)+radius*radius*math.asin(2/radius))
        assert result.bodies[-1].volume_mm3==pytest.approx(expected,abs=1e-5)
        assert result.bodies[0].topology[0]['surfaceReference']=={'surfaceType':'cylinder'}


@pytest.mark.parametrize('kind',['sphere','cone','torus'])
def test_analytic_surface_families_use_actual_underlying_surface(engine,kind):
    from test_extrusion_part_limit import integral
    model=cylinder()
    if kind=='cone':
        model.features[1].parameters.update(region_mode=True,profiles=['stop-s'],profile_regions=['stop-s'],draft_angle_deg=math.degrees(math.atan(.25)),distance_mm=20)
        expected=integral(lambda y:integral(lambda x:20-math.sqrt((17.5-.25*y)**2-x*x),-2,2),-2,2)
    elif kind=='sphere':
        model.features[:2]=[
            Feature('sphere-profile','sketch-wire',{'plane':'XZ','start_mm':[0,10],'segments':[{'type':'arc','middle':[10,20],'end':[0,30]},{'type':'line','end':[0,10]}]}),
            Feature('stop-e','revolve',{'profile':'sphere-profile','operation':'new','body_id':'stop','axis':'Z','angle_deg':360})]
        expected=integral(lambda y:integral(lambda x:20-math.sqrt(100-x*x-y*y),-2,2),-2,2)
    else:
        model.features[:2]=[
            Feature('torus-profile','sketch-circle',{'plane':'XZ','center_mm':[15,20],'radius_mm':5}),
            Feature('stop-e','revolve',{'profile':'torus-profile','operation':'new','body_id':'stop','axis':'Z','angle_deg':360})]
        model.features[-2].parameters['points_mm']=[[13,-2],[17,-2],[17,2],[13,2]]
        expected=integral(lambda y:integral(lambda x:20-math.sqrt(25-(math.hypot(x,y)-15)**2),13,17),-2,2)
    model.features[-1].parameters['end_reference']['surfaceType']=kind
    result=engine.build(model)
    assert not result.diagnostics,result.diagnostics
    assert any(f.get('surfaceReference',{}).get('surfaceType')==kind for f in result.bodies[0].topology)
    assert result.bodies[-1].volume_mm3==pytest.approx(expected,abs=1e-5)


@pytest.mark.parametrize('operation',['add','cut','intersect'])
def test_curved_face_operations_use_exact_material_preview(engine,operation):
    from test_extrusion_next import box
    model=cylinder(angle=3,end=2)
    model.features[:0]=box('base',-5,-5,0,10,10,5 if operation=='add' else 40)
    model.features[-2].parameters['offset_mm']=5 if operation=='add' else 40
    model.features[-1].parameters.update(operation=operation,body_id='base',reversed=operation=='intersect')
    result=engine.build(model)
    assert not result.diagnostics,result.diagnostics
    tool=curved_volume(3,end=2,height=15 if operation=='add' else 20)
    assert next(b for b in result.bodies if b.id=='base').volume_mm3==pytest.approx(500+tool if operation=='add' else 4000-tool if operation=='cut' else tool,abs=1e-5)
    if operation=='cut':assert sum(b['volume_mm3'] for b in result.preview['removed'])==pytest.approx(tool,abs=1e-5)


def test_inside_two_curved_ends_stop_at_independent_exits(engine):
    from test_extrusion_part_limit import integral
    model=cylinder(angle=3,end=1)
    model.features[-2].parameters['offset_mm']=20
    model.features[-1].parameters['second_end']={'end_type':'up-to-face','distance_mm':1,'end_reference':model.features[-1].parameters['end_reference'],'draft_angle_deg':-2,'end_offset_mm':2}
    def half(angle,end):
        k=math.tan(math.radians(angle))
        return integral(lambda t:4*(2-k*t)*min(2-k*t,math.sqrt(max(0,100-(t+end)**2))),0,10-end)
    result=engine.build(model)
    assert not result.diagnostics,result.diagnostics
    assert result.bodies[-1].volume_mm3==pytest.approx(half(3,1)+half(-2,2),abs=1e-5)


def test_oblique_direction_measures_offset_along_travel(engine):
    # An X-invariant cylinder is hit at the same Z, while material shears in X.
    model=cylinder(end=2,low=1)
    model.features[0].parameters['frame']={'originMillimeters':[30,0,20],'normal':[1,0,0],'xDirection':[0,1,0]}
    model.features[-1].parameters['direction_vector']=[.6,0,.8]
    result=engine.build(model)
    assert not result.diagnostics,result.diagnostics
    expected=curved_volume(0)-16*.8*3
    assert result.bodies[-1].volume_mm3==pytest.approx(expected,abs=1e-5)


def test_spline_extrusion_surface_is_not_replaced_by_a_tangent_plane(engine):
    model=cylinder()
    model.features[:2]=[
        Feature('spline','sketch-wire',{'plane':'XZ','offset_mm':-30,'start_mm':[-10,0],'segments':[
            {'type':'line','end':[10,0]},{'type':'line','end':[10,20]},
            {'type':'bezier','controls':[[10/3,20/3],[-10/3,20/3]],'end':[-10,20]},
            {'type':'line','end':[-10,0]}]}),
        Feature('stop-e','pad',{'profile':'spline','distance_mm':1,'operation':'new','body_id':'stop'})]
    initial=engine.build(BuildJob(features=model.features[:2]))
    assert not initial.diagnostics,initial.diagnostics
    hints=[f['surfaceReference'] for f in initial.bodies[0].topology if 'surfaceReference' in f]
    assert len(hints)==1,hints
    model.features[-1].parameters['end_reference'].update(hints[0])
    result=engine.build(model)
    assert not result.diagnostics,result.diagnostics
    assert result.bodies[-1].volume_mm3==pytest.approx(160+32/15,abs=1e-5)


def test_ambiguous_surface_requires_anchor_and_changed_anchor_requires_reselection(engine):
    model=cylinder()
    source=model.features[:2]+[
        Feature('other-s','sketch-circle',{'radius_mm':10,'frame':{'originMillimeters':[30,30,20],'normal':[0,1,0],'xDirection':[1,0,0]}}),
        Feature('other','pad',{'profile':'other-s','distance_mm':1,'operation':'new','body_id':'other'})]
    exported=engine.export(BuildJob(features=source),{'format':'step'})
    assert exported['status']=='ok'
    model.features[:2]=[Feature('import','import-step',{'data_base64':exported['data_base64'],'operation':'new','body_id':'stop'})]
    reference=model.features[-1].parameters['end_reference'];reference['sourceFeatureId']='import'
    result=engine.build(model)
    assert result.diagnostics and 'ambiguous' in result.diagnostics[0]['message']
    hints=[f['surfaceReference'] for f in result.bodies[0].topology if f.get('surfaceReference',{}).get('surfaceType')=='cylinder']
    assert len(hints)==2 and all('faceAnchor' in h for h in hints)
    reference.update(min(hints,key=lambda h:h['faceAnchor']['centerMillimeters'][0]))
    result=engine.build(model)
    assert not result.diagnostics,result.diagnostics
    assert result.bodies[-1].volume_mm3==pytest.approx(curved_volume(0),abs=1e-5)
    reference['faceAnchor']['centerMillimeters'][0]+=1
    assert engine.build(model).diagnostics
    reference['faceAnchor']['centerMillimeters'][0]-=1
    assert not engine.build(model).diagnostics


def test_thin_open_profile_stops_at_curved_face(engine):
    model=cylinder(end=2,low=1)
    model.features[-2]=Feature('profile','sketch-wire',{'start_mm':[-2,0],'segments':[{'type':'line','end':[2,0]}]})
    model.features[-1].parameters.update(profiles=['profile'],profile_regions=['profile'],
        thin={'thickness_1_mm':2,'thickness_2_mm':2,'midplane':True,'midplane_thickness_mm':4})
    result=engine.build(model)
    assert not result.diagnostics,result.diagnostics
    assert result.bodies[-1].volume_mm3==pytest.approx(curved_volume(0,low=1,end=2),abs=1e-5)
