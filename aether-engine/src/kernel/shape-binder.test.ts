/** Shape binder: a live copy of a part or of its faces that follows the source on rebuild. */
import { beforeAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import init from "replicad-opencascadejs";
import { measureArea, measureVolume, setOC, type Shape3D } from "replicad";
import { evaluatePartDocument } from "./part-evaluator";
import { availableBodies, createRectanglePartDocument, validatePartDocument, type PartDocument, type ShapeBinderFeature } from "../document/index";

beforeAll(async () => {
  setOC(await (init as any)({ wasmBinary: readFileSync(new URL("../../node_modules/replicad-opencascadejs/src/replicad_single.wasm", import.meta.url)) }));
}, 30000);

const measure = (doc: PartDocument) => {
  const out: Record<string, { volume: number; area: number }> = {};
  evaluatePartDocument(doc, { withBodies: (bodies) => { for (const [id, body] of bodies) out[id] = { volume: measureVolume(body as Shape3D), area: measureArea(body as Shape3D) }; } });
  return out;
};
const withBinder = (binder: (extrudeId: string, bodyId: string) => Partial<ShapeBinderFeature>, depth = 20) => {
  const base = createRectanglePartDocument("Binder", { widthMillimeters: 40, heightMillimeters: 30, depthMillimeters: depth });
  const extrude = base.features.find((f) => f.type === "extrude")!, bodyId = availableBodies(base)[0].id;
  const doc: PartDocument = { ...base, features: [...base.features, { id: "binder", type: "shape-binder", name: "Binder", suppressed: false, sourceBodyId: bodyId, operation: "new", ...binder(extrude.id, bodyId) } as ShapeBinderFeature] };
  validatePartDocument(doc);
  return { doc, extrude, bodyId };
};

it("copies the whole part as a new part that follows the source depth", () => {
  const { doc, bodyId } = withBinder(() => ({}));
  const first = measure(doc);
  expect(Object.keys(first)).toHaveLength(2);
  expect(first[bodyId].volume).toBeCloseTo(24000, 3);
  expect(Object.values(first).every((m) => Math.abs(m.volume - 24000) < 1e-3)).toBe(true);
  const taller = measure(withBinder(() => ({}), 50).doc);
  expect(Object.values(taller).every((m) => Math.abs(m.volume - 60000) < 1e-3)).toBe(true);
});

it("binds picked faces as a sheet and refuses faces of another part", () => {
  const { doc, bodyId } = withBinder((extrudeId, body) => ({ faces: [{ sourceFeatureId: extrudeId, bodyId: body, label: "Top", normal: [0, 0, 1] }] }));
  const binder = doc.features.at(-1) as ShapeBinderFeature;
  const out = measure(doc);
  const sheet = Object.entries(out).find(([id]) => id !== bodyId)!;
  expect(sheet[1].area).toBeCloseTo(1200, 3);
  expect(sheet[1].volume).toBeCloseTo(0, 3);
  binder.faces![0].bodyId = "elsewhere";
  expect(() => validatePartDocument(doc)).toThrow(/belong to the source part/);
});
