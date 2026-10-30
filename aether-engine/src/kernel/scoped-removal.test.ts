import { beforeAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { makeBaseBox, makeCylinder, measureVolume, type Shape3D } from 'replicad';
import { initNodeKernel } from './node-kernel';
import './booleans';
import { scopedRemoval } from './scoped-removal';
import { evaluatePartDocument } from './part-evaluator';
import { createRectanglePartDocument, parsePartDocument, serializePartDocument } from '../document/index';

beforeAll(() => initNodeKernel(readFileSync(new URL('../../node_modules/replicad-opencascadejs/src/replicad_single.wasm', import.meta.url))), 30000);

it.each(['cut','intersect'] as const)('preserves exact %s volume and missed bodies, including a tool inside a bore', operation => {
  const owned: Shape3D[] = [];
  const own = <T>(shape:T):T => { owned.push(shape as Shape3D); return shape; };
  try {
    const box = own(makeBaseBox(20,20,10));
    const bore = own(makeCylinder(4,10));
    const target = own(box.cut(bore));
    const tool = own(makeCylinder(2,10,[7,0,0]));
    const result = scopedRemoval(target,tool,operation,own);
    const expected = operation === 'cut' ? 4000 - 200 * Math.PI : 40 * Math.PI;
    expect(result.volume).toBeCloseTo(expected, 5);
    expect(measureVolume(result.shape)).toBeCloseTo(expected, 5);
    for (const missedTool of [own(makeCylinder(1,10)),own(makeCylinder(2,10,[100,0,0]))]) {
      const missed = scopedRemoval(target,missedTool,operation,own);
      expect(missed.shape).toBe(target);
      expect(missed.removed).toBe(0);
    }
  } finally { owned.reverse().forEach(shape => shape.delete()); }
});

it('rebuilds scoped cuts after parameter edits and saved reopen, and refuses a consumed part', () => {
  const doc = createRectanglePartDocument('Scoped pocket',{widthMillimeters:20,heightMillimeters:20,depthMillimeters:10});
  const target = evaluatePartDocument(doc).parts[0].id;
  doc.features.push(
    {id:'hole',type:'profile',name:'Hole',plane:'XY',offsetMillimeters:10,suppressed:false,profile:{type:'circle',centerMillimeters:[0,0],radiusMillimeters:2}},
    {id:'cut',type:'extrude',name:'Pocket',profileFeatureId:'hole',distanceMillimeters:5,operation:'cut',targetBodyId:target,targetBodyIds:[target],suppressed:false},
  );
  const volume = () => {
    let measured = 0;
    evaluatePartDocument(parsePartDocument(serializePartDocument(doc)),{withBodies:bodies=>{measured=measureVolume(bodies.get(target)!);}});
    return measured;
  };
  expect(volume()).toBeCloseTo(4000-20*Math.PI,5);
  (doc.features.at(-1) as {distanceMillimeters:number}).distanceMillimeters=8;
  expect(volume()).toBeCloseTo(4000-32*Math.PI,5);
  const profile = doc.features.at(-2) as {profile:{radiusMillimeters:number}};
  profile.profile.radiusMillimeters=30;
  (doc.features.at(-1) as {distanceMillimeters:number}).distanceMillimeters=20;
  expect(volume).toThrow(/no valid solid/);
  profile.profile.radiusMillimeters=2;
  expect(volume()).toBeCloseTo(4000-40*Math.PI,5);
});
