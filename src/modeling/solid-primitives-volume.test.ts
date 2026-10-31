/** Primitive oracle without FreeCAD: each editable primitive history evaluates to its
 *  closed-form volume on the Aether engine. */
import { beforeAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { initNodeKernel, solidMeasures } from '@aether/core/kernel/node';
import { evaluatePartDocument } from '@aether/core/kernel';
import { appendSolidPrimitive, type SolidPrimitive } from './solid-primitives';

beforeAll(async () => { await initNodeKernel(readFileSync(new URL('../../aether-engine/node_modules/replicad-opencascadejs/src/replicad_single.wasm', import.meta.url))); }, 30000);
const dimensions = { width: 20, length: 30, height: 10, radius: 10, tubeRadius: 3 };
const expected: Record<SolidPrimitive, number> = {
  box: 20 * 30 * 10,
  cylinder: Math.PI * 10 ** 2 * 10,
  cone: Math.PI * 10 ** 2 * 10 / 3,
  sphere: 4 / 3 * Math.PI * 10 ** 3,
  torus: 2 * Math.PI ** 2 * 10 * 3 ** 2,
};
for (const kind of Object.keys(expected) as SolidPrimitive[]) it(`builds a ${kind} with its analytic volume`, () => {
  let volume = 0;
  evaluatePartDocument(appendSolidPrimitive(null, kind, dimensions), { withBodies: bodies => { for (const body of bodies.values()) volume += solidMeasures(body).volume_mm3; } });
  expect(volume / expected[kind]).toBeCloseTo(1, 6);
}, 30000);
