import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {expect,it} from 'vitest';
import {exampleAssemblyRecipe} from './assembly-recipe';

it.skipIf(!process.env.AETHER_CAD_RECIPE_WORKER)('qualifies real arrays and mates in the packaged worker, then reopens the saved graph',()=>{
  const input={linear:exampleAssemblyRecipe('linear'),circular:exampleAssemblyRecipe('circular'),single:exampleAssemblyRecipe(),template:exampleAssemblyRecipe('template')};
  const result=spawnSync(process.env.AETHER_PYTHON??'python3',['-c',`
import sys,json,base64,zipfile,io,subprocess,tempfile,shutil,math
from pathlib import Path
sys.path.insert(0,sys.argv[2])
from aether_freecad import locate_freecad
recipes=json.load(sys.stdin)
with tempfile.TemporaryDirectory(prefix='aether-recipe-') as tmp:
 def call(name,args):
  proc=subprocess.run([sys.executable,'-I','-S',sys.argv[1],shutil.which('node'),locate_freecad()],input=json.dumps({'service':'/api/cad/'+name,'arguments':args}),text=True,capture_output=True,cwd=tmp,timeout=60)
  assert proc.returncode==0 and not proc.stderr,(proc.returncode,proc.stderr)
  return json.loads(proc.stdout)
 created=call('project-create',{'name':'Assembly test','operation_id':'fixed-recipe','packaging':'assembly'})['result']
 def graph(encoded):
  with zipfile.ZipFile(io.BytesIO(base64.b64decode(encoded))) as archive:return json.loads(archive.read('state/graph.json'))
 root=created['project']['assemblies'][0]['id']
 summaries=[]
 for kind in ['linear','circular','single']:
  source=graph(created['data_base64'])
  args={'data_base64':created['data_base64'],'expected_revision':str(source['revision']),'assembly_id':root,'recipe':recipes[kind]}
  response=call('assembly-compose',args)
  assert 'result' in response,(kind,response)
  r=response['result'];g=graph(r['data_base64'])
  reopened=call('project-read',{'data_base64':r['data_base64']})['result']
  assert len(reopened['project']['parts'])==1
  assert len(g['instances'])=={'linear':4,'circular':6,'single':1}[kind]
  assert abs(r['evaluated_parts'][0]['volume_mm3']-1000)<1e-6
  assert len({v['definition_id'] for v in g['instances']})==1
  summaries.append({'kind':kind,'count':len(g['instances']),'volume':r['evaluated_parts'][0]['volume_mm3']})
 # Both endpoint frames persist and solve for each supported authoring mate.
 for kind in ['fastened','revolute','prismatic']:
  recipe=json.loads(json.dumps(recipes['single']))
  recipe['instances'].append({'key':'moving','part':'block','position_mm':[0,0,0]})
  recipe['mates']=[{'key':'joint','kind':kind,'a':{'instance':'Block:1'},'b':{'instance':'moving'}}]
  args={'data_base64':created['data_base64'],'expected_revision':str(source['revision']),'assembly_id':root,'recipe':recipe}
  response=call('assembly-compose',args)
  assert 'result' in response,(kind,response)
  g=graph(response['result']['data_base64']);assert len(g['mates'])==1 and len(g['connector_definitions'])==2
  assert call('project-read',{'data_base64':response['result']['data_base64']}).get('result')
  summaries.append({'mate':kind,'instances':2})
 # A reusable template can be defined before any instances are placed.
 template=call('assembly-compose',{'data_base64':created['data_base64'],'expected_revision':str(source['revision']),'assembly_id':root,'recipe':recipes['template']})
 assert 'result' in template,template
 r=template['result'];assert r['instance_count']==0 and len(r['evaluated_parts'])==1
 reuse=json.loads(json.dumps(recipes['linear']));reuse['parts']=[{'key':'block','part_id':r['ids']['parts']['block']}]
 placed=call('assembly-compose',{'data_base64':r['data_base64'],'expected_revision':r['revision'],'assembly_id':root,'recipe':reuse})
 assert 'result' in placed,placed
 g=graph(placed['result']['data_base64']);assert len(g['part_definitions'])==1 and len(g['instances'])==4
 summaries.append({'templateThenInstances':True})
 # Failures return no candidate archive, including stale revisions and bad geometry.
 args['expected_revision']='stale';assert 'error' in call('assembly-compose',args)
 args['expected_revision']=str(source['revision']);args['recipe']['parts'][0]['document']['features'][1]['distanceMillimeters']=-1
 assert 'error' in call('assembly-compose',args)
 print(json.dumps(summaries))
`,resolve(process.env.AETHER_CAD_RECIPE_WORKER!),resolve('freecad-engine')],{input:JSON.stringify(input),encoding:'utf8',timeout:180000});
  if(result.status!==0)throw Error(result.stderr||String(result.error));
  const summaries=JSON.parse(result.stdout);expect(summaries).toHaveLength(7);
  expect(summaries.slice(0,3).map((v:any)=>v.count)).toEqual([4,6,1]);
},190000);
