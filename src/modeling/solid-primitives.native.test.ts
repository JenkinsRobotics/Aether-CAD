import {spawnSync} from 'node:child_process';
import {expect,it} from 'vitest';
import {appendSolidPrimitive,defaultPrimitiveDimensions as defaults,type SolidPrimitive} from './solid-primitives';
import {parsePartDocument,serializePartDocument} from '@aether/core/document';
import {translateDocument} from '../freecad-translate';
it.skipIf(process.env.AETHER_FREECAD_INTEGRATION!=='1')('builds four exact solids with analytic volumes after reopening',()=>{
 const kinds:SolidPrimitive[]=['box','cylinder','sphere','torus'];
 const jobs=kinds.map(kind=>({protocol:1,features:translateDocument(parsePartDocument(serializePartDocument(appendSolidPrimitive(null,kind,defaults)))).features}));
 const result=spawnSync('python3',['-c',`import sys,json
sys.path.insert(0,sys.argv[1])
from aether_freecad import FreeCADEngine
from aether_freecad.protocol import job_from_json
with FreeCADEngine() as engine:
 output=[]
 for job in json.load(sys.stdin):
  r=engine.build(job_from_json(job));output.append({'status':r.status,'diagnostics':r.diagnostics,'volumes':[b.volume_mm3 for b in r.bodies]})
 print(json.dumps(output))`,process.env.AETHER_TEST_ENGINE_PATH??`${process.cwd()}/freecad-engine`],{input:JSON.stringify(jobs),encoding:'utf8',timeout:60000});
 if(result.status!==0)throw Error(result.stderr||String(result.error));
 const output=JSON.parse(result.stdout),expected=[6000,Math.PI*1000,4*Math.PI*1000/3,2*Math.PI**2*10*9];
 output.forEach((r:{status:string;volumes:number[]},index:number)=>{
  expect(r.status,JSON.stringify(r)).toBe('ok');expect(r.volumes).toHaveLength(1);expect(r.volumes[0]).toBeCloseTo(expected[index],5);
 });
},65000);
