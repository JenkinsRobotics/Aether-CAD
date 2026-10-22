import { beforeAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import init from "replicad-opencascadejs";
import { measureArea, measureVolume, setOC, type Shape3D } from "replicad";
import { evaluatePartDocument } from "./part-evaluator";
import { bodyIDForFeature, createEmptyPartDocument, type PartDocument, type PartFeature } from "../document/index";

beforeAll(async () => {
  setOC(await (init as any)({ wasmBinary: readFileSync(new URL("../../node_modules/replicad-opencascadejs/src/replicad_single.wasm", import.meta.url)) }));
}, 30000);

const square = (id: string, offset = 0): PartFeature => ({ id, type: "profile", name: id, plane: "XY", offsetMillimeters: offset, suppressed: false, profile: { type: "polygon", pointsMillimeters: [[0, 0], [10, 0], [10, 10], [0, 10]] } });
/** An open L: (0,0)→(10,0)→(10,5), as a drawing with one open contour. */
const openL = (id: string): PartFeature => ({ id, type: "profile", name: id, plane: "XY", offsetMillimeters: 0, suppressed: false, profile: { type: "drawing", contours: [{ id: "L", type: "path", start: [0, 0], segments: [{ type: "line", end: [10, 0] }, { type: "line", end: [10, 5] }] }] } });
const measure = (doc: PartDocument) => {
  const out: Record<string, { area: number; volume: number; bounds: number[] }> = {};
  evaluatePartDocument(doc, { withBodies: (bodies) => { for (const [id, body] of bodies) { const b = body.boundingBox.bounds; out[id] = { area: measureArea(body as Shape3D), volume: measureVolume(body as Shape3D), bounds: [...b[0], ...b[1]].map((v) => Math.round(v * 1000) / 1000 + 0) }; } } });
  return out;
};
const withFeatures = (...features: PartFeature[]): PartDocument => { const doc = createEmptyPartDocument("Surfaces"); doc.features.push(...features); return doc; };

it("extrudes open and closed sketch curves into sheets, symmetric or reversed", () => {
  const doc = withFeatures(openL("s"), { id: "e", type: "surface-extrude", name: "Sheet", suppressed: false, operation: "new", profileFeatureId: "s", distanceMillimeters: 4 });
  const sheet = measure(doc)[bodyIDForFeature(doc, doc.features[1])];
  expect(sheet.area).toBeCloseTo(60, 6); expect(sheet.bounds).toEqual([0, 0, 0, 10, 5, 4]);
  const symmetric = withFeatures(openL("s"), { id: "e", type: "surface-extrude", name: "Sheet", suppressed: false, operation: "new", profileFeatureId: "s", distanceMillimeters: 4, symmetric: true });
  expect(measure(symmetric)[bodyIDForFeature(symmetric, symmetric.features[1])].bounds).toEqual([0, 0, -2, 10, 5, 2]);
  const reversed = withFeatures(openL("s"), { id: "e", type: "surface-extrude", name: "Sheet", suppressed: false, operation: "new", profileFeatureId: "s", distanceMillimeters: 4, reversed: true });
  expect(measure(reversed)[bodyIDForFeature(reversed, reversed.features[1])].bounds).toEqual([0, 0, -4, 10, 5, 0]);
  // A closed square gives four side faces and no caps.
  const walls = withFeatures(square("q"), { id: "e", type: "surface-extrude", name: "Walls", suppressed: false, operation: "new", profileFeatureId: "q", distanceMillimeters: 10 });
  expect(measure(walls)[bodyIDForFeature(walls, walls.features[1])].area).toBeCloseTo(400, 6);
  const parts = evaluatePartDocument(walls).parts;
  expect(parts).toHaveLength(1); expect(parts[0].triangles.length).toBeGreaterThan(0);
});

it("revolves curves into sheets about an axis", () => {
  const doc = withFeatures(openL("s"), { id: "r", type: "surface-revolve", name: "Rev", suppressed: false, operation: "new", profileFeatureId: "s", angleDegrees: 90, axis: "Y" });
  // The 10 mm line along x sweeps a quarter disc (π·100/4 = 78.54); the 5 mm riser at x=10 sweeps a quarter cylinder (2π·10·5/4 = 78.54).
  expect(measure(doc)[bodyIDForFeature(doc, doc.features[1])].area).toBeCloseTo(157.08, 1);
});

it("patches closed curves, offsets, thickens, and sews sheets into a solid when they close", () => {
  const bottom: PartFeature = { id: "p", type: "surface-patch", name: "Bottom", suppressed: false, operation: "new", profileFeatureId: "q" };
  // Every document gets its own identity, so body ids are computed on the document they live in.
  const doc = withFeatures(square("q"), bottom);
  const patch = measure(doc)[bodyIDForFeature(doc, bottom)];
  expect(patch.area).toBeCloseTo(100, 6); expect(patch.bounds).toEqual([0, 0, 0, 10, 10, 0]);
  const offsetDoc = withFeatures(square("q"), bottom);
  const offsetFeature: PartFeature = { id: "o", type: "surface-offset", name: "Offset", suppressed: false, operation: "new", bodyIds: [bodyIDForFeature(offsetDoc, bottom)], distanceMillimeters: 3 };
  offsetDoc.features.push(offsetFeature);
  expect(measure(offsetDoc)[bodyIDForFeature(offsetDoc, offsetFeature)].bounds).toEqual([0, 0, 3, 10, 10, 3]);
  const thickDoc = withFeatures(square("q"), bottom);
  const thicken: PartFeature = { id: "t", type: "surface-thicken", name: "Thick", suppressed: false, operation: "new", bodyIds: [bodyIDForFeature(thickDoc, bottom)], thicknessMillimeters: 2 };
  thickDoc.features.push(thicken);
  expect(measure(thickDoc)[bodyIDForFeature(thickDoc, thicken)].volume).toBeCloseTo(200, 3);
  // Walls from the square, a bottom and a top patch, sewn: a closed box, so a solid.
  const walls: PartFeature = { id: "w", type: "surface-extrude", name: "Walls", suppressed: false, operation: "new", profileFeatureId: "q", distanceMillimeters: 10 };
  const top: PartFeature = { id: "tp", type: "surface-patch", name: "Top", suppressed: false, operation: "new", profileFeatureId: "q2" };
  const boxDoc = withFeatures(square("q"), square("q2", 10), walls, bottom, top);
  const ids = [walls, bottom, top].map((f) => bodyIDForFeature(boxDoc, f));
  boxDoc.features.push({ id: "st", type: "surface-stitch", name: "Box", suppressed: false, bodyIds: ids });
  const sewn = measure(boxDoc);
  expect(Object.keys(sewn)).toEqual([ids[0]]);
  expect(sewn[ids[0]].volume).toBeCloseTo(1000, 3);
  // Unstitch the walls into four sheets; reverse one of them without changing its area.
  const apartDoc = withFeatures(square("q"), walls);
  const unstitch: PartFeature = { id: "u", type: "surface-unstitch", name: "Apart", suppressed: false, operation: "new", bodyIds: [bodyIDForFeature(apartDoc, walls)] };
  apartDoc.features.push(unstitch);
  const apart = evaluatePartDocument(apartDoc);
  expect(apart.bodyOutputs?.u).toHaveLength(4);
  const faceId = apart.bodyOutputs!.u[0];
  apartDoc.features[2] = { ...unstitch, bodyOutputs: apart.bodyOutputs!.u };
  apartDoc.features.push({ id: "rv", type: "surface-reverse-normal", name: "Flip", suppressed: false, bodyIds: [faceId] });
  expect(measure(apartDoc)[faceId].area).toBeCloseTo(100, 6);
});

it("lofts between sketch curves and sweeps a curve along a path", () => {
  const loft: PartFeature = { id: "l", type: "surface-loft", name: "Loft", suppressed: false, operation: "new", sections: [{ profileFeatureId: "q" }, { profileFeatureId: "q2" }] };
  const loftDoc = withFeatures(square("q"), square("q2", 8), loft);
  expect(measure(loftDoc)[bodyIDForFeature(loftDoc, loft)].area).toBeCloseTo(320, 3);
  const path: PartFeature = { id: "path", type: "profile", name: "path", plane: "XZ", offsetMillimeters: 0, suppressed: false, profile: { type: "drawing", contours: [{ id: "p", type: "path", start: [0, 0], segments: [{ type: "line", end: [0, 12] }] }] } };
  const sweep: PartFeature = { id: "sw", type: "surface-sweep", name: "Sweep", suppressed: false, operation: "new", profileFeatureId: "s", pathFeatureId: "path" };
  const sweepDoc = withFeatures(openL("s"), path, sweep);
  expect(measure(sweepDoc)[bodyIDForFeature(sweepDoc, sweep)].area).toBeCloseTo(180, 1);
});

it("rules strips from a sheet's edges and extends a sheet past an edge", () => {
  const bottom: PartFeature = { id: "p", type: "surface-patch", name: "Bottom", suppressed: false, operation: "new", profileFeatureId: "q" };
  const edge = (bodyId: string) => ({ kind: "curved-edge" as const, sourceFeatureId: "p", bodyId, label: "Edge y=0", midpointMillimeters: [5, 0, 0] as [number, number, number], lengthMillimeters: 10 });
  const ruled = (mode: "normal" | "tangent" | "direction", direction?: [number, number, number]) => {
    const doc = withFeatures(square("q"), bottom);
    const id = bodyIDForFeature(doc, bottom);
    const feature: PartFeature = { id: "r", type: "surface-ruled", name: "Ruled", suppressed: false, operation: "new", bodyIds: [id], edges: [edge(id)], distanceMillimeters: 5, mode, ...(direction ? { direction } : {}) };
    doc.features.push(feature);
    return measure(doc)[bodyIDForFeature(doc, feature)];
  };
  const along = ruled("direction", [0, -1, 0]);
  expect(along.area).toBeCloseTo(50, 6); expect(along.bounds).toEqual([0, -5, 0, 10, 0, 0]);
  const tangent = ruled("tangent");
  expect(tangent.area).toBeCloseTo(50, 6); expect(tangent.bounds).toEqual([0, -5, 0, 10, 0, 0]);
  const normal = ruled("normal");
  expect(normal.area).toBeCloseTo(50, 6); expect(Math.abs(normal.bounds[5] - normal.bounds[2])).toBeCloseTo(5, 6); expect(normal.bounds[1]).toBe(0); expect(normal.bounds[4]).toBe(0);
  const doc = withFeatures(square("q"), bottom);
  const id = bodyIDForFeature(doc, bottom);
  doc.features.push({ id: "x", type: "surface-extend", name: "Extend", suppressed: false, bodyIds: [id], edges: [edge(id)], distanceMillimeters: 5 });
  const extended = measure(doc)[id];
  expect(extended.area).toBeCloseTo(150, 6); expect(extended.bounds).toEqual([0, -5, 0, 10, 10, 0]);
});

