import { afterEach, beforeAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import init from 'replicad-opencascadejs';
import { assembleWire, makeBaseBox, makeCircle, makeLine, makeSphere, measureArea, setOC, type AnyShape, type Face, type Shape3D } from 'replicad';
import './booleans';
import { buildSurfaceExtrusion, type SurfaceExtrusionEnd, type SurfaceExtrusionOptions } from './surface-extrusion';

beforeAll(async () => setOC(await (init as any)({ wasmBinary: readFileSync(new URL('../../node_modules/replicad-opencascadejs/src/replicad_single.wasm', import.meta.url)) })), 30000);
const owned: AnyShape[] = [];
const own = <T extends AnyShape>(shape: T): T => { owned.push(shape); return shape; };
afterEach(() => { owned.reverse().forEach(shape => shape.delete()); owned.length = 0; });
const line = () => own(assembleWire([own(makeLine([-5, 0, 0], [5, 0, 0]))]));
const box = (z = 10) => own(makeBaseBox(40, 40, 5).translate(0, 0, z));
function bottom(shape: Shape3D): Face {
  const faces = shape.faces.map(own);
  return faces.find(face => { const n = face.normalAt(); try { return n.z < -0.99; } finally { n.delete(); } })!;
}
function make(primary: SurfaceExtrusionEnd, extra: Partial<SurfaceExtrusionOptions> = {}) {
  const result = buildSurfaceExtrusion({ wires: [line()], origin: [0, 0, 0], normal: [0, 0, 1], direction: [0, 0, 1], primary, ...extra });
  own(result.shape); return result;
}
const bounds = (shape: Shape3D) => shape.boundingBox.bounds.flat().map(x => Math.round(x * 1e5) / 1e5 + 0);

it('sweeps open and closed curves without caps, supports oblique travel and independent ends', () => {
  const result = make({ type: 'blind', distance: 8 }, { startingOffset: 2, second: { type: 'blind', distance: 3 } });
  expect(measureArea(result.shape)).toBeCloseTo(110, 6);
  expect(bounds(result.shape)).toEqual([-5, 0, -1, 5, 0, 10]);
  const oblique = make({ type: 'blind', distance: 10 }, { direction: [0, 0.6, 0.8] });
  expect(measureArea(oblique.shape)).toBeCloseTo(100, 6);
  expect(bounds(oblique.shape)).toEqual([-5, 0, 0, 5, 6, 8]);
  const circle = own(assembleWire([own(makeCircle(3))]));
  const closed = make({ type: 'blind', distance: 8 }, { wires: [circle] });
  expect(measureArea(closed.shape)).toBeCloseTo(2 * Math.PI * 3 * 8, 5);
  expect(closed.shape.faces.map(own)).toHaveLength(1);
});

it.each(['up-to-next', 'up-to-part', 'up-to-face', 'up-to-vertex'] as const)('terminates %s with signed offset and preserves borrowed native inputs', type => {
  const limit = box(), face = bottom(limit), wire = line();
  const before = [limit.serialize(), wire.serialize()];
  for (const offset of [-2, 0, 2]) {
    const result = make({ type, distance: 1, offset, part: limit, face, point: [0, 0, 10] }, { wires: [wire], limits: [limit], startingOffset: 1 });
    expect(measureArea(result.shape)).toBeCloseTo(10 * (9 - offset), 5);
    expect(bounds(result.shape)).toEqual([-5, 0, 1, 5, 0, 10 - offset]);
    expect(result.contacts).toHaveLength(1);
    expect(result.contacts[0].point[2]).toBeCloseTo(10 - offset, 5);
    expect([limit.serialize(), wire.serialize()]).toEqual(before);
  }
});

it.each(['up-to-next', 'up-to-part', 'up-to-face'] as const)('follows a tilted %s with exact area', type => {
  const limit = own(makeBaseBox(40, 40, 5).rotate(30, [0, 0, 0], [0, 1, 0]).translate(0, 0, 10));
  const faces = limit.faces.map(own);
  const face = faces.find(face => { const n = face.normalAt(); try { return n.z < -0.8; } finally { n.delete(); } })!;
  const result = make({ type, distance: 1, part: limit, face }, { limits: [limit] });
  // z=10-x*tan(30): the integral over symmetric x=-5..5 is exactly 100.
  expect(measureArea(result.shape)).toBeCloseTo(100, 5);
  expect(bounds(result.shape)[5]).toBeCloseTo(10 + 5 * Math.tan(Math.PI / 6), 5);
});

it.each(['up-to-next', 'up-to-part', 'up-to-face'] as const)('follows the near spherical %s and discards the far disconnected sheet', type => {
  const limit = own(makeSphere(10).translate(0, 0, 20)), face = limit.faces.map(own)[0];
  const result = make({ type, distance: 1, part: limit, face }, { limits: [limit] });
  // Integral of 20-sqrt(100-x²), -5..5.
  expect(measureArea(result.shape)).toBeCloseTo(200 - (5 * Math.sqrt(75) + 100 * Math.asin(0.5)), 4);
  expect(bounds(result.shape)[5]).toBeCloseTo(20 - Math.sqrt(75), 4);
});

it('uses finite surface limits for Next/Part, but the underlying infinite plane for Face', () => {
  const short = own(makeBaseBox(4, 4, 5).translate(0, 0, 10));
  expect(() => make({ type: 'up-to-next', distance: 1 }, { limits: [short] })).toThrow(/completely terminate/);
  expect(() => make({ type: 'up-to-part', distance: 1, part: short })).toThrow(/completely terminate/);
  expect(measureArea(make({ type: 'up-to-face', distance: 1, face: bottom(short) }).shape)).toBeCloseTo(100, 5);
});

it('finds the first boundary from inside a part and handles opposite and Through all ends', () => {
  const limit = box(-2);
  const exit = make({ type: 'up-to-next', distance: 1 }, { limits: [limit] });
  expect(bounds(exit.shape)[5]).toBe(3);
  const below = box(-15);
  const reverse = make({ type: 'up-to-part', distance: 1, part: below }, { direction: [0, 0, -1] });
  expect(bounds(reverse.shape)).toEqual([-5, 0, -10, 5, 0, 0]);
  const through = make({ type: 'through-all', distance: 1 }, { limits: [box(), below], second: { type: 'through-all', distance: 1 } });
  expect(bounds(through.shape)).toEqual([-5, 0, -16, 5, 0, 16]);
});

it('rejects a stopping plane crossing the start and curves tangent to travel', () => {
  const crossing = own(makeBaseBox(40, 40, 5).rotate(30, [0, 0, 0], [0, 1, 0]));
  const face = crossing.faces.map(own).find(face => { const n = face.normalAt(); try { return n.z < -0.8; } finally { n.delete(); } })!;
  expect(() => make({ type: 'up-to-face', distance: 1, face })).toThrow(/complete extrusion start|crosses/);
  expect(() => make({ type: 'blind', distance: 1 }, { direction: [1, 0, 0] })).toThrow(/leaves the sketch plane/);
});
