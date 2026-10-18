"""One version boundary for standalone, project, settings and isolated workers."""
import base64
import copy
import json
import zipfile
from pathlib import Path

import pytest
from aether_animation.aether_project import edit_project, new_project
from aether_cad_service.document import CADDocument
from aether_cad_service.part_format import PART_DOCUMENT_VERSION, validate_part_header
from test_native_browser import invoke
from test_native_projects import created

ROOT = Path(__file__).resolve().parents[2]


def part(version=3):
    return {"format": "aether-part", "formatVersion": version, "documentId": "fixture",
            "name": "Legacy", "units": "millimeter", "features": [],
            "document_settings": {"description": "Keep these notes"}}


def encoded(doc):
    return base64.b64encode(json.dumps(doc).encode()).decode()


def test_packaged_version_manifest_matches_document_authority():
    canonical = (ROOT / "aether-engine/src/document/part-format.json").read_bytes()
    assert PART_DOCUMENT_VERSION == 21
    assert (ROOT / "service/aether_cad_service/data/part-format.json").read_bytes() == canonical
    with zipfile.ZipFile(ROOT / "service/aether_cad_service/runtime/runner.pyz") as archive:
        assert archive.read("aether_cad_service/data/part-format.json") == canonical
        assert "aether_cad_service/part_format.py" in archive.namelist()


@pytest.mark.parametrize("version", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21])
def test_settings_retain_legacy_header_until_explicit_update(tmp_path, version):
    source = part(version)
    args = {"data_base64": encoded(source)}
    read = invoke(tmp_path, "settings-read", args)["result"]
    assert "data_base64" not in read
    assert read["featureVersion"] == PART_DOCUMENT_VERSION
    assert read["upgradeNeeded"] == (version < PART_DOCUMENT_VERSION)
    renamed = invoke(tmp_path, "settings-edit", {**args, "operation": "rename", "name": "Renamed"})["result"]
    saved = json.loads(base64.b64decode(renamed["data_base64"]))
    assert saved["formatVersion"] == version
    assert saved["document_settings"]["description"] == "Keep these notes"
    updated = invoke(tmp_path, "settings-edit", {**args, "operation": "update", "parts": [],
        "upgraded_documents": {"part": {**source, "formatVersion": PART_DOCUMENT_VERSION}}})["result"]
    assert not updated["upgradeNeeded"]
    assert json.loads(base64.b64decode(updated["data_base64"]))["formatVersion"] == PART_DOCUMENT_VERSION


@pytest.mark.parametrize("version", [None, True, "3", 0, -1, 1.5, PART_DOCUMENT_VERSION + 1, 999])
def test_header_refuses_unknown_versions_before_settings(version):
    doc = {**part(version), "document_settings": "bad future fields"}
    with pytest.raises(ValueError, match="Unsupported Part format version"):
        CADDocument(json.dumps(doc).encode())
    with pytest.raises(ValueError, match="Unsupported Part format version"):
        validate_part_header(doc)


def test_multi_part_upgrade_validates_every_document_before_mutating():
    workspace = new_project("Atomic update")
    for name in ["First", "Second"]:
        edit_project(workspace, "add_part", {"name": name, "document": part(3)})
    doc = CADDocument(workspace.to_bytes()[0])
    before = doc.bytes()
    migrations = {key: {**copy.deepcopy(old), "formatVersion": PART_DOCUMENT_VERSION}
                  for key, old in doc.upgrade_documents().items()}
    last = list(migrations)[-1]
    valid = copy.deepcopy(migrations)
    migrations[last]["documentId"] = "wrong identity"
    with pytest.raises(ValueError, match="feature migration"):
        doc.edit("upgrade", {"upgraded_documents": migrations})
    assert doc.bytes() == before
    doc.edit("upgrade", {"upgraded_documents": valid})
    assert not doc.upgrade_documents()
    for key, value in valid.items():
        assert doc.workspace.part_definitions[key]["feature_document"] == value


@pytest.mark.parametrize("action", ["settings-read", "settings-edit", "project-read", "project-edit"])
def test_packaged_worker_rejects_future_embedded_part_without_output(tmp_path, action):
    workspace = new_project("Future")
    edit_project(workspace, "add_part", {"name": "Future", "document": part(3)})
    next(iter(workspace.part_definitions.values()))["feature_document"]["formatVersion"] = PART_DOCUMENT_VERSION + 1
    data = base64.b64encode(workspace.to_bytes()[0]).decode()
    request = {"data_base64": data, "operation": "rename", "name": "Changed"}
    assert invoke(tmp_path, action, request) == {"error": {"kind": "invalid"}}


@pytest.mark.parametrize("operation", ["add_part", "save_part", "link_part", "update_link"])
def test_project_edits_refuse_future_incoming_features(tmp_path, operation):
    original = created(tmp_path)
    args = {**original, "operation": operation, "document": part(PART_DOCUMENT_VERSION + 1), "name": "Future",
            "part_id": original["project"]["parts"][0]["id"],
            "source_ref": "library:fixture@1", "source_label": "Fixture"}
    assert invoke(tmp_path, "project-edit", args) == {"error": {"kind": "invalid"}}
    assert invoke(tmp_path, "project-read", original)["result"]["project"] == original["project"]


def test_new_project_tabs_and_saved_current_features_reopen(tmp_path):
    from aether_animation.aether_workspace import AetherWorkspace
    original = created(tmp_path)
    source = part(PART_DOCUMENT_VERSION)
    source["features"] = json.loads((ROOT / "service/tests/fixtures/automation-part.acpart").read_text())["features"]
    source["features"][1].update(directionVector=[0.6, 0, 0.8], secondEnd={"endType": "blind", "distanceMillimeters": 2})
    args = {**original, "operation": "save_part", "part_id": original["project"]["parts"][0]["id"], "document": source}
    saved = invoke(tmp_path, "project-edit", args)["result"]
    assert invoke(tmp_path, "project-read", saved)["result"]["project"] == saved["project"]
    workspace = AetherWorkspace.from_bytes(base64.b64decode(saved["data_base64"]))
    assert workspace.part_definitions[args["part_id"]]["feature_document"] == {**source, "documentId": args["part_id"]}
    added = invoke(tmp_path, "project-edit", {**saved, "operation": "add_part", "name": "New tab"})["result"]
    workspace = AetherWorkspace.from_bytes(base64.b64decode(added["data_base64"]))
    assert all(p["feature_document"]["formatVersion"] == PART_DOCUMENT_VERSION for p in workspace.part_definitions.values())


def test_packaged_line_direction_rebuilds_and_survives_project_roundtrip(tmp_path):
    from aether_animation.aether_workspace import AetherWorkspace
    from test_native_automation import invoke as automate

    source = part(PART_DOCUMENT_VERSION)
    source["features"] = [
        {"id": "guide", "name": "Guide", "type": "profile", "plane": "XZ",
         "offsetMillimeters": 0, "suppressed": False, "profile": {
             "type": "drawing", "contours": [{"id": "path", "type": "path",
             "construction": True, "start": [0, 0], "segments": [
                 {"id": "line", "type": "line", "end": [3, 4]}]}]}},
        {"id": "circle", "name": "Circle", "type": "profile", "plane": "XY",
         "offsetMillimeters": 0, "suppressed": False, "profile": {
             "type": "circle", "radiusMillimeters": 10, "centerMillimeters": [0, 0]}},
        {"id": "pad", "name": "Along line", "type": "extrude", "profileFeatureId": "circle",
         "distanceMillimeters": 10, "operation": "new", "bodyId": "solid", "suppressed": False,
         "directionReference": {"kind": "sketch-line", "sourceFeatureId": "guide",
                                "contourId": "path", "segmentId": "line"}},
    ]
    edited = automate(tmp_path, "cad.extrude.setdepth", json.dumps(source),
                      {"feature_id": "pad", "depth_mm": 8})
    assert "error" not in edited, edited
    saved = json.loads(edited["content"])
    assert saved["formatVersion"] == PART_DOCUMENT_VERSION
    assert saved["features"][2]["directionReference"] == source["features"][2]["directionReference"]
    assert "directionVector" not in saved["features"][2]
    original = created(tmp_path)
    part_id = original["project"]["parts"][0]["id"]
    project = invoke(tmp_path, "project-edit", {**original, "operation": "save_part",
                    "part_id": part_id, "document": saved})["result"]
    reopened = AetherWorkspace.from_bytes(base64.b64decode(project["data_base64"]))
    current = reopened.part_definitions[part_id]["feature_document"]
    evaluated = automate(tmp_path, "cad.part.evaluate", json.dumps(current), {})
    import math
    assert evaluated["result"]["evaluated_bodies"][0]["volume_mm3"] == pytest.approx(640 * math.pi)
    current["features"][0]["profile"]["contours"][0]["segments"][0]["end"] = [4, 3]
    evaluated = automate(tmp_path, "cad.part.evaluate", json.dumps(current), {})
    assert evaluated["result"]["evaluated_bodies"][0]["volume_mm3"] == pytest.approx(480 * math.pi)


def test_packaged_automation_migrates_only_on_actual_edit_and_preserves_geometry(tmp_path):
    from test_native_automation import invoke as automate
    source = json.loads((ROOT / "service/tests/fixtures/automation-part.acpart").read_text())
    source["features"][1].update(directionVector=[0.6, 0, 0.8], bodyId="solid")
    original = json.dumps(source)
    noop = automate(tmp_path, "cad.extrude.setdepth", original, {"feature_id": "pad", "depth_mm": 5})
    assert noop["unchanged"] is True and "content" not in noop
    edited = automate(tmp_path, "cad.extrude.setdepth", original, {"feature_id": "pad", "depth_mm": 8})
    assert "error" not in edited, edited
    saved = json.loads(edited["content"])
    assert saved["formatVersion"] == PART_DOCUMENT_VERSION
    assert saved["features"][1] == {**source["features"][1], "distanceMillimeters": 8}
    assert saved["documentId"] == source["documentId"]
    reopened = automate(tmp_path, "cad.part.evaluate", edited["content"], {})
    assert reopened["result"]["evaluated_bodies"][0]["volume_mm3"] == pytest.approx(1280)
    assert reopened["result"]["evaluated_bodies"][0]["id"] == "solid"
    future = json.dumps({**source, "formatVersion": PART_DOCUMENT_VERSION + 1})
    refused = automate(tmp_path, "cad.part.evaluate", future, {})
    assert "error" in refused and "content" not in refused


def test_packaged_v1_rectangle_migration_keeps_exact_dimensions(tmp_path):
    from test_native_automation import invoke as automate
    legacy = {**part(1), "format": "open-cad-part", "features": [
        {"id": "sketch", "type": "sketch", "name": "Sketch", "plane": "XY",
         "profile": {"type": "center-rectangle", "widthMillimeters": 60,
                     "heightMillimeters": 40}, "suppressed": False},
        {"id": "pad", "type": "extrude", "name": "Extrude", "profileFeatureId": "sketch",
         "distanceMillimeters": 12, "operation": "new", "suppressed": False}]}
    evaluated = automate(tmp_path, "cad.part.evaluate", json.dumps(legacy), {})
    assert evaluated["result"]["evaluated_bodies"][0]["volume_mm3"] == pytest.approx(28800)
    edited = automate(tmp_path, "cad.extrude.setdepth", json.dumps(legacy), {"feature_id": "pad", "depth_mm": 10})
    saved = json.loads(edited["content"])
    assert (saved["format"], saved["formatVersion"]) == ("aether-part", PART_DOCUMENT_VERSION)
    assert [feature["id"] for feature in saved["features"]] == ["sketch", "pad"]
    assert saved["document_settings"] == legacy["document_settings"]
    reopened = automate(tmp_path, "cad.part.evaluate", edited["content"], {})
    assert reopened["result"]["evaluated_bodies"][0]["volume_mm3"] == pytest.approx(24000)


def test_packaged_thin_wall_edit_and_project_reopen(tmp_path):
    from aether_animation.aether_workspace import AetherWorkspace
    from test_native_automation import invoke as automate

    source = part(PART_DOCUMENT_VERSION)
    source["features"] = [
        {"id": "s", "name": "Open path", "type": "profile", "plane": "XY",
         "offsetMillimeters": 0, "suppressed": False, "profile": {
             "type": "drawing", "contours": [{"id": "path", "type": "path", "start": [0, 0],
                 "segments": [{"type": "line", "end": [20, 0]}]}]}},
        {"id": "e", "name": "Wall", "type": "extrude", "profileFeatureId": "s", "profileContourId": "path",
         "distanceMillimeters": 10, "operation": "new", "bodyId": "wall", "suppressed": False,
         "thin": {"thickness1Millimeters": 2, "thickness2Millimeters": 1}},
    ]
    edited = automate(tmp_path, "cad.extrude.setdepth", json.dumps(source), {"feature_id": "e", "depth_mm": 8})
    assert "error" not in edited, edited
    saved = json.loads(edited["content"])
    assert saved["formatVersion"] == PART_DOCUMENT_VERSION
    assert saved["features"][1]["thin"] == source["features"][1]["thin"]
    original = created(tmp_path)
    part_id = original["project"]["parts"][0]["id"]
    project = invoke(tmp_path, "project-edit", {**original, "operation": "save_part", "part_id": part_id, "document": saved})["result"]
    reopened = AetherWorkspace.from_bytes(base64.b64decode(project["data_base64"]))
    evaluated = automate(tmp_path, "cad.part.evaluate", json.dumps(reopened.part_definitions[part_id]["feature_document"]), {})
    assert evaluated["result"]["evaluated_bodies"][0]["volume_mm3"] == pytest.approx(480)


def test_packaged_up_to_part_project_reopen_and_upstream_change(tmp_path):
    import math

    from aether_animation.aether_workspace import AetherWorkspace
    from test_native_automation import invoke as automate

    source=part(PART_DOCUMENT_VERSION)
    source['features']=[
        {'id':'stop-s','name':'Stop sketch','type':'profile','plane':'XY','offsetMillimeters':20,'suppressed':False,'profile':{'type':'circle','radiusMillimeters':20,'centerMillimeters':[0,0]}},
        {'id':'stop','name':'Stop','type':'extrude','profileFeatureId':'stop-s','distanceMillimeters':3,'operation':'new','bodyId':'stop','suppressed':False},
        {'id':'s','name':'Circle','type':'profile','plane':'XY','offsetMillimeters':0,'suppressed':False,'profile':{'type':'circle','radiusMillimeters':2,'centerMillimeters':[0,0]}},
        {'id':'e','name':'To part','type':'extrude','profileFeatureId':'s','distanceMillimeters':1,'endType':'up-to-part','endPartId':'stop','endOffsetMillimeters':2,'bodyId':'solid','operation':'new','suppressed':False}]
    for height in [20,30]:
        source['features'][0]['offsetMillimeters']=height
        original=created(tmp_path)
        part_id=original['project']['parts'][0]['id']
        saved=invoke(tmp_path,'project-edit',{**original,'operation':'save_part','part_id':part_id,'document':source})['result']
        reopened=AetherWorkspace.from_bytes(base64.b64decode(saved['data_base64']))
        document=reopened.part_definitions[part_id]['feature_document']
        assert document['features'][-1]['endPartId']=='stop'
        result=automate(tmp_path,'cad.part.evaluate',json.dumps(document),{})
        assert 'error' not in result,result
        body=result['result']['evaluated_bodies'][-1]
        assert body['volume_mm3']==pytest.approx(4*math.pi*(height-2))

        changed=automate(tmp_path,'cad.extrude.setoffset',json.dumps(document),{'feature_id':'e','end_offset_mm':3})
        assert 'error' not in changed,changed
        edited=json.loads(changed['content'])
        assert edited['features'][-1]['endPartId']=='stop'
        assert edited['features'][-1]['endOffsetMillimeters']==3
        result=automate(tmp_path,'cad.part.evaluate',changed['content'],{})
        assert result['result']['evaluated_bodies'][-1]['volume_mm3']==pytest.approx(4*math.pi*(height-3))


def test_packaged_up_to_vertex_project_and_automation(tmp_path):
    import math

    from aether_animation.aether_workspace import AetherWorkspace
    from test_native_automation import invoke as automate

    source=part(PART_DOCUMENT_VERSION)
    source['features']=[
        {'id':'guide','name':'Guide','type':'profile','plane':'XZ','offsetMillimeters':0,'suppressed':False,'profile':{'type':'drawing','contours':[{'id':'path','type':'path','construction':True,'start':[20,0],'startVertexId':'a','segments':[{'id':'edge','type':'line','end':[20,30],'endVertexId':'b'}]}]}},
        {'id':'s','name':'Circle','type':'profile','plane':'XY','offsetMillimeters':0,'suppressed':False,'profile':{'type':'circle','centerMillimeters':[0,0],'radiusMillimeters':2}},
        {'id':'e','name':'To point','type':'extrude','profileFeatureId':'s','distanceMillimeters':1,'operation':'new','bodyId':'solid','suppressed':False,'endType':'up-to-vertex','endPointReference':{'kind':'sketch-point','sourceFeatureId':'guide','contourId':'path','point':'vertex','vertexId':'b','label':'Guide end'}}]
    changed=automate(tmp_path,'cad.extrude.setoffset',json.dumps(source),{'feature_id':'e','end_offset_mm':3})
    assert 'error' not in changed,changed
    saved=json.loads(changed['content'])
    assert saved['formatVersion']==PART_DOCUMENT_VERSION
    assert saved['features'][-1]['endPointReference']==source['features'][-1]['endPointReference']
    original=created(tmp_path);part_id=original['project']['parts'][0]['id']
    project=invoke(tmp_path,'project-edit',{**original,'operation':'save_part','part_id':part_id,'document':saved})['result']
    reopened=AetherWorkspace.from_bytes(base64.b64decode(project['data_base64']))
    document=reopened.part_definitions[part_id]['feature_document']
    for height in [30,40]:
        document['features'][0]['profile']['contours'][0]['segments'][0]['end']=[20,height]
        result=automate(tmp_path,'cad.part.evaluate',json.dumps(document),{})
        assert 'error' not in result,result
        body=result['result']['evaluated_bodies'][0]
        assert body['id']=='solid'
        assert body['volume_mm3']==pytest.approx(4*math.pi*(height-3))


def test_packaged_reference_start_project_automation_and_upstream_edit(tmp_path):
    import math

    from aether_animation.aether_workspace import AetherWorkspace
    from test_native_automation import invoke as automate

    source=part(PART_DOCUMENT_VERSION)
    source['features']=[
        {'id':'datum','name':'Start datum','type':'plane','plane':'XY','offsetMillimeters':10,'suppressed':False},
        {'id':'s','name':'Circle','type':'profile','plane':'XY','offsetMillimeters':0,'suppressed':False,'profile':{'type':'circle','centerMillimeters':[0,0],'radiusMillimeters':2}},
        {'id':'e','name':'From datum','type':'extrude','profileFeatureId':'s','distanceMillimeters':5,'operation':'new','bodyId':'solid','suppressed':False,'startingReference':{'kind':'plane','sourceFeatureId':'datum','label':'Datum'}}]
    changed=automate(tmp_path,'cad.extrude.setdepth',json.dumps(source),{'feature_id':'e','depth_mm':7})
    assert 'error' not in changed,changed
    saved=json.loads(changed['content'])
    assert saved['features'][-1]['startingReference']==source['features'][-1]['startingReference']
    original=created(tmp_path);part_id=original['project']['parts'][0]['id']
    project=invoke(tmp_path,'project-edit',{**original,'operation':'save_part','part_id':part_id,'document':saved})['result']
    reopened=AetherWorkspace.from_bytes(base64.b64decode(project['data_base64']))
    document=reopened.part_definitions[part_id]['feature_document']
    assert document['formatVersion']==PART_DOCUMENT_VERSION
    for height in [10,20]:
        document['features'][0]['offsetMillimeters']=height
        result=automate(tmp_path,'cad.part.evaluate',json.dumps(document),{})
        assert 'error' not in result,result
        body=result['result']['evaluated_bodies'][0]
        assert body['id']=='solid'
        assert body['volume_mm3']==pytest.approx(28*math.pi)


def test_packaged_automatic_scope_project_updates_membership_without_freezing_targets(tmp_path):
    import math

    from aether_animation.aether_workspace import AetherWorkspace
    from test_native_automation import invoke as automate

    source=part(PART_DOCUMENT_VERSION)
    for key,z in [('a',0),('b',20),('other',40)]:
        source['features'].extend([
            {'id':key+'-s','name':key+' profile','type':'profile','plane':'XY','offsetMillimeters':z,'suppressed':False,'profile':{'type':'polygon','pointsMillimeters':[[-5,-5],[5,-5],[5,5],[-5,5]]}},
            {'id':key,'name':key,'type':'extrude','profileFeatureId':key+'-s','operation':'new','bodyId':key,'distanceMillimeters':5,'suppressed':False}])
    source['features'].extend([
        {'id':'s','name':'Circle','type':'profile','plane':'XY','offsetMillimeters':5,'suppressed':False,'profile':{'type':'circle','centerMillimeters':[0,0],'radiusMillimeters':2}},
        {'id':'e','name':'Automatic Add','type':'extrude','profileFeatureId':'s','distanceMillimeters':10,'operation':'add','scopeMode':'all','suppressed':False}])
    changed=automate(tmp_path,'cad.extrude.setdepth',json.dumps(source),{'feature_id':'e','depth_mm':15})
    assert 'error' not in changed,changed
    saved=json.loads(changed['content'])
    assert saved['features'][-1]['scopeResolution']=={'targets':['a','b'],'groups':[{'bodyId':'a','sources':['a','b']}]}
    original=created(tmp_path);part_id=original['project']['parts'][0]['id']
    project=invoke(tmp_path,'project-edit',{**original,'operation':'save_part','part_id':part_id,'document':saved})['result']
    reopened=AetherWorkspace.from_bytes(base64.b64decode(project['data_base64']))
    document=reopened.part_definitions[part_id]['feature_document']
    assert document['formatVersion']==PART_DOCUMENT_VERSION
    for depth,targets,volumes in [(10,['a'],[500+40*math.pi,500,500]),(36,['a','b','other'],[1500+120*math.pi])]:
        result=automate(tmp_path,'cad.extrude.setdepth',json.dumps(document),{'feature_id':'e','depth_mm':depth})
        assert 'error' not in result,result
        assert [b['volume_mm3'] for b in result['result']['evaluated_bodies']]==pytest.approx(volumes)
        document=json.loads(result['content']);feature=document['features'][-1]
        assert feature['scopeMode']=='all' and feature['scopeResolution']['targets']==targets
        assert 'targetBodyId' not in feature and 'targetBodyIds' not in feature


def test_packaged_curved_face_project_reopen_and_upstream_change(tmp_path):
    import math

    from aether_animation.aether_workspace import AetherWorkspace
    from test_native_automation import invoke as automate

    source = part(PART_DOCUMENT_VERSION)
    source['features'] = [
        {'id':'stop-s','name':'Cylinder profile','type':'profile','plane':'XZ','offsetMillimeters':-30,
         'suppressed':False,'profile':{'type':'circle','radiusMillimeters':10,'centerMillimeters':[0,20]}},
        {'id':'stop','name':'Stop','type':'extrude','profileFeatureId':'stop-s','distanceMillimeters':1,
         'operation':'new','bodyId':'stop','suppressed':False},
        {'id':'s','name':'Square','type':'profile','plane':'XY','offsetMillimeters':0,'suppressed':False,
         'profile':{'type':'polygon','pointsMillimeters':[[-2,-2],[2,-2],[2,2],[-2,2]]}},
        {'id':'e','name':'To curved face','type':'extrude','profileFeatureId':'s','distanceMillimeters':1,
         'endType':'up-to-face','endReference':{'sourceFeatureId':'stop','bodyId':'stop','surfaceType':'cylinder','label':'Cylinder'},
         'endOffsetMillimeters':2,'bodyId':'solid','operation':'new','suppressed':False}]
    original = created(tmp_path)
    part_id = original['project']['parts'][0]['id']
    project = invoke(tmp_path, 'project-edit', {**original, 'operation':'save_part',
                     'part_id':part_id, 'document':source})['result']
    assert invoke(tmp_path,'project-read',project)['result']['project'] == project['project']
    workspace = AetherWorkspace.from_bytes(base64.b64decode(project['data_base64']))
    saved = workspace.part_definitions[part_id]['feature_document']
    assert saved == {**source, 'documentId':part_id}
    for height in [20,25]:
        saved['features'][0]['profile']['centerMillimeters'][1] = height
        result = automate(tmp_path,'cad.part.evaluate',json.dumps(saved),{})
        assert 'error' not in result,result
        expected = 16*(height-2)-4*(2*math.sqrt(96)+100*math.asin(.2))
        assert result['result']['evaluated_bodies'][-1]['volume_mm3'] == pytest.approx(expected,abs=1e-5)
    saved['features'][-1]['endReference']['surfaceType'] = 'sphere'
    refused = automate(tmp_path,'cad.part.evaluate',json.dumps(saved),{})
    assert 'error' in refused and 'content' not in refused


def test_packaged_offset_face_project_preserves_sources_and_rebuilds_after_upstream_edit(tmp_path):
    import math

    from aether_animation.aether_workspace import AetherWorkspace
    from test_native_automation import invoke as automate
    source=part(PART_DOCUMENT_VERSION)
    source['features']=[
      {'id':'s','name':'Circle','type':'profile','plane':'XY','offsetMillimeters':0,'suppressed':False,'profile':{'type':'circle','centerMillimeters':[0,0],'radiusMillimeters':5}},
      {'id':'base','name':'Base','type':'extrude','profileFeatureId':'s','distanceMillimeters':10,'operation':'new','bodyId':'body','suppressed':False},
      {'id':'offset','name':'Offset faces','type':'offset-face','suppressed':False,'faces':[{'sourceFeatureId':'base','bodyId':'body','label':'Wall','surfaceType':'cylinder'}],'distanceMillimeters':2}]
    original=created(tmp_path);part_id=original['project']['parts'][0]['id']
    project=invoke(tmp_path,'project-edit',{**original,'operation':'save_part','part_id':part_id,'document':source})['result']
    assert invoke(tmp_path,'project-read',project)['result']['project']==project['project']
    workspace=AetherWorkspace.from_bytes(base64.b64decode(project['data_base64']))
    saved=workspace.part_definitions[part_id]['feature_document']
    assert saved=={**source,'documentId':part_id}
    for radius in [5,8]:
        saved['features'][0]['profile']['radiusMillimeters']=radius
        result=automate(tmp_path,'cad.part.evaluate',json.dumps(saved),{})
        assert 'error' not in result,result
        assert result['result']['evaluated_bodies'][0]['volume_mm3']==pytest.approx(math.pi*(radius+2)**2*10)
    saved['features'][-1]['distanceMillimeters']=-20
    refused=automate(tmp_path,'cad.part.evaluate',json.dumps(saved),{})
    assert 'error' in refused and 'content' not in refused


def test_packaged_transform_project_retains_independent_copies_and_upstream_history(tmp_path):
    import math

    from aether_animation.aether_workspace import AetherWorkspace
    from test_native_automation import invoke as automate
    source=part(PART_DOCUMENT_VERSION)
    source['features']=[
      {'id':'s','name':'Circle','type':'profile','plane':'XY','offsetMillimeters':0,'suppressed':False,'profile':{'type':'circle','centerMillimeters':[0,0],'radiusMillimeters':5}},
      {'id':'base','name':'Base','type':'extrude','profileFeatureId':'s','distanceMillimeters':10,'operation':'new','bodyId':'body','suppressed':False},
      {'id':'copy','name':'Copy','type':'transform','suppressed':False,'bodyIds':['body'],'copyBodyIds':{'body':'copy-body'},'transform':{'kind':'translate','translationMillimeters':[20,0,5]}},
      {'id':'finish','name':'Finish copy','type':'offset-face','suppressed':False,'faces':[{'sourceFeatureId':'copy','bodyId':'copy-body','label':'Top','normal':[0,0,1]}],'distanceMillimeters':2}]
    original=created(tmp_path);part_id=original['project']['parts'][0]['id']
    project=invoke(tmp_path,'project-edit',{**original,'operation':'save_part','part_id':part_id,'document':source})['result']
    assert invoke(tmp_path,'project-read',project)['result']['project']==project['project']
    workspace=AetherWorkspace.from_bytes(base64.b64decode(project['data_base64']))
    saved=workspace.part_definitions[part_id]['feature_document']
    assert saved=={**source,'documentId':part_id}
    for depth in [10,15]:
        saved['features'][1]['distanceMillimeters']=depth
        result=automate(tmp_path,'cad.part.evaluate',json.dumps(saved),{})
        assert 'error' not in result,result
        assert [b['id'] for b in result['result']['evaluated_bodies']]==['body','copy-body']
        assert [b['volume_mm3'] for b in result['result']['evaluated_bodies']]==pytest.approx([25*math.pi*depth,25*math.pi*(depth+2)])
    saved['features'][2]['bodyIds']=['missing']
    refused=automate(tmp_path,'cad.part.evaluate',json.dumps(saved),{})
    assert 'error' in refused and 'content' not in refused


def test_packaged_referenced_transform_project_keeps_links_and_rebuilds(tmp_path):
    from aether_animation.aether_workspace import AetherWorkspace
    from test_native_automation import invoke as automate

    source = part(PART_DOCUMENT_VERSION)
    source['features'] = [
        {'id': 's', 'name': 'Rectangle', 'type': 'profile', 'plane': 'XY', 'offsetMillimeters': 0, 'suppressed': False,
         'profile': {'type': 'polygon', 'pointsMillimeters': [[0, 0], [10, 0], [10, 20], [0, 20]]}},
        {'id': 'e', 'name': 'Block', 'type': 'extrude', 'profileFeatureId': 's', 'distanceMillimeters': 5,
         'operation': 'new', 'bodyId': 'body', 'suppressed': False},
        {'id': 'guide', 'name': 'Guide', 'type': 'profile', 'plane': 'XY', 'offsetMillimeters': 0, 'suppressed': False,
         'profile': {'type': 'drawing', 'contours': [{'id': 'path', 'type': 'path', 'construction': True, 'start': [0, 0],
                                                   'segments': [{'id': 'line', 'type': 'line', 'end': [3, 4]}]}]}},
        {'id': 'move', 'name': 'Move by line', 'type': 'transform', 'suppressed': False, 'bodyIds': ['body'],
         'transform': {'kind': 'translate-reference', 'reference': {'kind': 'sketch-line', 'sourceFeatureId': 'guide', 'contourId': 'path', 'segmentId': 'line'}}}]
    original = created(tmp_path)
    part_id = original['project']['parts'][0]['id']
    project = invoke(tmp_path, 'project-edit', {**original, 'operation': 'save_part', 'part_id': part_id, 'document': source})['result']
    reopened = AetherWorkspace.from_bytes(base64.b64decode(project['data_base64']))
    document = reopened.part_definitions[part_id]['feature_document']
    assert document['features'] == source['features']
    for endpoint in [[3, 4], [-8, 15]]:
        document['features'][2]['profile']['contours'][0]['segments'][0]['end'] = endpoint
        result = automate(tmp_path, 'cad.part.evaluate', json.dumps(document), {})
        assert 'error' not in result, result
        assert result['result']['evaluated_bodies'][0]['volume_mm3'] == pytest.approx(1000)


def test_packaged_edge_transform_project_follows_upstream_and_refuses_replaced_edge(tmp_path):
    from aether_animation.aether_workspace import AetherWorkspace
    from test_native_automation import invoke as automate

    features = [
        {'id': 's', 'kind': 'sketch-rectangle', 'parameters': {'width_mm': 10, 'height_mm': 20}},
        {'id': 'e', 'kind': 'pad', 'parameters': {'profile': 's', 'distance_mm': 5, 'operation': 'new', 'body_id': 'body'}}]
    built = invoke(tmp_path, 'geometry', {'features': features})['result']
    edge = next(c for f in built['bodies'][0]['topology'] for c in f['candidates']
                if c.get('edgeAnchor') and all(p['positionMillimeters'][:2] == [10, 20] for p in c['edgeAnchor'].values()))
    reference = {'kind': 'solid-edge', 'sourceFeatureId': 'e', 'bodyId': 'body', 'anchor': edge['edgeAnchor'], 'label': 'Vertical edge'}
    source = part(PART_DOCUMENT_VERSION)
    source['features'] = [
        {'id': 's', 'name': 'Rectangle', 'type': 'profile', 'plane': 'XY', 'offsetMillimeters': 0, 'suppressed': False,
         'profile': {'type': 'polygon', 'pointsMillimeters': [[0, 0], [10, 0], [10, 20], [0, 20]]}},
        {'id': 'e', 'name': 'Block', 'type': 'extrude', 'profileFeatureId': 's', 'distanceMillimeters': 5,
         'operation': 'new', 'bodyId': 'body', 'suppressed': False},
        {'id': 't', 'name': 'Move by edge', 'type': 'transform', 'suppressed': False, 'bodyIds': ['body'],
         'transform': {'kind': 'translate-reference', 'reference': reference}}]
    original = created(tmp_path)
    part_id = original['project']['parts'][0]['id']
    project = invoke(tmp_path, 'project-edit', {**original, 'operation': 'save_part', 'part_id': part_id, 'document': source})['result']
    saved = AetherWorkspace.from_bytes(base64.b64decode(project['data_base64'])).part_definitions[part_id]['feature_document']
    assert saved['features'] == source['features']
    for height in [5, 12]:
        saved['features'][1]['distanceMillimeters'] = height
        result = automate(tmp_path, 'cad.part.evaluate', json.dumps(saved), {})
        assert 'error' not in result, result
        assert result['result']['evaluated_bodies'][0]['volume_mm3'] == pytest.approx(200 * height)
    saved['features'][-1]['transform']['reference']['anchor']['start']['signature'] = 'replaced'
    result = automate(tmp_path, 'cad.part.evaluate', json.dumps(saved), {})
    assert 'error' in result and 'content' not in result
