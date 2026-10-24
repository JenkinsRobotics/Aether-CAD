import { beforeAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import init from "replicad-opencascadejs";
import { setOC } from "replicad";
import { analyzePart } from "./analysis";
import { evaluatePartDocument } from "./part-evaluator";
import { createEmptyPartDocument, createRectanglePartDocument } from "../document/part-document";

beforeAll(async () => {
  setOC(await (init as any)({ wasmBinary: readFileSync(require.resolve("replicad-opencascadejs/src/replicad_single.wasm")) }));
}, 60000);
type V3 = [number, number, number];
const length = (p: V3[]) => p.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - p[i][0], q[1] - p[i][1], q[2] - p[i][2]), 0);

/** A box and a cylinder through it: two bodies whose surfaces cross. */
function boxAndPost() {
  const doc = createRectanglePartDocument("Box", { widthMillimeters: 40, heightMillimeters: 40, depthMillimeters: 10 });
  doc.features.push({ id: "c", type: "profile", name: "Post", plane: "XY", offsetMillimeters: -5, suppressed: false, profile: { type: "circle", radiusMillimeters: 5, centerMillimeters: [0, 0] } } as never);
  doc.features.push({ id: "pe", type: "extrude", name: "Post", profileFeatureId: "c", distanceMillimeters: 20, operation: "new", suppressed: false } as never);
  return doc;
}
const faceWith = (doc: ReturnType<typeof boxAndPost>, test: (f: { surfaceType?: string; measurements?: { planarNormal?: number[] }; centerMillimeters?: number[] }) => boolean, body: number) => {
  const parts = evaluatePartDocument(doc).parts;
  const face = parts[body].topology.find((f) => test(f as never))!;
  return { body_id: parts[body].id, face_id: (face as unknown as { id: number }).id };
};

it("intersects two bodies' faces into a closed circle", () => {
  const doc = boxAndPost();
  const top = faceWith(doc, (f) => f.measurements?.planarNormal?.[2] === 1, 0);
  const side = faceWith(doc, (f) => f.surfaceType === "CYLINDER", 1);
  const result = analyzePart(doc, { kind: "intersection_curve", entities: [top, side] });
  expect(result.curves).toHaveLength(1);
  const circle = result.curves![0].polylines[0] as V3[];
  expect(circle.every((p) => Math.abs(p[2] - 10) < 1e-6 && Math.abs(Math.hypot(p[0], p[1]) - 5) < 1e-3)).toBe(true);
  expect(length(circle)).toBeCloseTo(2 * Math.PI * 5, 0);
  expect(() => analyzePart(doc, { kind: "intersection_curve", entities: [top] })).toThrow(/two faces/);
}, 60000);

it("draws a face's u or v line through a point", () => {
  const doc = boxAndPost();
  const side = faceWith(doc, (f) => f.surfaceType === "CYLINDER", 1);
  const along = analyzePart(doc, { kind: "isoparametric_curve", entities: [side], uv: "v", point_mm: [5, 0, 0] }).curves![0].polylines[0] as V3[];
  // Along v on a cylinder: a straight generator at x = 5, y = 0, the post's full height.
  expect(along.every((p) => Math.abs(p[0] - 5) < 1e-6 && Math.abs(p[1]) < 1e-6)).toBe(true);
  expect(length(along)).toBeCloseTo(20, 3);
  const around = analyzePart(doc, { kind: "isoparametric_curve", entities: [side], uv: "u", point_mm: [5, 0, 2] }).curves![0].polylines[0] as V3[];
  expect(around.every((p) => Math.abs(p[2] - 2) < 1e-6)).toBe(true);
}, 60000);

it("projects sketch curves onto a face along a direction", () => {
  const doc = createEmptyPartDocument("Dome");
  doc.features.push({ id: "s", type: "profile", name: "Base", plane: "XZ", offsetMillimeters: 0, suppressed: false, profile: { type: "circle", radiusMillimeters: 20, centerMillimeters: [0, 0] } } as never);
  doc.features.push({ id: "r", type: "extrude", name: "Drum", profileFeatureId: "s", distanceMillimeters: 30, operation: "new", suppressed: false } as never);
  const drum = faceWith(doc as never, (f) => f.surfaceType === "CYLINDER", 0);
  // A straight line across the drum at z = 5 (above it in +Z), projected down onto the curved side.
  const result = analyzePart(doc, { kind: "project_curve", entities: [drum], polylines: [[[-10, -15, 30], [10, -15, 30]]], direction: [0, 0, -1] });
  const curve = result.curves![0].polylines.flat() as V3[];
  expect(curve.length).toBeGreaterThan(2);
  expect(curve.every((p) => Math.abs(Math.hypot(p[0], p[2]) - 20) < 1e-3)).toBe(true);
  expect(() => analyzePart(doc, { kind: "project_curve", entities: [drum], polylines: [[[100, 0, 100], [110, 0, 100]]], direction: [0, 0, -1] })).toThrow(/does not project/);
}, 60000);
