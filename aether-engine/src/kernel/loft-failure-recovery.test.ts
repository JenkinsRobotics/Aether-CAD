import { beforeAll, afterAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { getOC, makeVertex, measureDistanceBetween, measureVolume } from 'replicad';
import { parsePartDocument } from '../document';
import { initNodeKernel, runNodeOperation } from './node-kernel';
import { evaluatePartDocument, resetEvaluationCache } from './part-evaluator';

beforeAll(async () => {
  await initNodeKernel(readFileSync(new URL('../../node_modules/replicad-opencascadejs/src/replicad_single.wasm', import.meta.url)));
}, 30000);
afterAll(resetEvaluationCache);

it('recovers smooth interpolation without changing the authored ruled solid', async () => {
  // Actual native sections from the shipped Shuttle, not an imported solid.
  const original = parsePartDocument(readFileSync(new URL('./fixtures/shuttle-loft.part.json', import.meta.url), 'utf8'));
  const candidate = structuredClone(original);
  const loft = candidate.features.at(-1)!;
  if (loft.type !== 'loft') throw new Error('Fixture must end in a loft');
  loft.ruled = false;
  for (let trial = 0; trial < 3; trial++) {
    await runNodeOperation(candidate, () => evaluatePartDocument(candidate, { withBodies: bodies => {
      expect(bodies.size).toBe(1);
      const solid = [...bodies.values()][0];
      const check = new (getOC().BRepCheck_Analyzer)(solid.wrapped, true, false);
      try { expect(check.IsValid_2()).toBe(true); } finally { check.delete(); }
      // Every authored station must still lie on the resulting boundary, not
      // merely inside a positive-volume body. Include curved-edge midpoints.
      const faces = solid.faces;
      try {
        for (const feature of original.features) {
          if (feature.type !== 'profile' || feature.profile.type !== 'drawing') continue;
          for (const contour of feature.profile.contours) {
            if (contour.type !== 'path') continue;
            let previous = contour.start;
            for (const segment of contour.segments) {
              const middle = segment.type === 'arc' ? segment.middle
                : [(previous[0] + segment.end[0]) / 2, (previous[1] + segment.end[1]) / 2];
              for (const point of [segment.end, middle]) {
                const vertex = makeVertex([point[0], point[1], feature.offsetMillimeters]);
                try { expect(Math.min(...faces.map(face => measureDistanceBetween(vertex, face)))).toBeLessThan(1e-4); }
                finally { vertex.delete(); }
              }
              previous = segment.end;
            }
          }
        }
      } finally { faces.forEach(face => face.delete()); }
      expect(measureVolume(solid)).toBeGreaterThan(700000);
      expect(measureVolume(solid)).toBeLessThan(900000);
    } }));
    await runNodeOperation(original, () => evaluatePartDocument(original, { withBodies: bodies => {
      expect(bodies.size).toBe(1);
      expect(measureVolume([...bodies.values()][0])).toBeCloseTo(884822.1752185362, 4);
    } }));
  }
}, 30000);
