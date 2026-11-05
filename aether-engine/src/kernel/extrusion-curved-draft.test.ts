import { beforeAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import init from 'replicad-opencascadejs';
import { setOC, drawCircle, drawEllipse, drawRoundedRectangle, measureVolume, measureDistanceBetween, makeVertex, type Sketch, type Shape3D } from 'replicad';
import { curvedDraftPrism } from './extrusion-curved-draft';
import { dot, unit, type V3 } from './vector';

beforeAll(async () => setOC(await (init as any)({ wasmBinary: readFileSync(new URL('../../node_modules/replicad-opencascadejs/src/replicad_single.wasm', import.meta.url)) })), 30000);

function walls(body: Shape3D, direction: V3, angle: number) {
  const faces = body.faces;
  try {
    for (const face of faces.filter(face => face.geomType !== 'PLANE')) {
      for (let i = 1; i < 20; i++) {
        const p = face.pointOnSurface(i / 20, .5);
        const n = face.normalAt(p);
        try { expect(Math.abs(dot(unit(n.toTuple()), direction))).toBeCloseTo(Math.abs(Math.sin(angle * Math.PI / 180)), 6); }
        finally { p.delete(); n.delete(); }
      }
    }
  } finally { faces.forEach(face => face.delete()); }
}

it.each([3, -3])('builds a curved angled %s degree native wall, keeping the neutral circle and planar ends', angle => {
  const sketch = drawCircle(10).sketchOnPlane('XY') as Sketch, face = sketch.face(), wire = face.clone().outerWire();
  const shape = curvedDraftPrism([{ outer: wire, holes: [] }], [.6, 0, .8], [0, 0, 1], 0, 10, angle);
  try {
    walls(shape, [.6, 0, .8], angle);
    for (let i = 0; i < 31; i++) {
      const t = i * 2 * Math.PI / 31, vertex = makeVertex([10 * Math.cos(t), 10 * Math.sin(t), 0]);
      try { expect(measureDistanceBetween(vertex, shape)).toBeLessThan(1e-6); } finally { vertex.delete(); }
    }
    expect(shape.boundingBox.bounds[0][2]).toBeCloseTo(0, 5);
    expect(shape.boundingBox.bounds[1][2]).toBeCloseTo(8, 5);
    expect(measureVolume(shape)).toBeGreaterThan(2000);
    expect(measureVolume(shape)).toBeLessThan(3100);
  } finally { shape.delete(); wire.delete(); face.delete(); sketch.delete(); }
});

it.each(['ellipse', 'rounded'])('retains the wall angle on a smooth %s boundary with a shifted start', kind => {
  const sketch = (kind === 'ellipse' ? drawEllipse(10, 5) : drawRoundedRectangle(20, 10, 2)).sketchOnPlane('XY') as Sketch, face=sketch.face(), wire = face.clone().outerWire();
  const shape = curvedDraftPrism([{ outer: wire, holes: [] }], [.6, 0, .8], [0, 0, 1], 2, 12, 3);
  try { walls(shape, [.6, 0, .8], 3); expect(shape.boundingBox.bounds[0][2]).toBeCloseTo(1.6, 5); expect(shape.boundingBox.bounds[1][2]).toBeCloseTo(9.6, 5); }
  finally { shape.delete(); wire.delete(); face.delete(); sketch.delete(); }
});

it('refuses a collapsed curved wall instead of wrapping its radius through zero', () => {
  const sketch = drawCircle(10).sketchOnPlane('XY') as Sketch, face=sketch.face(), wire = face.clone().outerWire();
  try { expect(() => curvedDraftPrism([{ outer: wire, holes: [] }], [.6, 0, .8], [0, 0, 1], 0, 100, 40)).toThrow(/collaps|tolerance|angle/); }
  finally { wire.delete(); face.delete(); sketch.delete(); }
});

it('builds native inner and outer curved walls with oppositely drafted material sides', () => {
  const a = drawCircle(12).sketchOnPlane('XY') as Sketch, b = drawCircle(9).sketchOnPlane('XY') as Sketch;
  const outer = a.face().outerWire(), inner = b.face().outerWire();
  const body = curvedDraftPrism([{ outer, holes: [inner] }], [.6, 0, .8], [0, 0, 1], 0, 10, 3);
  try { walls(body, [.6, 0, .8], 3); expect(measureVolume(body)).toBeGreaterThan(500); }
  finally { body.delete(); outer.delete(); inner.delete(); a.delete(); b.delete(); }
});
