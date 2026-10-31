/** Format version 4 drawing features: detail circles, auxiliary directions, balloons,
 *  centre marks and title-block rows, built on the plate fixture and exported. */
import { beforeAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { initNodeKernel } from "../kernel/node-kernel";
import { projectPartDrawing } from "../kernel/drawing-projection";
import { createRectanglePartDocument, type PartDocument } from "../document/part-document";
import { applyDrawingCommand, createDrawingDocument, parseDrawingDocument, serializeDrawingDocument, type DrawingAnnotation, type DrawingView } from "./document";
import { buildDrawing } from "./build";
import { exportDrawingDXF, exportDrawingSVG } from "./export";
import { clipProjectionToCircle } from "./detail-view";

beforeAll(async () => { await initNodeKernel(readFileSync(new URL("../../node_modules/replicad-opencascadejs/src/replicad_single.wasm", import.meta.url))); }, 30000);
const project = async (...args: Parameters<typeof projectPartDrawing>) => projectPartDrawing(...args);
const plate = (): PartDocument => {
  const part = createRectanglePartDocument("Plate", { widthMillimeters: 40, heightMillimeters: 20, depthMillimeters: 10 });
  part.features.push(
    { id: "c", type: "profile", name: "Hole centre", plane: "XY", offsetMillimeters: 10, suppressed: false, profile: { type: "circle", radiusMillimeters: 1, centerMillimeters: [0, 0] } },
    { id: "h", type: "hole", name: "Hole", suppressed: false, profileFeatureId: "c", diameterMillimeters: 6.8, depthMillimeters: 10, depthType: "through-all", cutType: "plain" },
  );
  return part;
};
const top: DrawingView = { id: "top", name: "Top", orientation: "top", originMm: [80, 60], scale: 1, hiddenLines: false };
function drawing(views: DrawingView[], annotations: DrawingAnnotation[] = []) {
  const doc = createDrawingDocument(plate()), sheet = doc.sheets[0];
  let next = doc;
  for (const view of views) next = applyDrawingCommand(next, { type: "add-view", sheetId: sheet.id, view });
  for (const annotation of annotations) next = applyDrawingCommand(next, { type: "add-annotation", sheetId: sheet.id, annotation });
  return next;
}

it("enlarges a circle of the parent view, marks it on the parent, and refuses detail-of-detail", async () => {
  const doc = drawing([top, { id: "a", name: "Detail A", orientation: "front", originMm: [200, 60], scale: 3, hiddenLines: false, detail: { parentId: "top", centerMm: [80, 60], radiusMm: 6, label: "A" } }]);
  expect(doc.formatVersion).toBe(4);
  const built = await buildDrawing(parseDrawingDocument(serializeDrawingDocument(doc)), project);
  const detail = built.sheets[0].views[1];
  // The hole (Ø6.8) sits inside the 6 mm circle and stays an exact circle; the plate edges lie outside.
  expect(detail.geometry.visible.filter(c => c.kind === "circle")).toHaveLength(1);
  expect(detail.geometry.visible.filter(c => c.kind === "line")).toHaveLength(0);
  expect(detail.boundsMm).toEqual([200 - 18, 60 - 18, 200 + 18, 60 + 18]);
  const marker = built.sheets[0].annotations.find(a => a.symbol === "detail-marker")!;
  expect(marker).toMatchObject({ text: "A", viewId: "top" });
  expect(marker.lines).toHaveLength(32);
  expect(exportDrawingSVG(built)).toContain("Detail A · 3:1");
  expect(() => applyDrawingCommand(doc, { type: "add-view", sheetId: doc.activeSheetId, view: { ...top, id: "b", detail: { parentId: "a", centerMm: [200, 60], radiusMm: 5, label: "B" } } })).toThrow(/non-detail view/);
  expect(() => applyDrawingCommand(doc, { type: "remove-view", sheetId: doc.activeSheetId, viewId: "top" })).toThrow(/dependent/);
}, 30000);

it("clips crossing lines and arcs to the circle", () => {
  const clipped = clipProjectionToCircle({ visible: [{ kind: "line", start: [-10, 0], end: [10, 0] }, { kind: "circle", center: [0, 0], radius: 8 }], hidden: [], bounds: [-10, -8, 10, 8], bodyIds: [] }, [0, 0], 5);
  expect(clipped.visible[0]).toEqual({ kind: "line", start: [-5, 0], end: [5, 0] });
  expect(clipped.visible).toHaveLength(1);
  expect(clipped.bounds).toEqual([-5, -5, 5, 5]);
});

it("projects an auxiliary view along a custom direction with world Z up", async () => {
  const doc = drawing([{ ...top, id: "aux", name: "Auxiliary", direction: [1, -1, 0] }]);
  const built = await buildDrawing(doc, project);
  const [x0, y0, x1, y1] = built.sheets[0].views[0].geometry.bounds;
  // Looking along the XY diagonal: width is the plate's diagonal extent, height is its 10 mm thickness.
  expect(x1 - x0).toBeCloseTo((40 + 20) / Math.SQRT2, 3);
  expect(y1 - y0).toBeCloseTo(10, 3);
  expect(() => applyDrawingCommand(doc, { type: "update-view", sheetId: doc.activeSheetId, viewId: "aux", changes: { section: { offsetMm: 0 } } })).toThrow(/independent view without a section/);
  expect(() => applyDrawingCommand(doc, { type: "update-view", sheetId: doc.activeSheetId, viewId: "aux", changes: { direction: [0, 0, 0] } })).toThrow(/cannot be zero/);
}, 30000);

it("draws balloons, centre marks and title-block rows through SVG and DXF", async () => {
  let doc = drawing([top], [
    { id: "b1", kind: "balloon", text: "1", positionMm: [120, 40], leaderMm: [100, 55] },
    { id: "cm", kind: "center-mark", viewId: "top", atMm: [83.4, 60], positionMm: [83.4, 60] },
  ]);
  doc = applyDrawingCommand(doc, { type: "update-sheet", sheetId: doc.activeSheetId, titleBlock: [{ label: "Drawn by", value: "JJ" }, { label: "Material", value: "6061-T6" }] });
  expect(doc.formatVersion).toBe(4);
  const built = await buildDrawing(parseDrawingDocument(serializeDrawingDocument(doc)), project);
  const [balloon, mark] = built.sheets[0].annotations;
  expect(balloon).toMatchObject({ symbol: "balloon", text: "1", textAlign: "center" });
  expect(balloon.lines).toHaveLength(32 + 4);
  expect(mark).toMatchObject({ symbol: "center-mark", text: "" });
  expect(mark.lines).toEqual([[[80 - 5.4, 60], [80 + 5.4, 60]], [[80, 60 - 5.4], [80, 60 + 5.4]]]);
  const svg = exportDrawingSVG(built), dxf = exportDrawingDXF(built);
  expect(svg).toContain(">Drawn by</text>"); expect(svg).toContain(">6061-T6</text>");
  expect(svg).not.toContain("></text>");
  expect(dxf).toContain("Material: 6061-T6");
  expect(() => parseDrawingDocument(JSON.stringify({ ...doc, formatVersion: 3 }))).toThrow(/format version 4/);
  // Attachment happens at build time, so a far pick fails the rebuild and the previous drawing survives.
  await expect(buildDrawing(applyDrawingCommand(doc, { type: "add-annotation", sheetId: doc.activeSheetId, annotation: { id: "cm2", kind: "center-mark", viewId: "top", atMm: [0, 0], positionMm: [0, 0] } }), project)).rejects.toThrow(/within 5 mm/);
}, 30000);

it("keeps a section view valid once newer annotations raise the format version", () => {
  const doc = drawing([{ ...top, orientation: "front", section: { offsetMm: 0 } }], [{ id: "b", kind: "balloon", text: "2", positionMm: [10, 10], leaderMm: [20, 20] }]);
  expect(doc.formatVersion).toBe(4);
  expect(parseDrawingDocument(serializeDrawingDocument(doc)).sheets[0].views[0].section).toEqual({ offsetMm: 0 });
});
