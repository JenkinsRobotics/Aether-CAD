import { beforeAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import init from "replicad-opencascadejs";
import { measureVolume, setOC, type Shape3D } from "replicad";
import { evaluatePartDocument } from "./part-evaluator";
import { bendAllowanceMillimeters, bendTableCSV, bodyIDForFeature, createEmptyPartDocument, sheetBendTable, type PartDocument, type PartFeature, type SheetBaseFeature } from "../document/index";

beforeAll(async () => {
  setOC(await (init as any)({ wasmBinary: readFileSync(new URL("../../node_modules/replicad-opencascadejs/src/replicad_single.wasm", import.meta.url)) }));
}, 30000);
const rule = { thicknessMillimeters: 2, bendRadiusMillimeters: 2, kFactor: 0.44 };
const volume = (doc: PartDocument, id: string) => { let v = 0; evaluatePartDocument(doc, { withBodies: (b) => { v = measureVolume(b.get(id) as Shape3D); } }); return v; };
const plate = () => {
  const doc = createEmptyPartDocument("Sheet");
  doc.features.push({ id: "s", type: "profile", name: "s", plane: "XY", offsetMillimeters: 0, suppressed: false, profile: { type: "polygon", pointsMillimeters: [[0, 0], [100, 0], [100, 50], [0, 50]] } });
  const base = { id: "b", type: "sheet-base", name: "Base", suppressed: false, operation: "new", profileFeatureId: "s", ...rule } as PartFeature;
  doc.features.push(base);
  return { doc, base: base as SheetBaseFeature, id: bodyIDForFeature(doc, base) };
};
const top = (id: string) => ({ sourceFeatureId: "b", bodyId: id, label: "Top", normal: [0, 0, 1] as [number, number, number] });

it("perforates a plate on a square grid clear of its edges, and keeps the holes when unfolded", () => {
  const { doc, id } = plate();
  // 4 mm holes, 10 mm pitch, 4 mm margin: centres need 6 mm from every edge → x 6..94, y 6..44.
  doc.features.push({ id: "p", type: "sheet-perforate", name: "Perforate", suppressed: false, bodyIds: [id], face: top(id), diameterMillimeters: 4, pitchMillimeters: 10, pattern: "square" } as PartFeature);
  const hole = Math.PI * 4 * 2;
  const holes = (10000 - volume(doc, id)) / hole;
  expect(holes).toBeCloseTo(Math.round(holes), 6);
  // 9 columns × 4 rows fit in 88 × 38 at a 10 mm pitch, centred.
  expect(Math.round(holes)).toBe(36);
  doc.features.push({ id: "f", type: "sheet-flange", name: "Flange", suppressed: false, bodyIds: [id], edges: [{ kind: "curved-edge", sourceFeatureId: "b", bodyId: id, label: "x=100 top", midpointMillimeters: [100, 25, 2], lengthMillimeters: 50 }], distanceMillimeters: 20, angleDegrees: 90 } as PartFeature);
  doc.features.push({ id: "u", type: "sheet-unfold", name: "Unfold", suppressed: false, bodyIds: [id] } as PartFeature);
  const flat = 10000 + (20 + bendAllowanceMillimeters(90, 2, rule)) * 2 * 50;
  expect(volume(doc, id)).toBeCloseTo(flat - 36 * hole, 2);
});

it("staggers rows at 60° and refuses a pitch no larger than the hole", () => {
  const { doc, id } = plate();
  doc.features.push({ id: "p", type: "sheet-perforate", name: "Perforate", suppressed: false, bodyIds: [id], face: top(id), diameterMillimeters: 4, pitchMillimeters: 10, marginMillimeters: 2 } as PartFeature);
  const holes = Math.round((10000 - volume(doc, id)) / (Math.PI * 4 * 2));
  expect(holes).toBeGreaterThan(36);
  const bad = { ...doc, features: doc.features.map((f) => f.id === "p" ? { ...f, pitchMillimeters: 4 } : f) } as PartDocument;
  expect(() => evaluatePartDocument(bad)).toThrow(/pitch must be larger/);
});

it("lists every bend with its allowance and deduction, as CSV", () => {
  const { doc, base, id } = plate();
  doc.features.push({ id: "f", type: "sheet-flange", name: "Flange", suppressed: false, bodyIds: [id], edges: [{ kind: "curved-edge", sourceFeatureId: "b", bodyId: id, label: "x=100 top", midpointMillimeters: [100, 25, 2], lengthMillimeters: 50 }], distanceMillimeters: 20, angleDegrees: 90 } as PartFeature);
  doc.features.push({ id: "h", type: "sheet-hem", name: "Hem", suppressed: false, bodyIds: [id], edges: [{ kind: "curved-edge", sourceFeatureId: "b", bodyId: id, label: "x=0 top", midpointMillimeters: [0, 25, 2], lengthMillimeters: 50 }], lengthMillimeters: 8, inward: true } as PartFeature);
  const rows = sheetBendTable(doc, id, base);
  expect(rows.map((r) => [r.kind, r.angle_deg, r.leg_mm, r.direction])).toEqual([["flange", 90, 20, "down"], ["hem", 180, 8, "up"]]);
  expect(rows[0].bend_allowance_mm).toBeCloseTo(bendAllowanceMillimeters(90, 2, rule), 9);
  expect(rows[0].bend_deduction_mm).toBeCloseTo(2 * 4 * Math.tan(Math.PI / 4) - rows[0].bend_allowance_mm, 9);
  expect(rows[1].bend_deduction_mm).toBeNull();
  const csv = bendTableCSV(rows).split("\n");
  expect(csv[0]).toBe("feature_id,name,kind,edges,angle_deg,inner_radius_mm,thickness_mm,k_factor,bend_allowance_mm,bend_deduction_mm,leg_mm,direction");
  expect(csv[2].split(",")[9]).toBe("");
});
