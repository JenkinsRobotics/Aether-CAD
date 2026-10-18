// @vitest-environment jsdom
import {spawnSync} from 'node:child_process';
import {expect,it} from 'vitest';
import {appendVector} from './vector-insert';
import {insertFeature,parsePartDocument,serializePartDocument} from '@aether/core/document';
import {translateDocument} from '../freecad-translate';
it.skipIf(process.env.AETHER_FREECAD_INTEGRATION!=='1')('extrudes inserted SVG and DXF through the real native kernel after save/reopen',()=>{
 const dxf=['0','SECTION','2','ENTITIES','0','LWPOLYLINE','90','4','70','1','10','0','20','0','10','10','20','0','10','10','20','5','10','0','20','5','0','ENDSEC','0','EOF'].join('\n');
 const documents=[appendVector(null,'plate.svg','<svg><path d="M0 0 L40 0 L40 30 L0 30 Z"/></svg>','svg','XY',1),appendVector(null,'plate.dxf',dxf,'dxf','XZ',2)].map(doc=>insertFeature(doc,{id:'extrude',type:'extrude',name:'Extrude',suppressed:false,profileFeatureId:doc.features[0].id,operation:'new',bodyId:'body',distanceMillimeters:5}));
 const jobs=documents.map(doc=>{const translated=translateDocument(parsePartDocument(serializePartDocument(doc)));expect(translated.untranslated).toEqual([]);return {protocol:1,features:translated.features,rollback:null};});
 const engine=`${process.cwd()}/freecad-engine`;
 const result=spawnSync(process.env.AETHER_PYTHON??'python3',['-c',`import sys,json
sys.path.insert(0,sys.argv[1])
from aether_freecad import FreeCADEngine
from aether_freecad.protocol import job_from_json
with FreeCADEngine() as engine:
 results=[]
 for job in json.load(sys.stdin):
  r=engine.build(job_from_json(job));results.append({'status':r.status,'diagnostics':r.diagnostics,'volume':sum(b.volume_mm3 for b in r.bodies)})
 print(json.dumps(results))`,engine],{input:JSON.stringify(jobs),encoding:'utf8',timeout:45000});
 if(result.status!==0)throw Error(result.stderr||String(result.error));
 const values=JSON.parse(result.stdout);expect(values.map((v:{status:string})=>v.status)).toEqual(['ok','ok']);expect(values[0].volume).toBeCloseTo(6000);expect(values[1].volume).toBeCloseTo(1000);
},60000);
