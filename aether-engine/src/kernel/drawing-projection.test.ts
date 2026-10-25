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

it("cuts exact sections with analytic circles and hatches only material around holes", () => {
  const source = createEmptyPartDocument("Tube");
  source.features = [
    { id: "outer", name: "Outer", type: "profile", suppressed: false, plane: "XY", offsetMillimeters: 0, profile: { type: "circle", centerMillimeters: [0, 0], radiusMillimeters: 7 } },
    { id: "body", name: "Tube blank", type: "extrude", suppressed: false, profileFeatureId: "outer", distanceMillimeters: 12, operation: "new" },
    { id: "inner", name: "Bore", type: "profile", suppressed: false, plane: "XY", offsetMillimeters: 12, profile: { type: "circle", centerMillimeters: [0, 0], radiusMillimeters: 3 } },
    { id: "cut", name: "Bore cut", type: "extrude", suppressed: false, profileFeatureId: "inner", distanceMillimeters: 12, operation: "cut" },
  ];
  for (const orientation of ["top", "bottom"] as const) {
    const projection = projectPartDrawing(source, { orientation, section: { offsetMm: 6, modelSpacingMm: 2 } });
    const circles = projection.visible.filter(c => c.kind === "circle");
    expect(circles.some(c => Math.abs(c.radius - 3) < 1e-7)).toBe(true);
    expect(circles.some(c => Math.abs(c.radius - 7) < 1e-7)).toBe(true);
    expect(projection.hatch!.length).toBeGreaterThan(5);
    for (const line of projection.hatch!) for (let t = 0; t <= 1; t += 0.1) {
      const p = line.start.map((n, i) => n + t * (line.end[i] - n));
      expect(Math.hypot(...p)).toBeGreaterThanOrEqual(3 - 1e-6);
      expect(Math.hypot(...p)).toBeLessThanOrEqual(7 + 1e-6);
    }
  }
  for (const orientation of ["front", "back", "left", "right"] as const) {
    const projection = projectPartDrawing(source, { orientation, section: { offsetMm: 0, modelSpacingMm: 2 } });
    expect(projection.bounds[3] - projection.bounds[1]).toBeCloseTo(12, 5);
    expect(projection.hatch!.length).toBeGreaterThan(5);
    for (const line of projection.hatch!) expect(Math.abs((line.start[0] + line.end[0]) / 2)).toBeGreaterThanOrEqual(3 - 1e-6);
  }
  expect(() => projectPartDrawing(source, { orientation: "top", section: { offsetMm: 50, modelSpacingMm: 2 } })).toThrow(/does not cross/);
  expect(() => projectPartDrawing(source, { orientation: "top", section: { offsetMm: 6, modelSpacingMm: 0.00001 } })).toThrow(/2048/);
  expect(projectPartDrawing(source, { orientation: "front" }).bounds[3]).toBeCloseTo(12, 5);
});
