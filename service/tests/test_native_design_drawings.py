"""Drawings remain in the same Hybrid archive through edits and metadata changes."""
import base64
import json
import subprocess
import sys
import pytest
from pathlib import Path
from test_native_browser import invoke
from test_native_projects import created
from test_native_drawing_settings import drawing


def change(tmp_path, base, method, **params):
    opened = invoke(tmp_path, 'assembly', {'operation':'workspace', 'method':'load_workspace', 'params':{'handle':'test'}, 'data_base64':base['data_base64']})['result']
    result = invoke(tmp_path, 'assembly', {'operation':'workspace', 'method':method, 'params':{'handle':'test','expected_revision':opened['archive']['revision'], **params},'data_base64':base['data_base64']})
    return result.get('result',result)


@pytest.mark.parametrize("version", [1, 2, 3, 4, 5])
def test_embedded_drawing_roundtrip_metadata_recycle_and_other_edits(tmp_path, version):
    base = created(tmp_path)
    intent = drawing(); intent['formatVersion'] = version
    added = change(tmp_path, base, 'add_drawing', name='Manufacturing', document=intent)
    key = added['result']['drawings'][0]['id']
    base = added['archive']
    projected = invoke(tmp_path, 'project-read', base)['result']['project']
    assert projected['drawings'][0]['document']['documentId'] == key
    assert projected['parts'] == added['result']['parts']
    added_assembly = invoke(tmp_path, 'project-edit', {**base,'operation':'add_assembly','name':'Nested'})['result']
    assert added_assembly['project']['drawings'] == projected['drawings']
    doc = projected['drawings'][0]['document']; doc['sheets'][0]['name']='Changed sheet'
    edited = change(tmp_path, added_assembly, 'save_drawing', name='Drawing edited', drawing_id=key, document=doc)
    props = invoke(tmp_path, 'settings-edit', {**edited['archive'], 'operation':'properties','item_id':key,'name':'Release print','description':'Detail','category':'Manufacturing','quantities':{}})['result']
    meta = invoke(tmp_path, 'settings-read', props)['result']
    assert next(i for i in meta['items'] if i['id']==key)['description']=='Detail'
    deleted = invoke(tmp_path, 'settings-edit', {**props,'operation':'delete_item','item_id':key})['result']
    assert not invoke(tmp_path, 'project-read', deleted)['result']['project'].get('drawings')
    restored = invoke(tmp_path, 'settings-edit', {**deleted,'operation':'restore_item','item_id':key})['result']
    final = invoke(tmp_path, 'project-read', restored)['result']['project']
    assert final['drawings'][0]['document']['sheets'][0]['name']=='Changed sheet'
    assert final['drawings'][0]['document']['name']=='Release print'
    assert final['parts']==projected['parts']
    assert final['drawings'][0]['document']['formatVersion'] == version
    # The shipped previous codec must refuse the new graph, never drop drawings.
    old = Path(__file__).parents[2]/'vendor/python/aether_animation-0.1.0-22-py3-none-any.whl'
    archive = tmp_path/'hybrid.aethercad';archive.write_bytes(base64.b64decode(restored['data_base64']))
    script='import sys;sys.path.insert(0,sys.argv[1]);from aether_animation.aether_workspace import AetherWorkspace;AetherWorkspace.from_bytes(open(sys.argv[2],"rb").read())'
    result=subprocess.run([sys.executable,'-I','-S','-c',script,str(old),str(archive)],capture_output=True,text=True)
    assert result.returncode != 0 and 'unsupported semantic graph version' in result.stderr
    if version >= 3:
        previous = Path(__file__).parents[2]/'vendor/python/aether_animation-0.1.0-31-py3-none-any.whl'
        result = subprocess.run([sys.executable, '-I', '-S', '-c', script, str(previous), str(archive)], capture_output=True, text=True)
        assert result.returncode != 0 and 'Unsupported Drawing document' in result.stderr



def test_drawing_mutation_rejects_invalid_source_and_stale_revision(tmp_path):
    base=created(tmp_path)
    bad=drawing();bad['source']['formatVersion']=999
    result=change(tmp_path,base,'add_drawing',name='Bad',document=bad)
    assert result.get('error')
    result=change(tmp_path,base,'add_drawing',name='Bad',document=drawing(),expected_revision='stale')
    assert result.get('error')
