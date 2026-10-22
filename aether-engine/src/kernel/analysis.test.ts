import { beforeAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import init from "replicad-opencascadejs";
import { setOC } from "replicad";
import { analyzePart } from "./analysis";
import { exportPart } from "./export";
import { evaluatePartDocument } from "./part-evaluator";
import { createRectanglePartDocument, type PartDocument } from "../document/index";
beforeAll(async () => {
  setOC(await (init as any)({ wasmBinary: readFileSync(new URL("../../node_modules/replicad-opencascadejs/src/replicad_single.wasm", import.meta.url)) }));
}, 30000);
const ids = { documentId: "doc", sketchId: "sk", extrudeId: "ex" };
const plate = () => createRectanglePartDocument("Plate", { widthMillimeters: 60, heightMillimeters: 40, depthMillimeters: 20 }, ids);
const withSecond = (): PartDocument => {
  const document = plate();
  return { ...document, features: [...document.features,
    { id: "s2", type: "profile", name: "Square", plane: "XY", offsetMillimeters: 10, suppressed: false, profile: { type: "polygon", pointsMillimeters: [[-10, -10], [10, -10], [10, 10], [-10, 10]] } },
    { id: "e2", type: "extrude", name: "Block", profileFeatureId: "s2", distanceMillimeters: 20, operation: "new", suppressed: false }] } as PartDocument;
};

it("physical properties: exact volume, area, centroid, bounds, and mass and inertia about the centroid", () => {
  const result = analyzePart(plate(), { kind: "properties", density_kg_m3: 1000 });
  expect(result.bodies).toEqual([]);
  const [m] = result.measurements as Record<string, number | number[] | number[][]>[];
  expect(m.body_id).toBe("doc:body-1");
  expect(m.volume_mm3).toBeCloseTo(48000, 6);
  expect(m.area_mm2).toBeCloseTo(8800, 6);
  expect((m.center_mm as number[]).map((v) => +v.toFixed(6))).toEqual([0, 0, 10]);
  expect((m.bounds_mm as number[]).map((v) => +v.toFixed(5))).toEqual([60, 40, 20]);
  expect(m.mass_kg).toBeCloseTo(0.048, 9);
  const inertia = m.inertia_kg_m2 as number[][];
  const mass = 0.048;
  expect(inertia[0][0]).toBeCloseTo(mass / 12 * (40 ** 2 + 20 ** 2) * 1e-6, 9);
  expect(inertia[1][1]).toBeCloseTo(mass / 12 * (60 ** 2 + 20 ** 2) * 1e-6, 9);
  expect(inertia[2][2]).toBeCloseTo(mass / 12 * (60 ** 2 + 40 ** 2) * 1e-6, 9);
  expect(Math.abs(inertia[0][1]) + Math.abs(inertia[0][2]) + Math.abs(inertia[1][2])).toBeLessThan(1e-12);
  expect(() => analyzePart(plate(), { kind: "properties", density_kg_m3: -1 })).toThrow(/Density must be a positive/);
});

it("section keeps the material on one side of a principal plane, capped, and renders it", () => {
  const below = analyzePart(plate(), { kind: "section", plane: "XY", offset_mm: 5 });
  expect(below.measurements).toEqual([{ body_id: "doc:body-1", volume_mm3: expect.closeTo(12000, 6) }]);
  expect(below.bodies).toHaveLength(1);
  expect(below.bodies[0].id).toBe("doc:body-1");
  expect(below.bodies[0].vertices.length).toBeGreaterThan(0);
  const above = analyzePart(plate(), { kind: "section", plane: "XY", offset_mm: 5, reverse: true });
  expect((above.measurements[0] as { volume_mm3: number }).volume_mm3).toBeCloseTo(36000, 6);
  // A plane beyond the part leaves nothing on the kept side.
  expect(analyzePart(plate(), { kind: "section", plane: "YZ", offset_mm: -40 }).bodies).toEqual([]);
});

it("interference reports each overlapping pair's exact volume and shows the overlap", () => {
  expect(() => analyzePart(plate(), { kind: "interference" })).toThrow(/at least two/);
  const result = analyzePart(withSecond(), { kind: "interference" });
  expect(result.measurements).toEqual([{ first_body_id: "doc:body-1", second_body_id: "doc:body-e2", volume_mm3: expect.closeTo(4000, 6) }]);
  expect(result.bodies.map((b) => b.id)).toEqual(["doc:body-1|doc:body-e2"]);
});

it("exports exact STEP and binary STL, and a STEP export imports back as the same solid", async () => {
  const step = await exportPart(plate(), { format: "step" });
  expect(step.body_count).toBe(1);
  expect(new TextDecoder().decode(step.bytes.slice(0, 12))).toBe("ISO-10303-21");
  const stl = await exportPart(withSecond(), { format: "stl", toleranceMillimeters: 0.05 });
  expect(stl.body_count).toBe(2);
  const triangles = new DataView(stl.bytes).getUint32(80, true);
  expect(stl.bytes.byteLength).toBe(84 + 50 * triangles);
  expect(triangles).toBe(24); // two boxes, two triangles per face
  await expect(exportPart(plate(), { format: "step", bodyIds: ["missing"] })).rejects.toThrow(/export body is unavailable/);
  // Round trip through the import feature: the saved STEP source becomes a body of the same volume.
  const base64 = btoa(String.fromCharCode(...new Uint8Array(step.bytes)));
  const imported: PartDocument = { format: "aether-part", formatVersion: 21, documentId: "imp", name: "Imported", units: "millimeter", features: [
    { id: "i", type: "import-step", name: "Plate.step", suppressed: false, operation: "new", bodyId: "imp:body-i", sourceName: "Plate.step", dataBase64: base64 }] } as unknown as PartDocument;
  const model = evaluatePartDocument(imported);
  expect(model.parts.map((p) => p.id)).toEqual(["imp:body-i"]);
  expect(model.parts[0].topology.filter((f) => f.surfaceType === "PLANE")).toHaveLength(6);
  const stlBase64 = btoa(String.fromCharCode(...new Uint8Array((await exportPart(plate(), { format: "stl" })).bytes)));
  const mesh: PartDocument = { ...imported, documentId: "stl", features: [
    { id: "m", type: "import-cad", name: "Plate.stl", suppressed: false, operation: "new", bodyId: "stl:body-m", sourceName: "Plate.stl", dataBase64: stlBase64, format: "stl", meshMode: "solid", meshUnits: "cm" }] } as unknown as PartDocument;
  let volume = 0;
  evaluatePartDocument(mesh, { withBodies: (bodies) => { for (const body of bodies.values()) volume = (body as { boundingBox: { bounds: number[][] } }).boundingBox.bounds[1][0] - (body as { boundingBox: { bounds: number[][] } }).boundingBox.bounds[0][0]; } });
  expect(volume).toBeCloseTo(600, 3); // 60 mm read as centimetres
});

it("imports meshes: STL as a mesh reference the viewer draws, OBJ as a faceted solid in source units", async () => {
  const stlBase64 = btoa(String.fromCharCode(...new Uint8Array((await exportPart(plate(), { format: "stl" })).bytes)));
  const reference: PartDocument = { format: "aether-part", formatVersion: 21, documentId: "ref", name: "Reference", units: "millimeter", features: [
    { id: "m", type: "import-cad", name: "Plate.stl", suppressed: false, operation: "new", bodyId: "ref:body-m", sourceName: "Plate.stl", dataBase64: stlBase64, format: "stl", meshMode: "reference", meshUnits: "mm" }] } as unknown as PartDocument;
  const model = evaluatePartDocument(reference);
  expect(model.parts.map((p) => [p.id, p.geometryKind, p.triangles.length / 3])).toEqual([["ref:body-m", "mesh", 12]]);
  expect(model.parts[0].topology).toEqual([]);
  // A mesh reference is not a solid: a cut into it says so.
  const cut: PartDocument = { ...reference, features: [...reference.features,
    { id: "s", type: "profile", name: "Hole", plane: "XY", offsetMillimeters: 20, suppressed: false, profile: { type: "circle", radiusMillimeters: 3, centerMillimeters: [0, 0] } },
    { id: "c", type: "extrude", name: "Cut", profileFeatureId: "s", distanceMillimeters: 5, operation: "cut", targetBodyId: "ref:body-m", suppressed: false }] } as unknown as PartDocument;
  expect(() => evaluatePartDocument(cut)).toThrow(/requires a solid body/);
  const obj = btoa("v 0 0 0\nv 2 0 0\nv 2 1 0\nv 0 1 0\nv 0 0 1\nv 2 0 1\nv 2 1 1\nv 0 1 1\nf 1 4 3 2\nf 5 6 7 8\nf 1 2 6 5\nf 2 3 7 6\nf 3 4 8 7\nf 4 1 5 8\n");
  const solid: PartDocument = { ...reference, documentId: "obj", features: [
    { id: "m", type: "import-cad", name: "Box.obj", suppressed: false, operation: "new", bodyId: "obj:body-m", sourceName: "Box.obj", dataBase64: obj, format: "obj", meshMode: "solid", meshUnits: "in" }] } as unknown as PartDocument;
  const volumes = analyzePart(solid, { kind: "properties" }).measurements as { volume_mm3: number }[];
  expect(volumes[0].volume_mm3).toBeCloseTo(2 * 25.4 ** 3, 1); // float32 STL vertices
  const open = btoa("v 0 0 0\nv 1 0 0\nv 1 1 0\nf 1 2 3\n");
  expect(() => evaluatePartDocument({ ...solid, features: [{ ...solid.features[0], dataBase64: open }] } as PartDocument)).toThrow(/closed mesh/);
});
