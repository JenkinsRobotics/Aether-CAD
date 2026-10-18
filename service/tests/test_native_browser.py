"""Installed browser worker agrees with the existing service, using real FreeCAD."""

import base64
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
from aether_cad_service.browser_runtime import SERVICES
from aether_cad_service.service import CADService
from aether_freecad import locate_freecad
from core.host.state import Problem

ROOT = Path(__file__).resolve().parents[1] / "aether_cad_service"
REQUESTS = json.loads(
    (Path(__file__).with_name("fixtures") / "browser-requests.json").read_text()
)


def invoke(tmp_path, action, arguments, freecad=None):
    result = subprocess.run(
        [
            sys.executable,
            "-I",
            "-S",
            str(ROOT / "runtime/runner.pyz"),
            shutil.which("node"),
            freecad or locate_freecad(),
        ],
        input=json.dumps({"service": "/api/cad/" + action, "arguments": arguments}),
        text=True,
        check=False,
        capture_output=True,
        cwd=tmp_path,
        env={
            "HOME": str(tmp_path),
            "TMPDIR": str(tmp_path),
            "QT_QPA_PLATFORM": "offscreen",
        },
        timeout=45,
    )
    assert result.returncode == 0, result.stderr
    assert not result.stderr
    return json.loads(result.stdout)


def stable(result):
    return {
        k: v
        for k, v in result.items()
        if k not in ("build_seconds", "solve_seconds", "command", "data_base64")
    }


# Recipe composition has a container and a two-stage native rebuild; it is
# qualified separately by assembly-recipe.integration.test.ts.
@pytest.mark.parametrize("action", [name for name in SERVICES if name != "assembly-compose"])
def test_real_browser_service_agrees_with_legacy(tmp_path, action):
    service = CADService()
    try:
        old = service.api(
            None, {"role": "member"}, "/api/cad/" + action, REQUESTS[action]
        )
        native = invoke(tmp_path, action, REQUESTS[action])["result"]
        assert stable(native) == stable(old)
        if action == "engine":
            assert native["ok"] and "FreeCAD" in native["engine"]
            assert "command" not in native
        if action == "geometry":
            assert native["bodies"][0]["volume_mm3"] == pytest.approx(1000)
        if action == "assembly":
            assert native["instances"][1]["placement_mm"] == pytest.approx(
                [0, 0, 0], abs=1e-6
            )
        if action == "export":
            assert base64.b64decode(native["data_base64"]).startswith(b"ISO-10303-21;")
    finally:
        for engine in service.engines.values():
            engine.close()


@pytest.mark.parametrize(
    "action,data,status",
    [
        ("geometry", {}, 400),
        ("geometry", {"features": [{}] * 513}, 413),
        ("geometry", {"features": [None]}, 400),
        ("assembly", {"instances": [{}]}, 400),
        ("export", {"features": [], "format": "bad"}, 400),
        ("analysis", {"features": [], "analysis": None}, 400),
    ],
)
def test_validation_stays_consistent(tmp_path, action, data, status):
    with pytest.raises(Problem) as error:
        CADService().api(None, {"role": "member"}, "/api/cad/" + action, data)
    assert error.value.status == status
    assert invoke(tmp_path, action, data) == {
        "error": {"kind": "too_large" if status == 413 else "invalid"}
    }


def test_installed_manifest_and_unavailable_engine(tmp_path):
    manifest = json.loads((ROOT / "runtime/native-worker.json").read_text())
    assert set(manifest["services"]) == {"/api/cad/" + s for s in SERVICES} | {"/api/cad/project-" + a for a in ("create", "read", "edit")} | {"/api/cad/settings-" + a for a in ("read", "edit")}
    result = invoke(tmp_path, "engine", {}, freecad=shutil.which("false"))
    assert result == {
        "result": {"ok": False, "error": "The CAD geometry engine is unavailable."}
    }
    assert invoke(
        tmp_path, "geometry", REQUESTS["geometry"], freecad=shutil.which("false")
    ) == {"error": {"kind": "unavailable"}}

@pytest.mark.parametrize('mode', ['reference', 'solid'])
def test_packaged_stl_import_and_export(tmp_path, mode):
    source = Path(__file__).resolve().parents[2] / 'test-fixtures/imports/box.stl'
    features = [{'id': 'mesh', 'kind': 'import-cad', 'parameters': {
        'format': 'stl', 'mesh_mode': mode, 'mesh_units': 'in',
        'body_id': 'mesh-body', 'operation': 'new',
        'data_base64': base64.b64encode(source.read_bytes()).decode(),
    }}]
    result = invoke(tmp_path, 'geometry', {'features': features})['result']
    assert result['status'] == 'ok', result
    body = result['bodies'][0]
    assert body['id'] == 'mesh-body'
    assert body['geometry_kind'] == ('mesh' if mode == 'reference' else 'solid')
    assert max(body['vertices'][0::3]) - min(body['vertices'][0::3]) == pytest.approx(50.8)
    for fmt in ('step', 'stl'):
        exported = invoke(tmp_path, 'export', {'features': features, 'format': fmt})['result']
        assert exported['status'] == ('error' if fmt == 'step' and mode == 'reference' else 'ok')


def test_packaged_preview_retains_native_axes_without_putting_them_in_commit_geometry(tmp_path):
    features=[{'id':'s','kind':'sketch-circle','parameters':{'radius_mm':2,'offset_mm':7}},
        {'id':'e','kind':'pad','parameters':{'region_mode':True,'profiles':['s'],'profile_regions':['s'],
            'operation':'new','body_id':'p','distance_mm':10,'second_end':{'end_type':'blind','distance_mm':3}}}]
    preview=invoke(tmp_path,'geometry',{'features':features,'preview_feature_id':'e'})['result']
    assert not preview['diagnostics']
    assert preview['preview']['feature_id']=='e'
    axes=preview['preview']['extrusion_axes']
    assert [a['parameter'] for a in axes]==['distance','second']
    for i,axis in enumerate(axes):
        assert axis['originMillimeters']==pytest.approx([0,0,7])
        assert axis['direction']==pytest.approx([0,0,1 if i==0 else -1])
    commit=invoke(tmp_path,'geometry',{'features':features})['result']
    assert commit['preview'] is None
    assert commit['bodies']==preview['bodies']


@pytest.mark.parametrize("angle", [0, 3, -3])
def test_packaged_next_stops_at_first_curved_boundary(tmp_path, angle):
    import math
    features=[
        {'id':'s','kind':'sketch-circle','parameters':{'radius_mm':10,'frame':{'originMillimeters':[0,-10,20],'normal':[0,1,0],'xDirection':[1,0,0]}}},
        {'id':'stop','kind':'pad','parameters':{'profile':'s','distance_mm':20,'body_id':'stop','operation':'new'}},
        {'id':'p','kind':'sketch-polygon','parameters':{'points_mm':[[-2,-2],[2,-2],[2,2],[-2,2]]}},
        {'id':'e','kind':'pad','parameters':{'region_mode':True,'profiles':['p'],'profile_regions':['p'],'body_id':'result','operation':'new','distance_mm':1,'end_type':'up-to-next','end_offset_mm':2}},
    ]
    features[-1]['parameters']['draft_angle_deg']=angle
    info=invoke(tmp_path,'engine',{})['result']
    assert 'extrude-general-next' in info['capabilities']
    assert 'extrude-drafted-general-next' in info['capabilities']
    result=invoke(tmp_path,'geometry',{'features':features,'preview_feature_id':'e'})['result']
    assert not result['diagnostics']
    # Independent integral of the tapered square below a horizontal cylinder.
    k=math.tan(math.radians(angle)); h=18
    a,b,c=1+k*k,-2*h-4*k,h*h-96
    upper=(-b-math.sqrt(b*b-4*a*c))/(2*a)
    first=h-10
    area=lambda z:4*(2-k*z)*max(0,2-k*z-math.sqrt(max(0,100-(h-z)**2)))
    n=4096; dz=(upper-first)/n
    curved=dz/3*(area(first)+area(upper)+sum((4 if i%2 else 2)*area(first+i*dz) for i in range(1,n)))
    volume=4*(4*first-2*k*first*first+k*k*first**3/3)+curved
    assert result['bodies'][-1]['volume_mm3']==pytest.approx(volume,abs=1e-5)
    assert sum(b['volume_mm3'] for b in result['preview']['added'])==pytest.approx(volume,abs=1e-5)


def test_packaged_small_circular_draft_keeps_exact_radius(tmp_path):
    import math
    features=[{'id':'s','kind':'sketch-circle','parameters':{'radius_mm':1}},
        {'id':'e','kind':'pad','parameters':{'region_mode':True,'profiles':['s'],'profile_regions':['s'],
            'operation':'new','body_id':'result','distance_mm':2,'draft_angle_deg':3}}]
    result=invoke(tmp_path,'geometry',{'features':features,'preview_feature_id':'e'})['result']
    assert not result['diagnostics']
    k=math.tan(math.radians(3))
    volume=math.pi*(2-4*k+8*k*k/3)
    assert result['bodies'][0]['volume_mm3']==pytest.approx(volume,abs=1e-6)
    assert result['preview']['added'][0]['volume_mm3']==pytest.approx(volume,abs=1e-6)


def test_packaged_spline_stopping_face_uses_underlying_native_surface(tmp_path):
    features = [
        {'id':'spline','kind':'sketch-wire','parameters':{'plane':'XZ','offset_mm':-30,
         'start_mm':[-10,0],'segments':[{'type':'line','end':[10,0]},
         {'type':'line','end':[10,20]},
         {'type':'bezier','controls':[[10/3,20/3],[-10/3,20/3]],'end':[-10,20]},
         {'type':'line','end':[-10,0]}]}},
        {'id':'stop','kind':'pad','parameters':{'profile':'spline','distance_mm':1,
         'operation':'new','body_id':'stop'}},
        {'id':'p','kind':'sketch-polygon','parameters':{'points_mm':[[-2,-2],[2,-2],[2,2],[-2,2]]}},
        {'id':'e','kind':'pad','parameters':{'region_mode':True,'profiles':['p'],'profile_regions':['p'],
         'operation':'new','body_id':'result','distance_mm':1,'end_type':'up-to-face','end_offset_mm':2,
         'end_reference':{'sourceFeatureId':'stop','bodyId':'stop','surfaceType':'extrusion','label':'Spline roof'}}}]
    info = invoke(tmp_path,'engine',{})['result']
    assert 'extrude-curved-face' in info['capabilities']
    result = invoke(tmp_path,'geometry',{'features':features,'preview_feature_id':'e'})['result']
    assert not result['diagnostics'],result['diagnostics']
    assert result['bodies'][-1]['volume_mm3']==pytest.approx(128+32/15,abs=1e-5)
    assert result['preview']['added'][0]['volume_mm3']==pytest.approx(128+32/15,abs=1e-5)
    assert any(f.get('surfaceReference',{}).get('surfaceType')=='extrusion' for f in result['bodies'][0]['topology'])


@pytest.mark.parametrize('distance',[2,-1,-6])
def test_packaged_direct_face_offset_preview_and_refusal(tmp_path,distance):
    import math
    features=[{'id':'s','kind':'sketch-circle','parameters':{'radius_mm':5}},
      {'id':'base','kind':'pad','parameters':{'profile':'s','distance_mm':10,'operation':'new','body_id':'body'}},
      {'id':'offset','kind':'offset-face','parameters':{'distance_mm':distance,'faces':[{'bodyId':'body','sourceFeatureId':'base','label':'Wall','surfaceType':'cylinder'}]}}]
    assert 'offset-face' in invoke(tmp_path,'engine',{})['result']['capabilities']
    r=invoke(tmp_path,'geometry',{'features':features,'preview_feature_id':'offset'})['result']
    if distance==-6:
        assert r['diagnostics'] and r['preview'] is None
        assert r['bodies'][0]['volume_mm3']==pytest.approx(250*math.pi)
        assert invoke(tmp_path,'export',{'features':features,'format':'step'})['result']['status']=='error'
    else:
        assert not r['diagnostics'],r['diagnostics']
        expected=math.pi*(5+distance)**2*10
        assert r['bodies'][0]['volume_mm3']==pytest.approx(expected)
        preview=r['preview'];assert preview['feature_id']=='offset' and len(preview['extrusion_axes'])==1
        assert sum(b['volume_mm3'] for b in preview['added' if distance>0 else 'removed'])==pytest.approx(abs(expected-250*math.pi))
        assert not preview['removed' if distance>0 else 'added']
@pytest.mark.parametrize('mode',['translate','rotate','scale','copy'])
def test_packaged_transform_preview_has_native_source_anchor(tmp_path,mode):
    import math
    transforms={'translate':{'kind':'translate','translationMillimeters':[20,0,0]},
      'rotate':{'kind':'rotate','axisOriginMillimeters':[0,0,0],'axisDirection':[0,0,1],'angleDegrees':45},
      'scale':{'kind':'scale','centerMillimeters':[0,0,0],'scaleFactors':[2,2,2]},'copy':{'kind':'copy'}}
    features=[{'id':'s','kind':'sketch-rectangle','parameters':{'width_mm':10,'height_mm':20}},
      {'id':'base','kind':'pad','parameters':{'profile':'s','distance_mm':5,'operation':'new','body_id':'body'}},
      {'id':'t','kind':'transform','parameters':{'body_ids':['body'],'copy_body_ids':{'body':'copy'},'transform':transforms[mode]}}]
    r=invoke(tmp_path,'geometry',{'features':features,'preview_feature_id':'t'})['result']
    assert not r['diagnostics'],r['diagnostics']
    assert r['preview']['transform_frame']['center_mm']==pytest.approx([5,10,2.5])
    assert r['preview']['transform_frame']['radius_mm']==pytest.approx(math.sqrt(525)/2)


@pytest.mark.parametrize('mode', ['translate-reference', 'rotate-reference', 'scale-reference'])
def test_packaged_referenced_transform_preview(tmp_path, mode):
    def point(x, y, z):
        return {'kind': 'sketch-point', 'local_point': [x, y], 'frame': {
            'originMillimeters': [0, 0, z], 'normal': [0, 0, 1], 'xDirection': [1, 0, 0]}}
    ref = {'kind': 'two-points', 'from': point(0, 0, 0), 'to': point(0, 0, 10)}
    t = {'kind': mode, **({'centerReference': point(0, 0, 0), 'scaleFactors': [2, 2, 2]}
                        if mode == 'scale-reference' else {'reference': ref, 'angleDegrees': 90})}
    features = [
        {'id': 's', 'kind': 'sketch-rectangle', 'parameters': {'width_mm': 10, 'height_mm': 20}},
        {'id': 'e', 'kind': 'pad', 'parameters': {'profile': 's', 'distance_mm': 5, 'operation': 'new', 'body_id': 'body'}},
        {'id': 't', 'kind': 'transform', 'parameters': {'body_ids': ['body'], 'transform': t}}]
    r = invoke(tmp_path, 'geometry', {'features': features, 'preview_feature_id': 't'})['result']
    assert not r['diagnostics'], r
    assert r['bodies'][0]['volume_mm3'] == pytest.approx(8000 if mode == 'scale-reference' else 1000)
    assert r['preview']['transform_frame']['resolved_transform']['kind'] == mode.split('-')[0]

@pytest.mark.parametrize('mode', ['translate-reference', 'rotate-reference'])
def test_packaged_native_straight_edge_transform(tmp_path, mode):
    features = [
        {'id': 's', 'kind': 'sketch-rectangle', 'parameters': {'width_mm': 10, 'height_mm': 20}},
        {'id': 'e', 'kind': 'pad', 'parameters': {'profile': 's', 'distance_mm': 5, 'operation': 'new', 'body_id': 'body'}}]
    source = invoke(tmp_path, 'geometry', {'features': features})['result']
    edge = next(c for f in source['bodies'][0]['topology'] for c in f['candidates']
                if c.get('edgeAnchor') and all(p['positionMillimeters'][:2] == [10, 20] for p in c['edgeAnchor'].values()))
    ref = {'kind': 'solid-edge', 'sourceFeatureId': 'e', 'bodyId': 'body', 'anchor': edge['edgeAnchor'], 'label': 'Vertical edge'}
    features.append({'id': 't', 'kind': 'transform', 'parameters': {'body_ids': ['body'], 'copy_body_ids': {'body': 'copy'},
                     'transform': {'kind': mode, 'reference': ref, 'angleDegrees': 90}}})
    r = invoke(tmp_path, 'geometry', {'features': features, 'preview_feature_id': 't'})['result']
    assert not r['diagnostics'], r
    assert [b['volume_mm3'] for b in r['bodies']] == pytest.approx([1000, 1000])
    resolved = r['preview']['transform_frame']['resolved_transform']
    if mode == 'translate-reference':
        assert abs(resolved['translationMillimeters'][2]) == pytest.approx(5)
    else:
        assert resolved['axisOriginMillimeters'] == pytest.approx(ref['anchor']['start']['positionMillimeters'])
        assert abs(resolved['axisDirection'][2]) == pytest.approx(1)
