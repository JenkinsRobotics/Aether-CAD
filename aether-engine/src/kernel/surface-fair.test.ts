import { beforeAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import init from "replicad-opencascadejs";
import { measureArea, setOC, type Shape3D } from "replicad";
import { evaluatePartDocument } from "./part-evaluator";
import { bodyIDForFeature, createEmptyPartDocument, type PartFeature } from "../document/index";

beforeAll(async () => {
  setOC(await (init as any)({ wasmBinary: readFileSync(new URL("../../node_modules/replicad-opencascadejs/src/replicad_single.wasm", import.meta.url)) }));
}, 30000);

it("fairs a bumpy loft: less area, boundary unchanged", () => {
  const doc = createEmptyPartDocument("Fair");
  const curve = (id: string, z: number, bump: number) => ({ id, type: "profile", name: id, plane: "XY", offsetMillimeters: z, suppressed: false, profile: { type: "drawing", contours: [{ id: `${id}c`, type: "path", start: [0, 0], segments: [{ type: "arc", middle: [10, bump], end: [20, 0] }] }] } }) as PartFeature;
  // Arcs (three control points across), the second section much taller: a bump to fair out.
  doc.features.push(curve("a", 0, 2), curve("b", 10, 9), curve("c", 20, 2), curve("d", 30, 2));
  const loft = { id: "l", type: "surface-loft", name: "Loft", suppressed: false, operation: "new", sections: [{ profileFeatureId: "a" }, { profileFeatureId: "b" }, { profileFeatureId: "c" }, { profileFeatureId: "d" }] } as PartFeature;
  doc.features.push(loft);
  const id = bodyIDForFeature(doc, loft);
  const measure = (d: typeof doc) => { let area = 0, bounds: number[][] = []; evaluatePartDocument(d, { withBodies: (b) => { const s = b.get(id) as Shape3D; area = measureArea(s); bounds = s.boundingBox.bounds; } }); return { area, bounds }; };
  const before = measure(doc);
  const faired = { ...doc, features: [...doc.features, { id: "f", type: "surface-fair", name: "Fair", suppressed: false, bodyIds: [id] } as PartFeature] };
  const after = measure(faired);
  expect(after.area).toBeLessThan(before.area - 1);
  // The border rows are held: the sheet still spans x 0..20 and z 0..30.
  for (const [k, v] of [[0, 0], [2, 0]] as const) expect(after.bounds[0][k]).toBeCloseTo(v, 3);
  expect(after.bounds[1][0]).toBeCloseTo(20, 3); expect(after.bounds[1][2]).toBeCloseTo(30, 3);
  // Half strength moves half as far: an area between the two.
  const half = measure({ ...faired, features: faired.features.map((f) => f.id === "f" ? { ...f, strength: 0.5 } : f) as PartFeature[] });
  expect(half.area).toBeLessThan(before.area); expect(half.area).toBeGreaterThan(after.area);
});
