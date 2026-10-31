/** PartDesign MultiTransform equivalent: a pattern whose source is a pattern repeats
 *  all earlier copies with the root feature's operation. Volumes are analytic. */
import { beforeAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { initNodeKernel, solidMeasures } from "./node-kernel";
import { evaluatePartDocument } from "./part-evaluator";
import { createRectanglePartDocument, parsePartDocument, serializePartDocument, type PartDocument } from "../document/index";

beforeAll(async () => { await initNodeKernel(readFileSync(new URL("../../node_modules/replicad-opencascadejs/src/replicad_single.wasm", import.meta.url))); }, 30000);
const volume = (document: PartDocument) => { let v = 0; evaluatePartDocument(parsePartDocument(serializePartDocument(document)), { withBodies: (bodies) => { for (const body of bodies.values()) v += solidMeasures(body).volume_mm3; } }); return v; };
/** A 100 × 100 × 10 plate with a Ø4 post (or hole, cut down from the top face) at x = 10, a row of three along X, then four rows about Z. */
const twice = (operation: "add" | "cut"): PartDocument => {
  const doc = createRectanglePartDocument("Plate", { widthMillimeters: 100, heightMillimeters: 100, depthMillimeters: 10 });
  doc.features.push(
    { id: "c", type: "profile", name: "Post", plane: "XY", offsetMillimeters: 10, suppressed: false, profile: { type: "circle", radiusMillimeters: 2, centerMillimeters: [10, 0] } },
    { id: "p", type: "extrude", name: "Post", suppressed: false, profileFeatureId: "c", distanceMillimeters: operation === "add" ? 5 : 10, operation },
    { id: "row", type: "pattern", name: "Row", suppressed: false, sourceFeatureId: "p", patternType: "linear", axis: "X", spacingMillimeters: 10, count: 3, reversed: false },
    { id: "ring", type: "pattern", name: "Ring", suppressed: false, sourceFeatureId: "row", patternType: "polar", axis: "Z", angleDegrees: 360, count: 4, reversed: false },
  );
  return doc;
};
const post = Math.PI * 2 ** 2;
it("patterns a pattern: twelve posts added, twelve holes removed", () => {
  expect(volume(twice("add"))).toBeCloseTo(100 * 100 * 10 + 12 * post * 5, 3);
  expect(volume(twice("cut"))).toBeCloseTo(100 * 100 * 10 - 12 * post * 10, 3);
}, 60000);
