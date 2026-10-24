import { beforeAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import init from "replicad-opencascadejs";
import { setOC } from "replicad";
import { analyzePart } from "./analysis";
import type { PartDocument } from "../document/index";

beforeAll(async () => {
  setOC(await (init as any)({ wasmBinary: readFileSync(require.resolve("replicad-opencascadejs/src/replicad_single.wasm")) }));
}, 60000);

const objDocument = (obj: string): PartDocument => ({ format: "aether-part", formatVersion: 21, documentId: "m", name: "Mesh", units: "millimeter", features: [
  { id: "m", type: "import-cad", name: "Scan.obj", suppressed: false, operation: "new", bodyId: "m:body-m", sourceName: "Scan.obj", dataBase64: btoa(obj), format: "obj", meshMode: "reference", meshUnits: "mm" }] } as unknown as PartDocument);
/** A 40 × 20 box, 6 tall along Y. */
const box = "v -20 0 -10\nv 20 0 -10\nv 20 0 10\nv -20 0 10\nv -20 6 -10\nv 20 6 -10\nv 20 6 10\nv -20 6 10\nf 1 2 3 4\nf 5 8 7 6\nf 1 5 6 2\nf 2 6 7 3\nf 3 7 8 4\nf 4 8 5 1\n";
/** A 64-sided prism of radius 10 along Z, 0..15, with fan caps from centre vertices. */
function prism(): string {
  const n = 64, lines: string[] = [];
  for (let i = 0; i < n; i++) { const a = (2 * Math.PI * i) / n; lines.push(`v ${10 * Math.cos(a)} ${10 * Math.sin(a)} 0`, `v ${10 * Math.cos(a)} ${10 * Math.sin(a)} 15`); }
  lines.push("v 0 0 0", "v 0 0 15");
  const bottom = 2 * n + 1, top = 2 * n + 2;
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; lines.push(`f ${2 * i + 1} ${2 * j + 1} ${2 * j + 2} ${2 * i + 2}`, `f ${bottom} ${2 * j + 1} ${2 * i + 1}`, `f ${top} ${2 * i + 2} ${2 * j + 2}`); }
  return lines.join("\n");
}
type Profile = { frame: { normal: number[] }; depthMillimeters: number; contours: { type: string; segments?: { type: string }[]; radius?: number }[] };

it("converts a box mesh into a four-line profile and its depth", () => {
  const profile = analyzePart(objDocument(box), { kind: "mesh_convert", bodyIds: ["m:body-m"] }).measurements[0] as Profile;
  expect(Math.abs(profile.frame.normal[1])).toBeCloseTo(1, 9);
  expect(profile.depthMillimeters).toBeCloseTo(6, 9);
  expect(profile.contours.map((c) => c.type)).toEqual(["path"]);
  expect(profile.contours[0].segments?.map((s) => s.type)).toEqual(["line", "line", "line", "line"]);
});

it("converts a faceted cylinder into a circle", () => {
  const profile = analyzePart(objDocument(prism()), { kind: "mesh_convert", bodyIds: ["m:body-m"] }).measurements[0] as Profile;
  expect(profile.depthMillimeters).toBeCloseTo(15, 9);
  expect(profile.contours).toHaveLength(1);
  expect(profile.contours[0].type).toBe("circle");
  expect(profile.contours[0].radius).toBeCloseTo(10, 1);
});

it("refuses a mesh that is not one profile extruded straight", () => {
  expect(() => analyzePart(objDocument(box.replace("v 20 6 10", "v 20 8 10")), { kind: "mesh_convert", bodyIds: ["m:body-m"] })).toThrow(/not one profile|vertices between/);
});
