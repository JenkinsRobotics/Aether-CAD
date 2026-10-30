import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {makeBaseBox,makeCylinder,measureVolume,type Shape3D} from 'replicad';
import {initNodeKernel,solidMeasures} from '../../aether-engine/src/kernel/node-kernel';
import '../../aether-engine/src/kernel/booleans';
import {scopedRemoval} from '../../aether-engine/src/kernel/scoped-removal';

await initNodeKernel(readFileSync('aether-engine/node_modules/replicad-opencascadejs/src/replicad_single.wasm'));
const owned:Shape3D[]=[];
const own=<T>(shape:T):T=>{owned.push(shape as Shape3D);return shape;};
try {
  let target=own(makeBaseBox(80,50,10));
  for(let i=0;i<12;i++) target=own(target.cut(own(makeCylinder(2,10,[-30+(i%6)*12,-12+Math.floor(i/6)*24,0]))));
  const tool=own(makeCylinder(6,10));
  const results=[];
  for(const operation of ['cut','intersect'] as const){
    const timings:{before:number[];after:number[]}={before:[],after:[]};
    let expected:ReturnType<typeof solidMeasures>|undefined;
    for(let round=0;round<9;round++) for(const phase of (round%2?['before','after']:['after','before']) as ('before'|'after')[]){
      const scratch:Shape3D[]=[];
      const keep=<T>(value:T):T=>{scratch.push(value as Shape3D);return value;};
      const start=performance.now();
      let shape:Shape3D;
      if(phase==='before'){
        const hit=measureVolume(keep(target.intersect(tool)))>1e-9;
        shape=hit?keep(operation==='cut'?target.cut(tool):target.intersect(tool)):target;
        measureVolume(target);measureVolume(shape);measureVolume(shape);
      }else shape=scopedRemoval(target,tool,operation,keep).shape;
      const ms=performance.now()-start;
      if(round>1)timings[phase].push(ms);
      const actual=solidMeasures(shape);
      if(expected){assert.equal(actual.face_count,expected.face_count);assert.equal(actual.edge_count,expected.edge_count);assert.ok(Math.abs(actual.volume_mm3-expected.volume_mm3)<1e-7);}
      else expected=actual;
      scratch.reverse().forEach(s=>s.delete());
    }
    const median=(a:number[])=>a.slice().sort((a,b)=>a-b)[Math.floor(a.length/2)];
    results.push({operation,beforeMs:median(timings.before),afterMs:median(timings.after),samples:timings,measures:expected});
  }
  writeFileSync(process.env.AETHER_SCOPE_EVIDENCE??'build/kernel-scope-performance.json',JSON.stringify(results,null,2));
  console.log(JSON.stringify(results));
}finally{owned.reverse().forEach(shape=>shape.delete());}
