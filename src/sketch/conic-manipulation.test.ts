import { expect, it } from 'vitest';
import type { SketchDrawing, SketchEntityRef } from '@aether/core/sketch';
import { conicDragTarget, conicHandles, setConicCurvature } from '../../freecad-engine/browser/conic-manipulation';
import { createSketchConic } from '../../freecad-engine/browser/conic-authoring';
import { fixedEntityConstraint } from '../../freecad-engine/browser/fixed-geometry';
import { sketchEntitiesInBox } from './box-selection';

const ref: SketchEntityRef = { contour: 0, kind: 'curve', index: 0, parameter: .5 };
const drawing = () => createSketchConic({ type: 'drawing', contours: [] }, [[0, 0], [20, 0], [10, 20], [10, 8]]);
const segment = (d: SketchDrawing, contour = 0) => {
  const path = d.contours[contour];
  if (path.type !== 'path' || path.segments[0].type !== 'conic') throw Error('Expected conic');
  return path.segments[0];
};

it('derives a midpoint handle without inventing saved geometry or a point reference', () => {
  const d = drawing(), before = structuredClone(d), [h] = conicHandles(d);
  expect(h.point).toEqual([10, 8]); expect(h.ref).toMatchObject(ref);
  expect(h.midpoint).toEqual([10, 0]); expect(h.control).toEqual([10, 20]);
  expect(d).toEqual(before);
});
it.each([.2, .5, .8])('edits the existing scalar driver to %s without moving endpoints/control', rho => {
  const d = drawing(), before = structuredClone(d), next = setConicCurvature(d, ref, rho);
  expect(segment(next)).toEqual({ ...segment(before), rho });
  expect(next.constraints).toHaveLength(1); expect(next.constraints![0]).toMatchObject({ id: d.constraints![0].id, value: rho });
  expect(next.contours[0].type === 'path' && next.contours[0].start).toEqual([0, 0]); expect(d).toEqual(before);
});
it('preserves grab offset and projects along the curvature axis, with optional parabolic snap', () => {
  const d = drawing();
  expect(conicDragTarget(d, ref, [11, 9], [18, 15]).rho).toBeCloseTo(.7, 12);
  expect(conicDragTarget(d, ref, [10, 8], [10, 10.1], .2)).toMatchObject({ rho: .5, snapped: true, point: [10, 10] });
  const unsnapped = conicDragTarget(d, ref, [10, 8], [10, 10.1], 0);
  expect(unsnapped.rho).toBeCloseTo(.505, 12); expect(unsnapped.snapped).toBe(false);
});
it('bounds pointer drags at both ends without invalid conics; typed values still reject invalid domains', () => {
  const d = drawing();
  expect(conicDragTarget(d, ref, [10, 8], [10, -100]).rho).toBe(1e-6);
  expect(conicDragTarget(d, ref, [10, 8], [10, 100]).rho).toBe(1 - 1e-6);
  for (const rho of [0, 1, NaN, Infinity]) expect(() => setConicCurvature(d, ref, rho)).toThrow(/rho/);
});
it('inverts a linked driver and solves its other conic while retaining the selected geometry', () => {
  const d = createSketchConic(drawing(), [[40, 0], [60, 0], [50, 20], [50, 6]]);
  const follower = d.constraints![1]; delete follower.value;
  follower.valueFrom = d.constraints![0].id; follower.valueScale = .5; follower.valueOffset = .1;
  const next = setConicCurvature(d, { ...ref, contour: 1 }, .4);
  expect(next.constraints![0].value).toBeCloseTo(.6, 10);
  expect(segment(next).rho).toBeCloseTo(.6, 6); expect(segment(next, 1).rho).toBe(.4);
  expect(segment(next, 1).control).toEqual([50, 20]); expect(next.constraints![1]).toEqual(follower);
});
it('refuses formulas and whole-curve Fix atomically', () => {
  const formula = drawing(); formula.constraints![0].valueExpression = '#shape';
  expect(() => setConicCurvature(formula, ref, .6)).toThrow(/formula/);
  const fixed = drawing(); fixed.constraints!.push(fixedEntityConstraint(fixed, ref)); const before = structuredClone(fixed);
  expect(() => setConicCurvature(fixed, ref, .6)).toThrow(/constraints/i); expect(fixed).toEqual(before);
});
it('does not add a driver when only reference dimensions exist', () => {
  const d = drawing(); delete d.constraints![0].value; d.constraints![0].reference = true;
  const next = setConicCurvature(d, ref, .6); expect(next.constraints).toEqual(d.constraints); expect(segment(next).rho).toBe(.6);
});
it('uses stable segment identity and rejects projected geometry', () => {
  const d = drawing(); segment(d).id = 'conic';
  expect(segment(setConicCurvature(d, { ...ref, index: 40, segmentId: 'conic' }, .6)).rho).toBe(.6);
  expect(() => setConicCurvature(d, { ...ref, projectedContourId: 'external' }, .6)).toThrow(/read-only/);
  expect(() => conicDragTarget(d, { ...ref, projectedContourId: 'external' }, [0, 0], [1, 1])).toThrow(/read-only/);
});
it('box-selects conics with a usable curve contact reference', () => {
  const refs = sketchEntitiesInBox(drawing(), p => p, { left: -1, top: -1, right: 21, bottom: 21 }, 'window');
  expect(refs).toContainEqual(ref);
});

it('updates a legacy literal expression instead of treating it as a variable formula', () => {
  const d = drawing(); d.constraints![0].valueExpression = '0.4';
  const next = setConicCurvature(d, ref, .6); expect(segment(next).rho).toBe(.6);
  expect(next.constraints![0].valueExpression).toBeUndefined(); expect(d.constraints![0].valueExpression).toBe('0.4');
});
it('allows linked curvature on another segment in the same contour to follow the edit', () => {
  const d = drawing(), path = d.contours[0]; if (path.type !== 'path') throw Error();
  path.segments.push({ type: 'conic', end: [40, 0], control: [30, 20], rho: .3 });
  d.constraints!.push({ id: 'follower', kind: 'conic-rho', a: { ...ref, index: 1 }, valueFrom: d.constraints![0].id, valueScale: .5, valueOffset: .1 });
  const next = setConicCurvature(d, { ...ref, index: 1 }, .4), result = next.contours[0];
  if (result.type !== 'path' || result.segments[1].type !== 'conic') throw Error();
  expect(segment(next).rho).toBeCloseTo(.6, 6); expect(result.segments[1].rho).toBeCloseTo(.4, 8);
  expect(result.segments[1].end).toEqual([40, 0]); expect(result.segments[1].control).toEqual([30, 20]);
  expect(next.constraints!.map(c => c.id)).toEqual(d.constraints!.map(c => c.id));
});
