import { describe, expect, it } from "vitest";
import type { SketchContour, SketchDrawing, SketchPoint } from "../drawing";
import { sketchArrangement } from "./arrangement";

const rect = (x0: number, y0: number, x1: number, y1: number, id?: string): SketchContour => ({
  type: "path", ...(id ? { id } : {}), start: [x0, y0],
  segments: [{ type: "line", end: [x1, y0] }, { type: "line", end: [x1, y1] }, { type: "line", end: [x0, y1] }, { type: "line", end: [x0, y0] }],
});
const circle = (center: SketchPoint, radius: number, id?: string): SketchContour => ({ type: "circle", ...(id ? { id } : {}), center, radius });
const line = (a: SketchPoint, b: SketchPoint): SketchContour => ({ type: "path", start: a, segments: [{ type: "line", end: b }] });
const drawing = (...contours: SketchContour[]): SketchDrawing => ({ type: "drawing", contours });
const areas = (d: SketchDrawing) => sketchArrangement(d)!.map((f) => Math.round(f.area * 1e6) / 1e6).sort((a, b) => a - b);

describe("sketch arrangement (SolidCraft's find_profiles)", () => {
  it("keeps separate shapes as one region each", () => {
    const [disc, square] = areas(drawing(rect(0, 0, 10, 10), circle([30, 0], 5)));
    expect(disc).toBeCloseTo(Math.PI * 25, 1);
    expect(square).toBe(100);
  });
  it("splits a rectangle overlapping a circle into three regions", () => {
    // Rectangle 0..20 × -10..10, circle r 10 at (20, 0): the lens is half the disc.
    const faces = sketchArrangement(drawing(rect(0, -10, 20, 10, "r"), circle([20, 0], 10, "c")))!;
    expect(faces).toHaveLength(3);
    const half = Math.PI * 50;
    expect(faces.map((f) => f.area).sort((a, b) => a - b)).toEqual([expect.closeTo(half, 1), expect.closeTo(half, 1), expect.closeTo(400 - half, 1)]);
    const lens = faces.find((f) => f.insideContourIndices.length === 2)!;
    expect(lens.insideContourIndices).toEqual([0, 1]);
    expect(lens.sourceContourIndices).toEqual([0, 1]);
    // Boundaries stay exact: the lens is bounded by a line and an arc, not a polygon.
    expect(new Set(lens.boundary.segments.map((s) => s.type))).toEqual(new Set(["arc", "line"]));
  });
  it("gives a circle inside a rectangle as a ring and a disc", () => {
    const faces = sketchArrangement(drawing(rect(-20, -20, 20, 20), circle([0, 0], 5)))!;
    expect(faces).toHaveLength(2);
    const ring = faces.find((f) => f.holes.length === 1)!, disc = faces.find((f) => !f.holes.length)!;
    expect(ring.area).toBeCloseTo(1600 - Math.PI * 25, 0);
    expect(disc.area).toBeCloseTo(Math.PI * 25, 0);
    expect(ring.insideContourIndices).toEqual([0]);
    expect(disc.insideContourIndices).toEqual([0, 1]);
  });
  it("splits a rectangle with a line across it, and ignores a dangling line", () => {
    expect(areas(drawing(rect(0, 0, 10, 10), line([4, -5], [4, 15])))).toEqual([40, 60]);
    expect(areas(drawing(rect(0, 0, 10, 10), line([4, -5], [4, 5])))).toEqual([100]);
  });
  it("closes a region from open lines meeting end to end and at a T", () => {
    // Three lines making a triangle, one ending on another's middle.
    expect(areas(drawing(line([0, 0], [10, 0]), line([10, 0], [5, 10]), line([5, 10], [0, 0]), line([5, 0], [5, 10])))).toEqual([25, 25]);
  });
  it('handles a shared edge and coincident geometry without duplicate regions', () => {
    expect(areas(drawing(rect(0, 0, 10, 10), rect(10, 0, 20, 10)))).toEqual([100, 100]);
    expect(areas(drawing(rect(0, 0, 10, 10), rect(0, 0, 10, 10)))).toEqual([100]);
    expect(areas(drawing(circle([0, 0], 5), circle([0, 0], 5)))).toEqual([expect.closeTo(Math.PI * 25, 1)]);
  });
  it.each([0, 1000, 100000])('does not close a 0.001 mm gap after translation by %s mm', x => {
    const open: SketchContour = { type: 'path', start: [x, 0], segments: [
      { type: 'line', end: [x + 10, 0] }, { type: 'line', end: [x + 10, 10] },
      { type: 'line', end: [x, 10] }, { type: 'line', end: [x, 0.001] },
    ] };
    expect(areas(drawing(open))).toEqual([]);
  });
});

it.each([0.25, 0.5, 0.75])('splits rational conics exactly at several intersections (rho %s)', rho => {
  const cap: SketchContour = { type: 'path', start: [-10, 0], segments: [
    { type: 'conic', control: [0, 20], rho, end: [10, 0] }, { type: 'line', end: [-10, 0] },
  ] };
  const faces = sketchArrangement(drawing(cap, line([-20, 3], [20, 3])))!;
  expect(faces).toHaveLength(2);
  expect(faces.every(f => f.boundary.segments.some(s => s.type === 'conic'))).toBe(true);
  for (const face of faces) face.boundary.segments.at(-1)!.end.forEach((v, i) => expect(v).toBeCloseTo(face.boundary.start[i], 7));
  const total = faces.reduce((a, f) => a + f.area, 0);
  expect(total).toBeCloseTo(sketchArrangement(drawing(cap))![0].area, 1);
});

it('keeps tangent circles separate and splits a crossing open polyline into its bounded faces', () => {
  expect(areas(drawing(circle([0,0],5),circle([10,0],5)))).toEqual([expect.closeTo(Math.PI*25,1),expect.closeTo(Math.PI*25,1)]);
  expect(areas(drawing({type:'path',start:[0,0],segments:[{type:'line',end:[10,10]},{type:'line',end:[0,10]},{type:'line',end:[10,0]},{type:'line',end:[0,0]}]}))).toEqual([25,25]);
});
