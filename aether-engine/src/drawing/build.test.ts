import { beforeAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { initNodeKernel } from "../kernel/node-kernel";
import { projectPartDrawing } from "../kernel/drawing-projection";
import { createRectanglePartDocument } from "../document/part-document";
import { applyDrawingCommand, createDrawingDocument, parseDrawingDocument, serializeDrawingDocument } from "./document";
import { buildDrawing } from "./build";
import { exportDrawingDXF, exportDrawingSVG } from "./export";
import { importDxfSketch } from "../sketch/import/dxf";

beforeAll(async () => { await initNodeKernel(readFileSync(new URL("../../node_modules/replicad-opencascadejs/src/replicad_single.wasm", import.meta.url))); }, 30000);
const project = async (...args: Parameters<typeof projectPartDrawing>) => projectPartDrawing(...args);
function drawing() {
  const part = createRectanglePartDocument("Bracket & plate", { widthMillimeters: 40, heightMillimeters: 20, depthMillimeters: 10 });
  const doc = createDrawingDocument(part);
  doc.sheets[0].views = [
    { id: "front", name: "Front", orientation: "front", originMm: [80, 110], scale: 0.5, hiddenLines: true },
    { id: "top", name: "Top", orientation: "top", originMm: [80, 60], scale: 1, hiddenLines: false, parentId: "front" },
  ];
  doc.sheets[0].annotations = [{ id: "height", kind: "height", viewId: "front", positionMm: [100, 110], decimals: 2 }, { id: "note", kind: "note", text: "Deburr <all> edges", positionMm: [20, 180] }];
  return doc;
}
it("updates associative model dimensions while keeping paper scale and authored references", async () => {
  const original = drawing(), before = await buildDrawing(original, project);
  expect(before.sheets[0].annotations[0].valueMm).toBeCloseTo(10, 5);
  expect(before.sheets[0].views[0].boundsMm[3] - before.sheets[0].views[0].boundsMm[1]).toBeCloseTo(5, 5);
  const part = structuredClone(original.source), extrude = part.features.find(f => f.type === "extrude")!;
  if (extrude.type !== "extrude") throw Error("Missing extrusion");
  extrude.distanceMillimeters = 25;
  const refreshed = applyDrawingCommand(original, { type: "refresh-source", source: part });
  const after = await buildDrawing(parseDrawingDocument(serializeDrawingDocument(refreshed)), project);
  expect(after.sheets[0].annotations[0]).toMatchObject({ id: "height", text: "25.00" });
  expect(after.sheets[0].views[0].boundsMm[3] - after.sheets[0].views[0].boundsMm[1]).toBeCloseTo(12.5, 5);
  expect(after.sourceHash).not.toBe(before.sourceHash);
  expect(after.document.sheets).toEqual(original.sheets);
});
it("exports physical paper units, hidden edges and escaped text in SVG and DXF", async () => {
  const built = await buildDrawing(drawing(), project);
  const svg = exportDrawingSVG(built), dxf = exportDrawingDXF(built);
  expect(svg).toContain('width="297mm" height="210mm"');
  expect(svg).toContain("Deburr &lt;all&gt; edges");
  expect(svg).toContain('stroke-dasharray="3 2"');
  expect(svg).toContain("10.00");
  expect(dxf).toContain("$INSUNITS\n70\n4\n");
  expect(dxf).toContain("HIDDEN\n");
  expect(dxf).toContain("ANNOTATIONS\n");
  expect(dxf.endsWith("0\nEOF\n")).toBe(true);
  const imported = importDxfSketch(dxf, undefined, { includedLayers: ["VISIBLE"], joinConnected: false });
  expect(imported.millimetersPerUnit).toBe(1);
  const points = imported.drawing.contours.flatMap(c => c.type === "path" ? [c.start, ...c.segments.map(s => s.end)] : []);
  // Two half-scale 40 mm wide views exported at X=80: model-space sheet
  // coordinates must be 70..90 mm, with no inch conversion or pixel scaling.
  expect(Math.min(...points.map(p => p[0]))).toBeCloseTo(70, 5);
  expect(Math.max(...points.map(p => p[0]))).toBeCloseTo(90, 5);
  expect(() => exportDrawingSVG(built, "missing")).toThrow(/does not exist/);
});
