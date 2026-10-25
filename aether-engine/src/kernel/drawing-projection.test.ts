import { beforeAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { initNodeKernel } from "./node-kernel";
import { createRectanglePartDocument, createEmptyPartDocument } from "../document/part-document";
import { projectPartDrawing } from "./drawing-projection";
import { createDrawingDocument, serializeDrawingDocument, parseDrawingDocument } from "../drawing/document";

beforeAll(async () => { await initNodeKernel(readFileSync(new URL("../../node_modules/replicad-opencascadejs/src/replicad_single.wasm", import.meta.url))); }, 30000);
const part = () => createRectanglePartDocument("Box", { widthMillimeters: 40, heightMillimeters: 20, depthMillimeters: 10 });
it("projects true-size front/top/right views with real hidden edges", () => {
  const source = part();
  for (const [orientation, width, height] of [["front", 40, 10], ["top", 40, 20], ["right", 20, 10]] as const) {
    const projection = projectPartDrawing(source, { orientation });
    expect(projection.bounds[2] - projection.bounds[0]).toBeCloseTo(width, 5);
    expect(projection.bounds[3] - projection.bounds[1]).toBeCloseTo(height, 5);
    expect(projection.visible.length).toBeGreaterThan(0);
    expect(projection.hidden.length).toBeGreaterThan(0);
    expect(projection.visible.every(c => c.kind === "line")).toBe(true);
  }
});
it("keeps circles analytic instead of turning them into drawing chords", () => {
  const source = createEmptyPartDocument("Cylinder");
  source.features = [
    { id: "circle", name: "Circle", type: "profile", suppressed: false, plane: "XY", offsetMillimeters: 0, profile: { type: "circle", centerMillimeters: [0, 0], radiusMillimeters: 7 } },
    { id: "body", name: "Extrude", type: "extrude", suppressed: false, profileFeatureId: "circle", distanceMillimeters: 12, operation: "new" },
  ];
  const projection = projectPartDrawing(source, { orientation: "top" });
  expect(projection.visible.some(c => c.kind === "circle" && Math.abs(c.radius - 7) < 1e-8)).toBe(true);
  expect(projection.bounds[2] - projection.bounds[0]).toBeCloseTo(14, 5);
});
it("rebuilds changed geometry after saving and reopening the independent drawing", () => {
  const drawing = createDrawingDocument(part());
  const feature = drawing.source.features.find(f => f.type === "extrude")!;
  if (feature.type !== "extrude") throw Error("Expected extrusion");
  feature.distanceMillimeters = 27;
  const reopened = parseDrawingDocument(serializeDrawingDocument(drawing));
  const projection = projectPartDrawing(reopened.source, { orientation: "front" });
  expect(projection.bounds[3] - projection.bounds[1]).toBeCloseTo(27, 5);
  expect(projection.bodyIds).toEqual(projectPartDrawing(drawing.source, { orientation: "front" }).bodyIds);
});
it("fails clearly on missing bodies and empty models", () => {
  expect(() => projectPartDrawing(part(), { orientation: "front", bodyIds: ["gone"] })).toThrow(/no longer exists/);
  expect(() => projectPartDrawing(createEmptyPartDocument("Empty"), { orientation: "top" })).toThrow(/exact bodies/);
});
