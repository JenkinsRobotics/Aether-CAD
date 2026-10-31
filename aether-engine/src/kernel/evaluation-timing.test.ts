import { beforeAll, afterEach, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { initNodeKernel } from './node-kernel';
import { evaluatePartDocument, resetEvaluationCache } from './part-evaluator';
import { createRectanglePartDocument } from '../document/part-document';
import type { EvaluationTiming } from './evaluation-timing';

beforeAll(async () => {
  await initNodeKernel(readFileSync(new URL('../../node_modules/replicad-opencascadejs/src/replicad_single.wasm', import.meta.url)));
}, 30000);
afterEach(resetEvaluationCache);

it('separates actual feature replay from cached display preparation without changing geometry', () => {
  const doc = createRectanglePartDocument('Measured block', {widthMillimeters:30,heightMillimeters:20,depthMillimeters:10});
  const events: EvaluationTiming[] = [];
  const cold = evaluatePartDocument(doc, {observe:e=>events.push(e)});
  expect(events.filter(e=>e.phase==='feature').map(e=>e.id)).toEqual(doc.features.map(f=>f.id));
  expect(events.find(e=>e.phase==='display')).toMatchObject({cached:false});
  expect(events.every(e=>Number.isFinite(e.milliseconds) && e.milliseconds>=0)).toBe(true);
  events.length=0;
  const repeated=evaluatePartDocument(doc,{observe:e=>events.push(e)});
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({phase:'display',cached:true});
  expect(repeated.parts).toEqual(cold.parts);
  const last=doc.features[1];
  if(last.type!=='extrude') throw new Error('fixture');
  last.distanceMillimeters=12;
  events.length=0;
  const edited=evaluatePartDocument(doc,{observe:e=>events.push(e)});
  expect(events.filter(e=>e.phase==='feature').map(e=>e.id)).toEqual([last.id]);
  expect(edited.parts[0].vertices).not.toEqual(cold.parts[0].vertices);
});
