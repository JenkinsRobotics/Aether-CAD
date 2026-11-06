import { beforeAll, afterAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { measureVolume } from 'replicad';
import { parsePartDocument } from '../document';
import { initNodeKernel, runNodeOperation } from './node-kernel';
import { evaluatePartDocument, resetEvaluationCache } from './part-evaluator';

beforeAll(async () => {
  await initNodeKernel(readFileSync(new URL('../../node_modules/replicad-opencascadejs/src/replicad_single.wasm', import.meta.url)));
}, 30000);
afterAll(resetEvaluationCache);

it('explains a failed smooth interpolation and restores the authored ruled solid', async () => {
  // Actual native sections from the shipped Shuttle, not an imported solid.
  const original = parsePartDocument(readFileSync(new URL('./fixtures/shuttle-loft.part.json', import.meta.url), 'utf8'));
  const candidate = structuredClone(original);
  const loft = candidate.features.at(-1)!;
  if (loft.type !== 'loft') throw new Error('Fixture must end in a loft');
  loft.ruled = false;
  for (let trial = 0; trial < 3; trial++) {
    await expect(runNodeOperation(candidate, () => evaluatePartDocument(candidate)))
      .rejects.toThrow('Loft produced an inverted or degenerate solid');
    await runNodeOperation(original, () => evaluatePartDocument(original, { withBodies: bodies => {
      expect(bodies.size).toBe(1);
      expect(measureVolume([...bodies.values()][0])).toBeCloseTo(884822.1752185362, 4);
    } }));
  }
}, 30000);
