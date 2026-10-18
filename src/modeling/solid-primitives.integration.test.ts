import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {expect,it} from 'vitest';
import {createEmptyPartDocument,parsePartDocument,serializePartDocument} from '@aether/core/document';
import {preparePartEdit} from '../automation/live-commands';
import {translateDocument} from '../freecad-translate';

it.skipIf(process.env.AETHER_FREECAD_INTEGRATION!=='1')('rebuilds, edits and exchanges the same agent/UI cone as a valid exact solid',()=>{
  const original=preparePartEdit(createEmptyPartDocument('Cone qualification'),'aether_cad_solid_primitive',{kind:'cone',radius_mm:8,height_mm:24}).document;
  const edited=parsePartDocument(serializePartDocument(original));
  const profile=edited.features[0];
  if(profile.type!=='profile'||profile.profile.type!=='polygon')throw Error('Cone requires a polygon profile');
  profile.profile.pointsMillimeters=[[0,0],[12,0],[0,30]];
  const documents=[original,edited,parsePartDocument(serializePartDocument(original))];
  const jobs=documents.map(doc=>{
    const translation=translateDocument(doc);expect(translation.untranslated).toEqual([]);
    return {protocol:1,features:translation.features};
  });
  const engineRoot=fileURLToPath(new URL('../../freecad-engine',import.meta.url));
  const result=spawnSync(process.env.AETHER_PYTHON??'python3',['-c',`
import sys,json,base64,tempfile,subprocess
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from aether_freecad import FreeCADEngine
from aether_freecad.protocol import job_from_json
results=[]
with FreeCADEngine() as engine:
 for payload in json.load(sys.stdin):
  job=job_from_json(payload)
  built=engine.build(job)
  assert built.status=='ok' and not built.diagnostics, built
  assert len(built.bodies)==1
  exported=engine.export(job,{'format':'step'})
  assert exported['status']=='ok', exported
  with tempfile.TemporaryDirectory(prefix='aether-cone-') as folder:
   path=Path(folder)/'cone.step';path.write_bytes(base64.b64decode(exported['data_base64']))
   out=Path(folder)/'metrics.json';script=Path(folder)/'read.py'
   script.write_text('import Part,json\\ns=Part.Shape();s.read('+repr(str(path))+')\\nb=s.BoundBox\\nopen('+repr(str(out))+',"w").write(json.dumps({"valid":s.isValid(),"solids":len(s.Solids),"volume":s.Volume,"bounds":[b.XMin,b.YMin,b.ZMin,b.XMax,b.YMax,b.ZMax]}))\\n')
   subprocess.run([engine.command,str(script)],input='',text=True,capture_output=True,timeout=20,check=True)
   results.append({'volume':built.bodies[0].volume_mm3,'faces':built.bodies[0].face_count,'step':json.loads(out.read_text())})
print(json.dumps(results))
`,engineRoot],{input:JSON.stringify(jobs),encoding:'utf8',timeout:60000});
  if(result.status!==0)throw Error(result.stderr||String(result.error));
  const measured=JSON.parse(result.stdout);
  for(const [index,r,h] of [[0,8,24],[1,12,30],[2,8,24]]){
    const geometry=measured[index],volume=Math.PI*r*r*h/3;
    expect(geometry.volume).toBeCloseTo(volume,6);
    expect(geometry.faces).toBe(2);
    expect(geometry.step.valid).toBe(true);expect(geometry.step.solids).toBe(1);
    expect(geometry.step.volume).toBeCloseTo(volume,5);
    for(const [axis,value] of [-r,-r,0,r,r,h].entries())expect(geometry.step.bounds[axis]).toBeCloseTo(value,6);
  }
  expect(edited.features.map(feature=>feature.id)).toEqual(original.features.map(feature=>feature.id));
},90000);
