"""Direct face offsets must extend native neighbors and preserve exact material."""
import base64
import math
import subprocess

import pytest
from aether_freecad import BuildJob, Feature, FreeCADEngine, locate_freecad


@pytest.fixture(scope='module')
def engine():
    with FreeCADEngine() as instance:
        yield instance


def model(distance, refs=None, cylinder=False):
    profile = Feature('s', 'sketch-circle', {'radius_mm':5}) if cylinder else Feature('s','sketch-rectangle',{'width_mm':10,'height_mm':20})
    return BuildJob(features=[profile,Feature('base','pad',{'profile':'s','distance_mm':10,'operation':'new','body_id':'body'}),
        Feature('offset','offset-face',{'distance_mm':distance,'faces':refs or [reference('cylinder' if cylinder else [0,0,1])]})],preview_feature_id='offset')


def reference(surface, body='body', source='base'):
    return {'bodyId':body,'sourceFeatureId':source,'label':'Selected face',**({'surfaceType':surface} if isinstance(surface,str) else {'normal':surface})}


@pytest.mark.parametrize('distance',[2,-1])
@pytest.mark.parametrize('kind',['top','two-planes','cylinder','cylinder-and-cap'])
def test_signed_planar_and_curved_offsets_have_exact_preview(engine,kind,distance):
    cylindrical=kind.startswith('cylinder')
    refs=[reference('cylinder' if cylindrical else [0,0,1])]
    if kind=='two-planes':refs.append(reference([1,0,0]))
    if kind=='cylinder-and-cap':refs.append(reference([0,0,1]))
    result=engine.build(model(distance,refs,cylindrical))
    assert not result.diagnostics,result.diagnostics
    old=250*math.pi if cylindrical else 2000
    expected=math.pi*(5+distance)**2*(10+distance if kind=='cylinder-and-cap' else 10) if cylindrical else (10+distance if kind=='two-planes' else 10)*20*(10+distance)
    assert result.bodies[0].volume_mm3==pytest.approx(expected,abs=1e-6)
    assert sum(b['volume_mm3'] for b in result.preview['added' if distance>0 else 'removed'])==pytest.approx(abs(expected-old),abs=1e-6)
    assert not result.preview['removed' if distance>0 else 'added']


@pytest.mark.parametrize('distance',[2,-2])
def test_planar_top_extends_conical_neighbors_instead_of_extruding_footprint(engine,distance):
    job=model(distance,[reference([0,0,1])],True)
    job.features[0].parameters['radius_mm']=10
    job.features[1].parameters.update(region_mode=True,profiles=['s'],profile_regions=['s'],draft_angle_deg=math.degrees(math.atan(.5)))
    result=engine.build(job)
    assert not result.diagnostics,result.diagnostics
    height=10+distance
    expected=math.pi*(100*height-5*height*height+height**3/12)
    assert result.bodies[0].volume_mm3==pytest.approx(expected,abs=1e-5)
    assert result.bodies[0].volume_mm3!=pytest.approx(1750*math.pi/3+25*math.pi*distance)


@pytest.mark.parametrize('distance',[1,-1])
def test_cylindrical_hole_offsets_use_outward_material_normal(engine,distance):
    job=model(distance,[reference('cylinder',source='hole')])
    job.features[2:2]=[Feature('hole-s','sketch-circle',{'radius_mm':2,'center_mm':[5,10],'offset_mm':10}),Feature('hole','pocket',{'profile':'hole-s','depth_mm':10,'body_id':'body','operation':'cut'})]
    result=engine.build(job)
    assert not result.diagnostics,result.diagnostics
    assert result.bodies[0].volume_mm3==pytest.approx(2000-math.pi*(2-distance)**2*10,abs=1e-6)


@pytest.mark.parametrize('distance',[-5,-6,-20])
def test_collapsed_or_inverted_radius_cannot_become_another_valid_cylinder(engine,distance):
    job=model(distance,cylinder=True)
    result=engine.build(job)
    assert result.diagnostics and 'radius' in result.diagnostics[0]['message']
    assert result.preview is None and result.bodies[0].volume_mm3==pytest.approx(250*math.pi)
    assert engine.export(job,{'format':'step'})['status']=='error'
    assert not engine.build(model(1,cylinder=True)).diagnostics


@pytest.mark.parametrize('invalid',[True,0,float('inf'),'missing','duplicate','missing-source','changed-anchor','unknown-type'])
def test_invalid_input_never_changes_current_geometry(engine,invalid):
    job=model(2)
    p=job.features[-1].parameters
    if isinstance(invalid,(bool,int,float)):p['distance_mm']=invalid
    elif invalid=='missing':p['faces']=[]
    elif invalid=='duplicate':p['faces']*=2
    elif invalid=='missing-source':p['faces'][0]['sourceFeatureId']='gone'
    elif invalid=='changed-anchor':p['faces'][0]['faceAnchor']={'centerMillimeters':[0,0,0],'areaSquareMillimeters':1}
    else:p['faces']=[reference('unsupported')]
    result=engine.build(job)
    assert result.diagnostics and result.preview is None
    assert result.bodies[0].volume_mm3==pytest.approx(2000)
    assert engine.export(job,{'format':'step'})['status']=='error'


def test_multi_body_offsets_are_atomic_and_have_distinct_source_snapshots(engine):
    job=model(-2,cylinder=True)
    job.features[2:2]=[Feature('small-s','sketch-circle',{'radius_mm':1,'center_mm':[20,0]}),Feature('small','pad',{'profile':'small-s','distance_mm':10,'body_id':'small','operation':'new'})]
    p=job.features[-1].parameters;p['faces'].append(reference('cylinder','small','small'))
    result=engine.build(job)
    assert result.diagnostics and result.preview is None
    assert [b.volume_mm3 for b in result.bodies]==pytest.approx([250*math.pi,10*math.pi])
    p['distance_mm']=1
    result=engine.build(job)
    assert not result.diagnostics,result.diagnostics
    assert [b.volume_mm3 for b in result.bodies]==pytest.approx([360*math.pi,40*math.pi])
    job=BuildJob(features=job.features)
    job.features.append(Feature('again','offset-face',{'distance_mm':-0.5,'faces':[reference('cylinder','small','offset')]}))
    result=engine.build(job)
    assert not result.diagnostics,result.diagnostics
    assert [b.volume_mm3 for b in result.bodies]==pytest.approx([360*math.pi,22.5*math.pi])


def test_step_import_offset_export_and_upstream_change(engine):
    job=model(2,cylinder=True)
    original=engine.export(BuildJob(features=job.features[:2]),{'format':'step'})
    assert original['status']=='ok'
    job.features[:2]=[Feature('base','import-step',{'operation':'new','body_id':'body','data_base64':original['data_base64']})]
    for distance in [2,3,-1]:
        job.features[-1].parameters['distance_mm']=distance
        result=engine.build(job)
        assert not result.diagnostics,result.diagnostics
        exported=engine.export(job,{'format':'step'})
        restored=engine.build(BuildJob(features=[Feature('import','import-step',{'operation':'new','body_id':'body','data_base64':exported['data_base64']})]))
        assert not restored.diagnostics,restored.diagnostics
        assert restored.bodies[0].volume_mm3==pytest.approx(math.pi*(5+distance)**2*10,abs=1e-5)


@pytest.fixture(scope='module')
def imported_shapes(tmp_path_factory):
    folder=tmp_path_factory.mktemp('offset-shapes')
    script=folder/'shapes.py'
    script.write_text(f"""
import Part, FreeCAD as App
from pathlib import Path
folder=Path({str(folder)!r})
V=App.Vector
shapes={{'sphere':Part.makeSphere(5),'torus':Part.makeTorus(10,3),
 'cone':Part.makeCone(10,5,10),
 'two':Part.makeCompound([Part.makeCylinder(5,10),Part.makeCylinder(5,10,V(20,0,0))])}}
for name,shape in shapes.items():shape.exportStep(str(folder/(name+'.step')))
""")
    completed=subprocess.run([locate_freecad(),str(script)],input='',text=True,capture_output=True,timeout=60,check=True)
    assert (folder/'sphere.step').exists(),completed.stdout+completed.stderr
    return {name:base64.b64encode((folder/(name+'.step')).read_bytes()).decode() for name in ['sphere','torus','cone','two']}


@pytest.mark.parametrize('kind',['sphere','torus','cone'])
@pytest.mark.parametrize('distance',[1,-1])
def test_imported_analytic_faces_offset_exactly(engine,imported_shapes,kind,distance):
    job=BuildJob(features=[Feature('base','import-step',{'operation':'new','body_id':'body','data_base64':imported_shapes[kind]}),
        Feature('offset','offset-face',{'distance_mm':distance,'faces':[reference(kind)]})],preview_feature_id='offset')
    result=engine.build(job)
    assert not result.diagnostics,result.diagnostics
    if kind=='sphere':expected=4*math.pi*(5+distance)**3/3
    elif kind=='torus':expected=2*math.pi**2*10*(3+distance)**2
    else:
        # Normal displacement of r(z)=10-z/2 shifts its radii by d*sqrt(1+.5²).
        r=10+distance*math.sqrt(1.25)
        expected=math.pi*10*(r*r+r*(r-5)+(r-5)**2)/3
    assert result.bodies[0].volume_mm3==pytest.approx(expected,abs=1e-5)
    axes=result.preview['extrusion_axes']
    assert len(axes)==1 and math.hypot(*axes[0]['direction'])==pytest.approx(1)
    assert all(math.isfinite(v) for v in axes[0]['originMillimeters'])


def test_ambiguous_imported_faces_require_native_anchor_and_keep_other_solid(engine,imported_shapes):
    job=BuildJob(features=[Feature('base','import-step',{'operation':'new','body_id':'body','data_base64':imported_shapes['two']}),
        Feature('offset','offset-face',{'distance_mm':1,'faces':[reference('cylinder')]})],preview_feature_id='offset')
    result=engine.build(job)
    assert result.diagnostics and result.preview is None
    ref=job.features[-1].parameters['faces'][0]
    ref['faceAnchor']={'centerMillimeters':[0,0,5],'areaSquareMillimeters':100*math.pi}
    result=engine.build(job)
    assert not result.diagnostics,result.diagnostics
    assert result.bodies[0].volume_mm3==pytest.approx(610*math.pi,abs=1e-5)
    job.features[-1].parameters['distance_mm']=11
    result=engine.build(job)
    assert result.diagnostics and result.preview is None
    assert result.bodies[0].volume_mm3==pytest.approx(500*math.pi,abs=1e-5)
