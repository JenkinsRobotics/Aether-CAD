"""Real isolated packaged programs and proof, without importing the Studio host."""

import json
import math
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


def empty():
    source = json.loads(
        (ROOT / "service/tests/fixtures/automation-part.acpart").read_text()
    )
    source["features"] = []
    return json.dumps(source)


def program():
    return {
        "version": 1,
        "steps": [
            {
                "id": "outline",
                "tool": "aether_cad_sketch_rectangle",
                "arguments": {
                    "plane": "XY",
                    "x_mm": 0,
                    "y_mm": 0,
                    "width_mm": 80,
                    "height_mm": 50,
                },
            },
            {
                "id": "plate",
                "tool": "aether_cad_extrude",
                "arguments": {
                    "profile_id": {"$ref": "outline.feature_id"},
                    "depth_mm": 10,
                    "operation": "new",
                },
            },
            {
                "id": "circle",
                "tool": "aether_cad_sketch_circle",
                "arguments": {
                    "plane": "XY",
                    "offset_mm": 10,
                    "center_x_mm": 40,
                    "center_y_mm": 25,
                    "radius_mm": 5,
                },
            },
            {
                "id": "bore",
                "tool": "aether_cad_extrude",
                "arguments": {
                    "profile_id": {"$ref": "circle.feature_id"},
                    "depth_mm": 10,
                    "operation": "cut",
                    "target_body_id": {"$ref": "plate.body_id"},
                },
            },
        ],
    }


def invoke(tmp_path, command, content, arguments):
    proc = subprocess.run(
        [
            sys.executable,
            "-I",
            "-S",
            str(ROOT / "service/aether_cad_service/runtime/runner.pyz"),
            shutil.which("node"),
        ],
        input=json.dumps(
            {"command": command, "content": content, "arguments": arguments}
        ),
        text=True,
        capture_output=True,
        cwd=tmp_path,
        timeout=60,
        check=False,
        env={
            "HOME": str(tmp_path),
            "TMPDIR": str(tmp_path),
            "QT_QPA_PLATFORM": "offscreen",
        },
    )
    assert proc.returncode == 0, proc.stderr
    assert not proc.stderr
    return json.loads(proc.stdout)


def test_docs_work_without_launching_a_geometry_engine(tmp_path):
    result = invoke(
        tmp_path, "cad.part.docs", empty(), {}
    )
    assert "content" not in result and result["result"]["total"] == 13  # solid_primitive removed 2026-10-31: shapes are sketched
    assert len(result["result"]["tools"]) == 5
    assert result["result"]["execute_with"] == "cad.part.runprogram"


@pytest.mark.skipif(
    os.environ.get("AETHER_TEST_NATIVE") != "1",
    reason="Native qualification required",
)
def test_program_builds_and_verifies_referenced_bore_then_reopens(tmp_path):
    source = empty()
    result = invoke(
        tmp_path, "cad.part.runprogram", source, {"program_json": json.dumps(program())}
    )
    assert "error" not in result, result
    assert len(json.loads(source)["features"]) == 0
    assert result["result"]["steps_completed"] == 4
    assert len(json.loads(result["content"])["features"]) == 4
    expected = 40000 - 250 * math.pi
    assert result["result"]["evaluated_bodies"][0]["volume_mm3"] == pytest.approx(
        expected
    )
    references = result["result"]["references"]
    assert references["plate"]["body_id"] == references["bore"]["body_id"]
    proof = invoke(
        tmp_path, "cad.part.verify", result["content"], {"density_kg_m3": 7800}
    )
    assert "content" not in proof and "error" not in proof, proof
    measure = proof["result"]["measurements"][0]
    assert measure["volume_mm3"] == pytest.approx(expected)
    assert measure["mass_kg"] == pytest.approx(expected * 1e-9 * 7800)
    reopened = invoke(tmp_path, "cad.part.evaluate", result["content"], {})
    assert reopened["result"]["evaluated_bodies"][0]["volume_mm3"] == pytest.approx(
        expected
    )
    # A repeated equal-depth edit returns no candidate and creates no revision.
    noop = {
        "version": 1,
        "steps": [
            {
                "id": "same",
                "tool": "aether_cad_extrude_depth",
                "arguments": {
                    "feature_id": references["plate"]["feature_id"],
                    "depth_mm": 10,
                },
            }
        ],
    }
    unchanged = invoke(
        tmp_path,
        "cad.part.runprogram",
        result["content"],
        {"program_json": json.dumps(noop)},
    )
    assert "error" not in unchanged and "content" not in unchanged, unchanged


@pytest.mark.skipif(
    os.environ.get("AETHER_TEST_NATIVE") != "1",
    reason="Native qualification required",
)
def test_failed_later_step_returns_no_partial_document(tmp_path):
    bad = program()
    bad["steps"][-1]["arguments"]["target_body_id"] = "missing-solid"
    result = invoke(
        tmp_path, "cad.part.runprogram", empty(), {"program_json": json.dumps(bad)}
    )
    assert "error" in result and "content" not in result, result


@pytest.mark.parametrize(
    "encoded", ['{"version":1,"steps":[]}', "x" * 65537, '{"version":2,"steps":[]}']
)
def test_invalid_programs_refused_without_geometry(tmp_path, encoded):
    result = invoke(
        tmp_path,
        "cad.part.runprogram",
        empty(),
        {"program_json": encoded},
    )
    assert "error" in result and "content" not in result


@pytest.mark.parametrize(
    "arguments",
    [{"density_kg_m3": True}, {"density_kg_m3": -1}, {"offset": True}, {"offset": -1}],
)
def test_verify_parameters_refused_without_geometry(tmp_path, arguments):
    result = invoke(
        tmp_path, "cad.part.verify", empty(), arguments
    )
    assert "error" in result and "content" not in result

@pytest.mark.skipif(os.environ.get('AETHER_TEST_NATIVE') != '1', reason='Native qualification required')
def test_existing_drawing_center_keeps_feature_ids_and_rebuilds_exact_solid(tmp_path):
    source = json.loads(empty())
    source['formatVersion'] = 21
    source['features'] = [
        {'id':'sketch','name':'Sketch 1','type':'profile','plane':'XY','offsetMillimeters':0,'suppressed':False,
         'profile':{'type':'drawing','contours':[{'id':'outline','type':'path','start':[10,20],
          'segments':[{'id':'a','type':'line','end':[50,20]},{'id':'b','type':'line','end':[50,40]},
                      {'id':'c','type':'line','end':[10,40]},{'id':'d','type':'line','end':[10,20]}]}],
          'constraints':[{'id':'horizontal','kind':'horizontal','a':{'contour':0,'kind':'line','index':0}}]}},
        {'id':'extrude','name':'Extrude 1','type':'extrude','profileFeatureId':'sketch','distanceMillimeters':5,
         'endType':'blind','operation':'new','separateBodies':True,'suppressed':False}]
    encoded=json.dumps(source)
    inspected=invoke(tmp_path,'cad.sketch.inspect',encoded,{'feature_id':'sketch'})
    assert 'error' not in inspected, inspected
    assert inspected['result']['profile']['contours'][0]['start']==[10,20]
    move={'version':1,'steps':[{'id':'center','tool':'aether_cad_sketch_translate','arguments':{'feature_id':'sketch','dx_mm':-30,'dy_mm':-30}}]}
    result=invoke(tmp_path,'cad.part.runprogram',encoded,{'program_json':json.dumps(move)})
    assert 'error' not in result, result
    saved=json.loads(result['content']);assert [f['id'] for f in saved['features']]==['sketch','extrude']
    assert saved['features'][0]['profile']['contours'][0]['start']==[-20,-10]
    assert saved['features'][1]['profileFeatureId']=='sketch'
    proof=invoke(tmp_path,'cad.part.verify',result['content'],{})
    measure=proof['result']['measurements'][0]
    assert measure['volume_mm3']==pytest.approx(4000)
    assert measure['center_mm']==pytest.approx([0,0,2.5])
    assert measure['bounds_mm']==pytest.approx([40,20,5])
    reopened=invoke(tmp_path,'cad.part.evaluate',result['content'],{})
    assert reopened['result']['evaluated_bodies'][0]['volume_mm3']==pytest.approx(4000)

@pytest.mark.skipif(os.environ.get('AETHER_TEST_NATIVE') != '1', reason='Native qualification required')
def test_existing_rectangle_driving_dimension_keeps_origin_and_rebuilds(tmp_path):
    source=json.loads(empty());source['formatVersion']=21
    source['features']=[
        {'id':'sketch','name':'Sketch 1','type':'sketch','plane':'XY','suppressed':False,
         'profile':{'type':'center-rectangle','widthMillimeters':40,'heightMillimeters':20,'centerXMillimeters':0,'centerYMillimeters':0,'construction':False},
         'constraints':[{'id':kind,'type':kind,'target':'center-rectangle'} for kind in ['horizontal','vertical','coincident-origin']],
         'dimensions':[{'id':'width','type':'width','target':'center-rectangle','valueMillimeters':40},{'id':'height','type':'height','target':'center-rectangle','valueMillimeters':20}]},
        {'id':'extrude','name':'Extrude 1','type':'extrude','profileFeatureId':'sketch','distanceMillimeters':5,'endType':'blind','operation':'new','separateBodies':True,'suppressed':False}]
    steps={'version':1,'steps':[{'id':'resize','tool':'aether_cad_sketch_dimension','arguments':{'feature_id':'sketch','dimension_id':'width','value':60}}]}
    result=invoke(tmp_path,'cad.part.runprogram',json.dumps(source),{'program_json':json.dumps(steps)})
    assert 'error' not in result,result
    proof=invoke(tmp_path,'cad.part.verify',result['content'],{})['result']['measurements'][0]
    assert proof['volume_mm3']==pytest.approx(6000)
    assert proof['center_mm']==pytest.approx([0,0,2.5])
    assert proof['bounds_mm']==pytest.approx([60,20,5])
    saved=json.loads(result['content']);assert saved['features'][0]['constraints']==source['features'][0]['constraints']
