import { beforeAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import init from "replicad-opencascadejs";
import { measureVolume, setOC, type Shape3D } from "replicad";
import { evaluatePartDocument } from "./part-evaluator";
import { bendAllowanceMillimeters, bodyIDForFeature, createEmptyPartDocument, type PartDocument, type PartFeature } from "../document/index";

beforeAll(async () => {
  setOC(await (init as any)({ wasmBinary: readFileSync(new URL("../../node_modules/replicad-opencascadejs/src/replicad_single.wasm", import.meta.url)) }));
}, 30000);

const rule = { thicknessMillimeters: 2, bendRadiusMillimeters: 2, kFactor: 0.44 };
const volumes = (doc: PartDocument) => { const out: Record<string, number> = {}; evaluatePartDocument(doc, { withBodies: (b) => { for (const [id, body] of b) out[id] = measureVolume(body as Shape3D); } }); return out; };
const bounds = (doc: PartDocument, id: string) => { let b: number[] = []; evaluatePartDocument(doc, { withBodies: (bodies) => { const box = bodies.get(id)!.boundingBox.bounds; b = [...box[0], ...box[1]].map((v) => Math.round(v * 1000) / 1000 + 0); } }); return b; };

it("bends a flange from a plate's edge, lays it flat with the bend allowance, and refolds it", () => {
  // A 100 × 50 plate, 2 mm thick, from a sketch on XY (the plate fills z ∈ [0, 2]).
  const doc = createEmptyPartDocument("Sheet");
  doc.features.push({ id: "s", type: "profile", name: "s", plane: "XY", offsetMillimeters: 0, suppressed: false, profile: { type: "polygon", pointsMillimeters: [[0, 0], [100, 0], [100, 50], [0, 50]] } });
  const base: PartFeature = { id: "b", type: "sheet-base", name: "Base", suppressed: false, operation: "new", profileFeatureId: "s", ...rule };
  doc.features.push(base);
  const id = bodyIDForFeature(doc, base);
  expect(volumes(doc)[id]).toBeCloseTo(100 * 50 * 2, 3);
  // A 20 mm flange at 90° from the top face's edge at x = 100, folded down (away from the top face).
  const edge = { kind: "curved-edge" as const, sourceFeatureId: "b", bodyId: id, label: "x=100 top", midpointMillimeters: [100, 25, 2] as [number, number, number], lengthMillimeters: 50 };
  doc.features.push({ id: "f", type: "sheet-flange", name: "Flange", suppressed: false, bodyIds: [id], edges: [edge], distanceMillimeters: 20, angleDegrees: 90 });
  const bend = (Math.PI / 2) / 2 * ((rule.bendRadiusMillimeters + 2) ** 2 - rule.bendRadiusMillimeters ** 2) * 50; // quarter annulus × edge length
  const leg = 20 * 2 * 50;
  expect(volumes(doc)[id]).toBeCloseTo(10000 + bend + leg, 2);
  // Folded down: the leg reaches below the plate; the plate itself is untouched.
  const folded = bounds(doc, id);
  // Bounding boxes of curved faces are padded slightly, so two decimals.
  expect(folded[0]).toBeCloseTo(0, 1); expect(folded[5]).toBeCloseTo(2, 1); expect(folded[2]).toBeCloseTo(2 - (2 + rule.bendRadiusMillimeters + 20), 2); // top face at z = 2, then thickness, radius and leg down
  expect(folded[3]).toBeCloseTo(100 + rule.bendRadiusMillimeters + 2, 2);
  // Unfold: the plate plus a flat strip of leg + bend allowance.
  doc.features.push({ id: "u", type: "sheet-unfold", name: "Unfold", suppressed: false, bodyIds: [id] });
  const allowance = bendAllowanceMillimeters(90, rule.bendRadiusMillimeters, rule);
  expect(allowance).toBeCloseTo((Math.PI / 2) * (2 + 0.44 * 2), 6);
  expect(volumes(doc)[id]).toBeCloseTo(10000 + (20 + allowance) * 2 * 50, 2);
  const flat = bounds(doc, id);
  expect(flat[3]).toBeCloseTo(120 + allowance, 3); expect(flat[2]).toBeCloseTo(0, 3); expect(flat[5]).toBeCloseTo(2, 3);
  // Refold brings the bent body back.
  doc.features.push({ id: "r", type: "sheet-refold", name: "Refold", suppressed: false, bodyIds: [id] });
  expect(volumes(doc)[id]).toBeCloseTo(10000 + bend + leg, 2);
});

it("hems an edge back under the plate and folds inward when asked", () => {
  const doc = createEmptyPartDocument("Hem");
  doc.features.push({ id: "s", type: "profile", name: "s", plane: "XY", offsetMillimeters: 0, suppressed: false, profile: { type: "polygon", pointsMillimeters: [[0, 0], [100, 0], [100, 50], [0, 50]] } });
  const base: PartFeature = { id: "b", type: "sheet-base", name: "Base", suppressed: false, operation: "new", profileFeatureId: "s", ...rule };
  doc.features.push(base);
  const id = bodyIDForFeature(doc, base);
  const edge = { kind: "curved-edge" as const, sourceFeatureId: "b", bodyId: id, label: "x=100 top", midpointMillimeters: [100, 25, 2] as [number, number, number], lengthMillimeters: 50 };
  doc.features.push({ id: "h", type: "sheet-hem", name: "Hem", suppressed: false, bodyIds: [id], edges: [edge], lengthMillimeters: 10, gapMillimeters: 1 });
  const half = Math.PI / 2 * ((1 + 2) ** 2 - 1) * 50; // half annulus × edge length
  expect(volumes(doc)[id]).toBeCloseTo(10000 + half + 10 * 2 * 50, 2);
  // From the top face at z = 2: thickness 2 and two inner radii down to the hem's outer face, then its thickness.
  const b = bounds(doc, id);
  expect(b[5]).toBeCloseTo(2, 1); expect(b[3]).toBeCloseTo(100 + 1 + 2, 1); expect(b[2]).toBeCloseTo(2 - (2 + 2 * 1 + 2), 1);
  // Inward: the hem rises above the top face instead, and nothing hangs below the plate.
  doc.features[2] = { ...(doc.features[2] as PartFeature & { inward?: boolean }), inward: true } as PartFeature;
  const up = bounds(doc, id);
  expect(up[2]).toBeCloseTo(0, 1); expect(up[5]).toBeCloseTo(2 + 2 * 1 + 2, 1);
});

it("folds a plate along a sketch line, keeping the flat pattern the plate itself", () => {
  // The plate's sketch carries a second contour: a fold line across it at x = 60 (a drawing with a square and a line).
  const doc = createEmptyPartDocument("Fold");
  doc.features.push({ id: "s", type: "profile", name: "s", plane: "XY", offsetMillimeters: 0, suppressed: false, profile: { type: "drawing", contours: [
    { id: "outline", type: "path", start: [0, 0], segments: [{ id: "e1", type: "line", end: [100, 0] }, { id: "e2", type: "line", end: [100, 50] }, { id: "e3", type: "line", end: [0, 50] }, { id: "e4", type: "line", end: [0, 0] }] },
    { id: "fold", type: "path", start: [60, -5], segments: [{ id: "f1", type: "line", end: [60, 55] }], construction: true },
  ] } });
  const base: PartFeature = { id: "b", type: "sheet-base", name: "Base", suppressed: false, operation: "new", profileFeatureId: "s", profileContourId: "outline", ...rule };
  doc.features.push(base);
  const id = bodyIDForFeature(doc, base);
  doc.features.push({ id: "f", type: "sheet-fold", name: "Fold", suppressed: false, bodyIds: [id], line: { kind: "sketch-line", sourceFeatureId: "s", contourId: "fold", segmentId: "f1" }, angleDegrees: 90 });
  // Volume: fixed 60 × 50 × 2, the bend (quarter annulus × 50) and the moving side, 40 mm minus the allowance strip.
  const allowance = bendAllowanceMillimeters(90, rule.bendRadiusMillimeters, rule);
  const bend = (Math.PI / 4) * ((rule.bendRadiusMillimeters + 2) ** 2 - rule.bendRadiusMillimeters ** 2) * 50;
  expect(volumes(doc)[id]).toBeCloseTo(60 * 50 * 2 + bend + (40 - allowance) * 50 * 2, 1);
  // The line is on the base face (the plate's underside), so the fold goes away from it: up.
  // The moving side stands past x = 60 + r + t, reaching t + r above the plate plus its own length.
  const b = bounds(doc, id);
  expect(b[0]).toBeCloseTo(0, 1); expect(b[2]).toBeCloseTo(0, 1); expect(b[3]).toBeCloseTo(60 + rule.bendRadiusMillimeters + 2, 1);
  expect(b[5]).toBeCloseTo(2 + rule.bendRadiusMillimeters + (40 - allowance), 1);
  // Unfold gives the plate back: a fold does not change the flat pattern.
  doc.features.push({ id: "u", type: "sheet-unfold", name: "Unfold", suppressed: false, bodyIds: [id] });
  expect(volumes(doc)[id]).toBeCloseTo(100 * 50 * 2, 3);
});

