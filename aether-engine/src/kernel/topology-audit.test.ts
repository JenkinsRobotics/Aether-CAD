import { beforeAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import init from 'replicad-opencascadejs';
import { setOC, makeBox, makeCylinder, makeSphere, makeEllipsoid, drawCircle, drawEllipse, draw, type AnyShape } from 'replicad';
import { extractExactTopology, facesOf, topologyOf } from './exact-topology';

beforeAll(async () => setOC(await (init as any)({ wasmBinary: readFileSync(new URL('../../node_modules/replicad-opencascadejs/src/replicad_single.wasm', import.meta.url)) })), 30000);
const points = (shape: AnyShape) => extractExactTopology(shape).flatMap(f => f.candidates.filter(c => c.kind === 'vertex').map(c => c.origin));
it('never reuses different boundaries just because faces have equal centers and areas', () => {
  const a = makeBox([-10, -5, 0], [10, 5, 2]), b = makeBox([-5, -10, 0], [5, 10, 2]);
  try {
    points(a);
    const actual = points(b);
    expect(Math.max(...actual.map(p => Math.abs(p[0])))).toBeCloseTo(5, 8);
    expect(Math.max(...actual.map(p => Math.abs(p[1])))).toBeCloseTo(10, 8);
  } finally { a.delete(); b.delete(); }
});
it('keeps exact locations after sub-micron moves instead of using rounded cache keys', () => {
  const a = makeBox([-3, -7, 0], [3, 7, 2]);
  const b = a.clone().translate(0.0002, 0, 0);
  try {
    points(a);
    expect(Math.max(...points(b).map(p => p[0]))).toBeCloseTo(3.0002, 9);
  } finally { a.delete(); b.delete(); }
});
it('remaps every cached candidate to the current face identity', () => {
  const box = makeBox([-2, -9, 0], [2, 9, 5]);
  try {
    extractExactTopology(box);
    const faces = facesOf(box).map((f, i) => ({ ...f, id: i + 123 }));
    for (const face of topologyOf(faces)) {
      expect(face.candidates.every(c => c.faceId === face.id)).toBe(true);
      expect(face.candidates.every(c => c.id.startsWith(`face-${face.id}-`))).toBe(true);
    }
  } finally { box.delete(); }
});
const fixtures = {
  plane: () => makeBox([0, 0, 0], [13, 17, 23]),
  cylinder: () => makeCylinder(11, 23),
  sphere: () => makeSphere(11),
  ellipse: () => drawEllipse(17, 11).sketchOnPlane('XY').extrude(23),
  torus: () => drawCircle(3).translate(20, 0).sketchOnPlane('XZ').revolve([0, 0, 1]),
  bspline: () => makeEllipsoid(17, 11, 23),
  bezier: () => draw([0, 0]).cubicBezierCurveTo([15, 0], [4, 13], [11, -7]).lineTo([15, -9]).lineTo([0, -9]).close().sketchOnPlane('XY').extrude(23),
};
for (const [name, make] of Object.entries(fixtures)) it(`retains exact selectable boundaries for ${name}`, () => {
  const shape = make();
  try {
    const native = facesOf(shape);
    const expected = native.map(({ face }) => {
      const edges = face.edges;
      try { return edges.filter(e => e.length > 1e-7).length; }
      finally { edges.forEach(e => e.delete()); }
    });
    const topology = topologyOf(native);
    topology.forEach((face, i) => {
      expect(face.surfaceType).not.toBe('UNAVAILABLE');
      expect(face.measurements!.areaSquareMillimeters).toBeGreaterThan(0);
      expect(face.candidates.filter(c => c.kind === 'edge-midpoint' && (c.measurements?.lengthMillimeters ?? 0) > 1e-7)).toHaveLength(expected[i]);
      expect(face.candidates.every(c => [...c.origin, ...c.xAxis, ...c.yAxis, ...c.zAxis, ...(c.polylineMillimeters ?? [])].every(Number.isFinite))).toBe(true);
    });
    if (name === 'sphere') expect(topology.flatMap(f => f.candidates).some(c => c.kind === 'sphere-center')).toBe(true);
    if (name === 'torus') expect(topology.flatMap(f => f.candidates).some(c => c.kind === 'torus-center')).toBe(true);
  } finally { shape.delete(); }
});

it('recovers the exact center and axis of a rotated and translated torus', () => {
  const torus = drawCircle(3).translate(20,0).sketchOnPlane('XZ').revolve([0,0,1]).rotate(37,[0,0,0],[1,0,0]).translate(13,-17,23);
  try {
    const center = extractExactTopology(torus).flatMap(f => f.candidates).find(c => c.kind === 'torus-center')!;
    expect(center).toBeTruthy();
    center.origin.forEach((v,i) => expect(v).toBeCloseTo([13,-17,23][i],8));
    const axis = [0,-Math.sin(37*Math.PI/180),Math.cos(37*Math.PI/180)];
    expect(Math.abs(center.zAxis.reduce((sum,v,i)=>sum+v*axis[i],0))).toBeCloseTo(1,9);
  } finally { torus.delete(); }
});
