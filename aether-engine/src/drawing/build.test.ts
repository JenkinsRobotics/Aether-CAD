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

it("rebuilds and exports section hatching with constant paper spacing and retained cut intent", async () => {
  let doc = drawing(); doc.sheets[0].views = [doc.sheets[0].views[0]];
  doc = applyDrawingCommand(doc, {type: "update-view", sheetId: doc.activeSheetId, viewId: "front", changes: {section: {offsetMm: 0, hatchSpacingMm: 2}}});
  const first = await buildDrawing(doc, project);
  expect(first.document.formatVersion).toBe(2);
  const checkSpacing = (built: typeof first) => {
    const v = built.sheets[0].views[0];
    const offsets = [...new Set(v.geometry.hatch!.map(line => Number(((line.start[0] - line.start[1]) * Math.SQRT1_2 * v.view.scale).toFixed(6))))].sort((a,b) => a-b);
    expect(offsets.length).toBeGreaterThan(3);
    for (let i=1;i<offsets.length;i++) expect(offsets[i]-offsets[i-1]).toBeCloseTo(2,5);
  };
  checkSpacing(first);
  const resized = applyDrawingCommand(doc, {type:"update-view",sheetId:doc.activeSheetId,viewId:"front",changes:{scale:1}});
  const full = await buildDrawing(resized,project);checkSpacing(full);
  expect(full.sheets[0].views[0].geometry.hatch!.length).toBeGreaterThan(first.sheets[0].views[0].geometry.hatch!.length);
  const source = structuredClone(doc.source), extrude = source.features.find(f=>f.type==="extrude")!;
  if(extrude.type!=="extrude")throw Error("Missing extrusion");extrude.distanceMillimeters=25;
  const updated = applyDrawingCommand(doc,{type:"refresh-source",source});
  const reopened = await buildDrawing(parseDrawingDocument(serializeDrawingDocument(updated)),project);
  expect(reopened.sheets[0].annotations[0].text).toBe("25.00");
  expect(reopened.sheets[0].views[0].view.section).toEqual({offsetMm:0,hatchSpacingMm:2});
  expect(exportDrawingSVG(reopened)).toContain('data-layer="hatch"');
  expect(exportDrawingDXF(reopened)).toContain('8\nHATCH\n');
});

it("shares width/height label alignment across layout, SVG and DXF", async () => {
  const doc = drawing();
  doc.sheets[0].annotations.push({ id: "width", kind: "width", viewId: "front", positionMm: [80, 140], decimals: 2 });
  const built = await buildDrawing(doc, project);
  const [height, note, width] = built.sheets[0].annotations;
  expect(height.textAlign).toBe("left");
  expect(height.positionMm[0]).toBeGreaterThan(height.lines[0][0][0]);
  expect(note.textAlign).toBe("left");
  expect(width.textAlign).toBe("center");
  const svg = exportDrawingSVG(built);
  expect(svg).toContain('font-size="3.5">10.00</text>');
  expect(svg).toContain('font-size="3.5" text-anchor="middle">40.00</text>');
  expect(exportDrawingDXF(built)).toContain('1\n40.00\n72\n1\n11\n80\n21\n71.5\n31\n0');
});
