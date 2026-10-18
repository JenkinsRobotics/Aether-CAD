"""Handle anchors are native tool projections, never cached sketch guesses."""
from dataclasses import replace

import pytest
from aether_freecad import FreeCADEngine
from test_extrusion_start import job, reference


@pytest.fixture(scope='module')
def engine():
    with FreeCADEngine() as value:
        yield value


def axes(engine, model):
    result=engine.build(model)
    assert not result.diagnostics,result.diagnostics
    assert result.preview['feature_id']=='e'
    return result.preview['extrusion_axes']


@pytest.mark.parametrize('height,offset,reversed_,origin,direction',[
    (10,0,False,[0,0,10],[0,0,1]),
    (30,2,False,[0,0,32],[0,0,1]),
    (10,2,True,[0,0,8],[0,0,-1]),
])
def test_face_reference_and_axial_offset_follow_current_native_geometry(engine,height,offset,reversed_,origin,direction):
    model=job(height,starting_offset_mm=offset,reversed=reversed_)
    axis=axes(engine,model)[0]
    assert axis['originMillimeters']==pytest.approx(origin)
    assert axis['direction']==pytest.approx(direction)
    assert axis['reversed']==reversed_ and axis['scale']==1
    assert axis['side']=='primary' and axis['parameter']=='distance'
    assert '_preview_axes' not in model.features[-1].parameters
    assert engine.build(replace(model,preview_feature_id=None)).preview is None


def test_oblique_plane_start_is_on_the_actual_axis(engine):
    model=job(starting_reference={'kind':'plane','frame':{'originMillimeters':[0,0,-4],'normal':[0,0,1]}},starting_offset_mm=1,direction_vector=[.6,0,.8])
    axis=axes(engine,model)[0]
    assert axis['originMillimeters']==pytest.approx([-2.4,0,-3.2])
    assert axis['direction']==pytest.approx([.6,0,.8])


def test_symmetric_handles_share_total_depth_with_half_scale(engine):
    model=job(end_type='symmetric',distance_mm=8,starting_offset_mm=2,draft_angle_deg=2)
    pair=axes(engine,model)
    assert len(pair)==2
    for i,axis in enumerate(pair):
        assert axis['originMillimeters']==pytest.approx([0,0,12])
        assert axis['direction']==pytest.approx([0,0,1 if i==0 else -1])
        assert axis['parameter']=='distance' and axis['scale']==.5


def test_independent_blind_end_has_its_own_parameter_and_opposite_axis(engine):
    pair=axes(engine,job(second_end={'end_type':'blind','distance_mm':3}))
    assert [a['parameter'] for a in pair]==['distance','second']
    assert [a['side'] for a in pair]==['primary','opposite']
    for i,axis in enumerate(pair):
        assert axis['originMillimeters']==pytest.approx([0,0,10])
        assert axis['direction']==pytest.approx([0,0,1 if i==0 else -1])
        assert axis['scale']==1


def test_referenced_primary_limit_keeps_editable_opposite_blind_handle(engine):
    model=job(starting_reference={'kind':'plane','frame':{'originMillimeters':[0,0,3],'normal':[0,0,1]}},end_type='up-to-face',end_reference=reference(),second_end={'end_type':'blind','distance_mm':2})
    pair=axes(engine,model)
    assert len(pair)==1 and pair[0]['parameter']=='second'
    assert pair[0]['originMillimeters']==pytest.approx([0,0,3])
    assert pair[0]['direction']==pytest.approx([0,0,-1])


def test_cut_handle_points_into_material_and_through_all_has_no_false_depth(engine):
    model=job(operation='cut',body_id='stop')
    axis=axes(engine,model)[0]
    assert axis['originMillimeters']==pytest.approx([0,0,10])
    assert axis['direction']==pytest.approx([0,0,-1])
    model.features[-1].parameters['end_type']='symmetric-through-all'
    assert axes(engine,model)==[]


def test_thin_uses_the_evaluated_wall_anchor_and_bad_reference_exposes_no_handle(engine):
    model=job(thin={'thickness_1_mm':1,'thickness_2_mm':0})
    axis=axes(engine,model)[0]
    assert axis['originMillimeters']==pytest.approx([0,0,10])
    model.features[-1].parameters['starting_reference']['sourceFeatureId']='missing'
    result=engine.build(model)
    assert result.diagnostics and result.preview is None
