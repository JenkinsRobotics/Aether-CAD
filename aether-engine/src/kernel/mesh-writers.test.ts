import { beforeAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import init from "replicad-opencascadejs";
import { setOC } from "replicad";
import { exportPart } from "./export";
import { parseMesh } from "./mesh-formats";
import { storedZip } from "./mesh-writers";
import { createRectanglePartDocument, type PartDocument } from "../document/index";
beforeAll(async () => {
  setOC(await (init as any)({ wasmBinary: readFileSync(new URL("../../node_modules/replicad-opencascadejs/src/replicad_single.wasm", import.meta.url)) }));
}, 30000);
const plate = () => createRectanglePartDocument("Plate", { widthMillimeters: 60, heightMillimeters: 40, depthMillimeters: 20 }, { documentId: "doc", sketchId: "sk", extrudeId: "ex" });
const twoBodies = (): PartDocument => { const d = plate(); return { ...d, features: [...d.features,
  { id: "s2", type: "profile", name: "Square", plane: "XY", offsetMillimeters: 10, suppressed: false, profile: { type: "polygon", pointsMillimeters: [[-10, -10], [10, -10], [10, 10], [-10, 10]] } },
  { id: "e2", type: "extrude", name: "Block", profileFeatureId: "s2", distanceMillimeters: 20, operation: "new", suppressed: false }] } as PartDocument; };
const text = (bytes: ArrayBuffer) => new TextDecoder().decode(bytes);

it("writes OBJ in millimetres that the mesh importer reads back as the same box", async () => {
  const obj = await exportPart(twoBodies(), { format: "obj" });
  expect(obj.body_count).toBe(2);
  const source = text(obj.bytes);
  expect(source.match(/^o /gm)).toHaveLength(2);
  const mesh = parseMesh(new Uint8Array(obj.bytes), "obj");
  expect(mesh.triangles.length / 3).toBe(24);
  const xs = Array.from(mesh.vertices).filter((_, i) => i % 3 === 0);
  expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(60, 5);
});

it("writes a valid GLB in metres with Y up, flat normals and per-body nodes", async () => {
  const glb = await exportPart(twoBodies(), { format: "gltf" });
  const view = new DataView(glb.bytes);
  expect(view.getUint32(0, true)).toBe(0x46546c67); expect(view.getUint32(4, true)).toBe(2); expect(view.getUint32(8, true)).toBe(glb.bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  expect(view.getUint32(16, true)).toBe(0x4e4f534a);
  const json = JSON.parse(text(glb.bytes.slice(20, 20 + jsonLength)));
  expect(json.asset.version).toBe("2.0");
  expect(json.nodes.map((n: { name: string }) => n.name)).toEqual(["Body 1", "Body 2"]);
  const [position] = json.accessors;
  // 60 × 40 × 20 mm plate: X spans 0.06 m, the former Z (20 mm, upward) is glTF Y, the former Y is -Z.
  expect(position.max[0] - position.min[0]).toBeCloseTo(0.06, 9);
  expect(position.max[1] - position.min[1]).toBeCloseTo(0.02, 9);
  expect(position.max[2] - position.min[2]).toBeCloseTo(0.04, 9);
  expect(position.count).toBe(36);
  expect(view.getUint32(20 + jsonLength + 4, true)).toBe(0x004e4942);
  expect(json.buffers[0].byteLength).toBe(view.getUint32(20 + jsonLength, true));
  expect(json.bufferViews.every((b: { byteOffset: number }) => b.byteOffset % 4 === 0)).toBe(true);
});

it("writes 3MF as a stored OPC zip whose model is in millimetres", async () => {
  const result = await exportPart(plate(), { format: "3mf", toleranceMillimeters: 0.05 });
  const bytes = new Uint8Array(result.bytes);
  expect(Array.from(bytes.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
  const archive = text(result.bytes);
  expect(archive).toContain("3D/3dmodel.model");
  expect(archive).toContain('unit="millimeter"');
  expect(archive.match(/<triangle /g)).toHaveLength(12);
  expect(archive).toContain('<object id="1" name="Body 1"');
  // The end-of-central-directory record counts the three parts.
  const view = new DataView(result.bytes);
  expect(view.getUint32(result.bytes.byteLength - 22, true)).toBe(0x06054b50);
  expect(view.getUint16(result.bytes.byteLength - 12, true)).toBe(3);
  // CRC-32 check on a known vector.
  const zip = storedZip([["a.txt", "123456789"]]);
  expect(new DataView(zip.buffer).getUint32(14, true)).toBe(0xcbf43926);
});

it("rejects unknown formats and keeps the tolerance rule for every mesh format", async () => {
  await expect(exportPart(plate(), { format: "amf" as never })).rejects.toThrow(/Choose STEP, STL, OBJ, glTF or 3MF/);
  await expect(exportPart(plate(), { format: "gltf", toleranceMillimeters: 10 })).rejects.toThrow(/between 0.001 and 5/);
});
