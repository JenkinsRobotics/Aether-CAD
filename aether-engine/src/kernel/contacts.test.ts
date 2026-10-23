import { beforeAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import init from "replicad-opencascadejs";
import { setOC } from "replicad";
import { checkContacts } from "./contacts";
import { createRectanglePartDocument } from "../document/index";

beforeAll(async () => { setOC(await (init as any)({ wasmBinary: readFileSync(new URL("../../node_modules/replicad-opencascadejs/src/replicad_single.wasm", import.meta.url)) })); }, 30000);

it("reports the pairs of a contact set whose placed bodies pass through each other", () => {
  const cube = createRectanglePartDocument("Cube", { widthMillimeters: 10, heightMillimeters: 10, depthMillimeters: 10 }, { documentId: "doc", sketchId: "s", extrudeId: "e" });
  const parts = [{ id: "cube", document: cube }];
  const sets = [{ id: "set", instance_ids: ["a", "b", "c"] }];
  const apart = checkContacts({ parts, placements: [
    { id: "a", part: "cube", placement_mm: [0, 0, 0], rotation: [0, 0, 0, 1] },
    { id: "b", part: "cube", placement_mm: [20, 0, 0], rotation: [0, 0, 0, 1] },
    { id: "c", part: "cube", placement_mm: [40, 0, 0], rotation: [0, 0, 0, 1] }], sets });
  expect(apart.checked_pairs).toBe(3); expect(apart.overlaps).toEqual([]);
  const through = checkContacts({ parts, placements: [
    { id: "a", part: "cube", placement_mm: [0, 0, 0], rotation: [0, 0, 0, 1] },
    { id: "b", part: "cube", placement_mm: [5, 0, 0], rotation: [0, 0, 0, 1] },
    { id: "c", part: "cube", placement_mm: [40, 0, 0], rotation: [0, 0, 0, 1] }], sets });
  expect(through.overlaps).toHaveLength(1);
  expect(through.overlaps[0]).toMatchObject({ first_instance_id: "a", second_instance_id: "b" });
  expect(through.overlaps[0].volume_mm3).toBeCloseTo(500, 3); // half a cube
  // A quarter turn about z of a cube centred on the origin still overlaps the one beside it by the same amount at 5 mm offset? No: turned, it is the same cube, so yes.
  const turned = checkContacts({ parts, placements: [
    { id: "a", part: "cube", placement_mm: [0, 0, 0], rotation: [0, 0, 0, 1] },
    { id: "b", part: "cube", placement_mm: [5, 0, 0], rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2] }], sets: [{ id: "set", instance_ids: ["a", "b"] }] });
  expect(turned.overlaps[0].volume_mm3).toBeCloseTo(500, 3);
});
