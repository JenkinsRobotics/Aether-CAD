"""Exact automatic contacts, independent output groups and atomic failure."""
import math
from copy import deepcopy

import pytest
from aether_freecad import BuildJob, Feature, FreeCADEngine
from test_cad_import import imported
from test_extrusion_scope import job, merge_job


@pytest.fixture(scope='module')
def engine():
    with FreeCADEngine() as instance:
        yield instance


def automatic(model):
    parameters=model.features[-1].parameters
    parameters.pop('body_id',None);parameters.pop('target_body_ids',None)
    parameters['scope_mode']='all'
    return model


@pytest.mark.parametrize('depth,targets,volume',[(10,['a'],500+40*math.pi),(15,['a','b'],1000+60*math.pi),(36,['a','b','untouched'],1500+120*math.pi)])
def test_add_detects_contact_every_rebuild_and_only_new_material_is_blue(engine,depth,targets,volume):
    result=engine.build(automatic(merge_job(depth=depth)))
    assert not result.diagnostics,result.diagnostics
    assert result.bodies[0].id=='a'
    assert result.bodies[0].volume_mm3==pytest.approx(volume)
    assert result.scope_resolutions=={'cut':{'targets':targets,'groups':[{'bodyId':'a','sources':targets}]}}
    assert not result.preview['removed']
    assert sum(b['volume_mm3'] for b in result.preview['added'])==pytest.approx(volume-500*len(targets))


@pytest.mark.parametrize('operation,expected',[('cut',500-20*math.pi),('intersect',20*math.pi)])
def test_all_scope_modifies_only_overlapping_parts(engine,operation,expected):
    result=engine.build(automatic(job(operation=operation)))
    assert not result.diagnostics,result.diagnostics
    assert [b.volume_mm3 for b in result.bodies]==pytest.approx([expected,expected,500])
    assert result.scope_resolutions['cut']=={'targets':['a','b'],'groups':[{'bodyId':'a','sources':['a']},{'bodyId':'b','sources':['b']}]}


def test_complete_cut_consumes_part_and_reports_real_red_preview(engine):
    result=engine.build(automatic(job(radius=8)))
    assert not result.diagnostics,result.diagnostics
    assert [b.id for b in result.bodies]==['untouched']
    assert result.scope_resolutions['cut']=={'targets':['a','b'],'groups':[]}
    assert sum(b['volume_mm3'] for b in result.preview['removed'])==pytest.approx(1000)


def independent_groups():
    features=[]
    for key,x in [('a',0),('b',30)]:
        features.extend([Feature(key+'-s','sketch-circle',{'radius_mm':5,'center_mm':[x,0]}),
            Feature(key,'pad',{'profile':key+'-s','distance_mm':5,'operation':'new','body_id':key}),
            Feature(key+'-add','sketch-circle',{'radius_mm':2,'center_mm':[x,0],'offset_mm':5})])
    features.append(Feature('e','pad',{'scope_mode':'all','operation':'add','region_mode':True,'distance_mm':10,
        'profile_groups':[{'profiles':[key+'-add'],'profile_regions':[key+'-add']} for key in ['a','b']]}))
    return BuildJob(features=features,preview_feature_id='e')


def test_disconnected_add_groups_keep_separate_existing_identities(engine):
    result=engine.build(independent_groups())
    assert not result.diagnostics,result.diagnostics
    assert [b.id for b in result.bodies]==['a','b']
    assert [b.volume_mm3 for b in result.bodies]==pytest.approx([165*math.pi]*2)
    assert result.scope_resolutions['e']['groups']==[{'bodyId':'a','sources':['a']},{'bodyId':'b','sources':['b']}]
    assert sum(b['volume_mm3'] for b in result.preview['added'])==pytest.approx(80*math.pi)
    assert not result.preview['removed']


@pytest.mark.parametrize('mutation',['no-hit','detached-region','explicit-target','invalid-mode','legacy-route'])
def test_failure_cannot_publish_partial_scope_or_geometry(engine,mutation):
    model=independent_groups();p=model.features[-1].parameters
    if mutation=='no-hit':p['starting_offset_mm']=20
    if mutation=='detached-region':model.features[5].parameters['center_mm']=[60,0]
    if mutation=='explicit-target':p['body_id']='a'
    if mutation=='invalid-mode':p['scope_mode']='nearest'
    if mutation=='legacy-route':p['region_mode']=False
    result=engine.build(model)
    assert result.diagnostics and result.preview is None and result.scope_resolutions=={}
    assert [b.volume_mm3 for b in result.bodies]==pytest.approx([125*math.pi]*2)
    assert engine.export(model,{'format':'step'})['status']=='error'
    assert not engine.build(independent_groups()).diagnostics


def test_producer_output_history_survives_consumption_by_both_merge_modes(engine):
    for all_scope in [False,True]:
        model=merge_job()
        for index in [1,3,5]:
            p=model.features[index].parameters
            p.update(region_mode=True,separate_bodies=True,profiles=[p['profile']],profile_regions=[p['profile']])
        before=engine.build(BuildJob(features=model.features[:-2]))
        assert not before.diagnostics
        ids=[b.id for b in before.bodies]
        if all_scope:automatic(model)
        else:model.features[-1].parameters.update(body_id=ids[0],target_body_ids=ids[:2])
        result=engine.build(model)
        assert not result.diagnostics,result.diagnostics
        assert result.body_outputs==before.body_outputs
        assert result.body_outputs['b']==[ids[1]]


def test_exact_exchange_preserves_all_merged_groups(engine):
    model=independent_groups();exported=engine.export(model,{'format':'step'})
    assert exported['status']=='ok',exported
    reopened=engine.build(BuildJob(features=[Feature('import','import-step',{'operation':'new','body_id':'solid','data_base64':exported['data_base64']})]))
    assert not reopened.diagnostics
    assert sum(b.volume_mm3 for b in reopened.bodies)==pytest.approx(330*math.pi)


@pytest.mark.parametrize('options',[
    {'draft_angle_deg':3},
    {'thin':{'thickness_1_mm':1,'thickness_2_mm':0}},
    {'second_end':{'end_type':'blind','distance_mm':2}},
    {'starting_reference':{'kind':'plane','frame':{'originMillimeters':[0,0,0],'normal':[0,0,1]}},'starting_offset_mm':5},
])
def test_automatic_and_selected_scopes_use_the_same_native_extent_tool(engine,options):
    selected=merge_job();selected.features[-1].parameters.update(options)
    expected=engine.build(selected)
    actual=engine.build(automatic(deepcopy(selected)))
    assert not expected.diagnostics and not actual.diagnostics,(expected.diagnostics,actual.diagnostics)
    assert [b.id for b in actual.bodies]==[b.id for b in expected.bodies]
    assert [b.volume_mm3 for b in actual.bodies]==pytest.approx([b.volume_mm3 for b in expected.bodies])
    assert sum(b['volume_mm3'] for b in actual.preview['added'])==pytest.approx(sum(b['volume_mm3'] for b in expected.preview['added']))


def test_reference_mesh_is_preserved_but_never_enters_solid_scope(engine):
    model=automatic(merge_job());model.features.insert(0,imported('stl'))
    result=engine.build(model)
    assert not result.diagnostics,result.diagnostics
    assert [b.id for b in result.bodies]==['imported-body','a','untouched']
    assert result.bodies[0].geometry_kind=='mesh'
    assert result.scope_resolutions['cut']['targets']==['a','b']


def test_complete_cut_can_remove_every_solid_without_losing_producer_history(engine):
    model=automatic(job(radius=8));model.features[-2].parameters['offset_mm']=50
    result=engine.build(model)
    assert not result.diagnostics,result.diagnostics
    assert result.bodies==[]
    assert result.scope_resolutions['cut']=={'targets':['a','b','untouched'],'groups':[]}
    assert sum(b['volume_mm3'] for b in result.preview['removed'])==pytest.approx(1500)
