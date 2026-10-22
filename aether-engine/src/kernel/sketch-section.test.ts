import { beforeAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import init from "replicad-opencascadejs";
import { setOC } from "replicad";
import { sketchSectionContours } from "./sketch-section";
import { createRectanglePartDocument, createEmptyPartDocument } from "../document/part-document";
import { principalFrame } from "../document/construction-planes";

beforeAll(async () => {
  setOC(await (init as any)({ wasmBinary: readFileSync(new URL("../../node_modules/replicad-opencascadejs/src/replicad_single.wasm", import.meta.url)) }));
}, 60000);

it("sections a box into its rectangle and lists the edges lying in a face plane", () => {
  const box = createRectanglePartDocument("Section", { widthMillimeters: 30, heightMillimeters: 20, depthMillimeters: 10 });
  const section = sketchSectionContours(box, principalFrame("XY", 5), "section");
  expect(section.length).toBe(4);
  expect(section.every((c) => c.type === "path" && c.segments.length === 1 && c.segments[0].type === "line")).toBe(true);
  const xs = section.flatMap((c) => c.type === "path" ? [c.start[0], c.segments[0].end[0]] : []);
  expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(30, 6);
  const top = sketchSectionContours(box, principalFrame("XY", 10), "edges");
  expect(top.length).toBe(4);
  expect(sketchSectionContours(box, principalFrame("XY", 7), "edges").length).toBe(0);
  const cyl = createEmptyPartDocument("Round");
  cyl.features.push({ id: "c", type: "profile", name: "Circle", plane: "XY", offsetMillimeters: 0, suppressed: false, profile: { type: "circle", radiusMillimeters: 4, centerMillimeters: [3, 2] } });
  cyl.features.push({ id: "e", type: "extrude", name: "Extrude", profileFeatureId: "c", distanceMillimeters: 20, operation: "new", suppressed: false });
  const ring = sketchSectionContours(cyl, principalFrame("XY", 10), "section");
  expect(ring.length).toBe(1);
  expect(ring[0]).toMatchObject({ type: "circle", radius: 4 });
});
