/** Diameter, radius and angle dimensions: attached by proximity, remeasured on rebuild, exported to SVG, DXF and PDF. */
import { beforeAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { initNodeKernel } from "../kernel/node-kernel";
import { projectPartDrawing } from "../kernel/drawing-projection";
import { createRectanglePartDocument, type HoleFeature, type PartDocument } from "../document/index";
import { applyDrawingCommand, createDrawingDocument, parseDrawingDocument, serializeDrawingDocument, type DrawingAnnotation } from "./document";
import { buildDrawing } from "./build";
import { exportDrawingDXF, exportDrawingSVG } from "./export";
import { exportDrawingPDF } from "./pdf";

beforeAll(async () => { await initNodeKernel(readFileSync(new URL("../../node_modules/replicad-opencascadejs/src/replicad_single.wasm", import.meta.url))); }, 30000);
const project = async (...args: Parameters<typeof projectPartDrawing>) => projectPartDrawing(...args);
const fontBytes = readFileSync(createRequire(import.meta.url).resolve("@aether/assets/fonts/noto-sans/NotoSans-Regular.ttf"));

function platePart(): PartDocument {
  const base = createRectanglePartDocument("Plate", { widthMillimeters: 40, heightMillimeters: 20, depthMillimeters: 10 });
  return { ...base, features: [...base.features,
    { id: "c", type: "profile", name: "Centre", plane: "XY", offsetMillimeters: 10, suppressed: false, profile: { type: "circle", radiusMillimeters: 1, centerMillimeters: [0, 0] } },
    { id: "h", type: "hole", name: "Hole", suppressed: false, profileFeatureId: "c", diameterMillimeters: 6.8, depthMillimeters: 10, depthType: "through-all", cutType: "plain" } as HoleFeature,
  ] };
}
function drawing(annotations: DrawingAnnotation[]) {
  const doc = createDrawingDocument(platePart());
  doc.sheets[0].views = [
    { id: "front", name: "Front", orientation: "front", originMm: [80, 110], scale: 0.5, hiddenLines: true },
    { id: "top", name: "Top", orientation: "top", originMm: [80, 60], scale: 1, hiddenLines: false },
  ];
  return annotations.reduce((d, annotation) => applyDrawingCommand(d, { type: "add-annotation", sheetId: d.activeSheetId, annotation }), doc);
}

it("measures the hole nearest the pick as a diameter or radius and follows the source on refresh", async () => {
  const doc = drawing([
    { id: "dia", kind: "diameter", viewId: "top", decimals: 2, atMm: [83.4, 60], positionMm: [92, 50] },
    { id: "rad", kind: "radius", viewId: "top", decimals: 1, atMm: [80, 56.7], positionMm: [70, 48] },
  ]);
  expect(doc.formatVersion).toBe(3);
  const built = await buildDrawing(parseDrawingDocument(serializeDrawingDocument(doc)), project);
  const [dia, rad] = built.sheets[0].annotations;
  expect(dia).toMatchObject({ text: "Ø6.80", valueMm: 6.8, measure: "diameter", positionMm: [92, 50] });
  expect(rad).toMatchObject({ text: "R3.4", valueMm: 3.4, measure: "radius" });
  // The diameter line spans the circle through its centre (80, 60) towards the label.
  const chord = dia.lines[0];
  expect(Math.hypot(chord[1][0] - chord[0][0], chord[1][1] - chord[0][1])).toBeCloseTo(6.8, 5);
  expect((chord[0][0] + chord[1][0]) / 2).toBeCloseTo(80, 5); expect((chord[0][1] + chord[1][1]) / 2).toBeCloseTo(60, 5);
  // A leader reaches the label when it sits outside the circle.
  expect(dia.lines.at(-1)![1]).toEqual([92, 50]);
  const source = structuredClone(doc.source); (source.features.find(f => f.id === "h") as HoleFeature).diameterMillimeters = 9;
  const refreshed = await buildDrawing(applyDrawingCommand(doc, { type: "refresh-source", source }), project);
  expect(refreshed.sheets[0].annotations[0].text).toBe("Ø9.00");
  expect(refreshed.sheets[0].annotations[1].text).toBe("R4.5");
}, 60000);

it("measures the angle between the two straight edges nearest the picks, in the sector they span", async () => {
  // Front view: the plate spans sheet X 70..90 and Y 107.5..112.5; picks sit near the bottom and right edges.
  const doc = drawing([{ id: "corner", kind: "angle", viewId: "front", decimals: 1, atMm: [80, 112.6], toMm: [90.1, 110], positionMm: [86, 109] }]);
  const built = await buildDrawing(doc, project);
  const [corner] = built.sheets[0].annotations;
  expect(corner).toMatchObject({ text: "90.0°", valueDeg: 90, measure: "angle", textAlign: "center" });
  expect(corner.valueMm).toBeUndefined();
  // Both extension lines start at the shared corner (90, 112.5).
  expect(corner.lines[0][0]).toEqual(corner.lines[1][0]);
  expect(corner.lines[0][0][0]).toBeCloseTo(90, 5); expect(corner.lines[0][0][1]).toBeCloseTo(112.5, 5);
  const svg = exportDrawingSVG(built), dxf = exportDrawingDXF(built);
  expect(svg).toContain('text-anchor="middle">90.0°</text>');
  expect(dxf).toContain("\\U+00B0");
  const pdf = await exportDrawingPDF(await buildDrawing(drawing([{ id: "dia", kind: "diameter", viewId: "top", decimals: 2, atMm: [83.4, 60], positionMm: [92, 50] }, ...doc.sheets[0].annotations]), project), { fontBytes });
  expect(pdf.byteLength).toBeGreaterThan(1000);
}, 60000);

it("refuses picks that touch no edge, the same edge twice, or parallel edges", async () => {
  await expect(buildDrawing(drawing([{ id: "d", kind: "diameter", viewId: "front", decimals: 2, atMm: [80, 110], positionMm: [80, 100] }]), project)).rejects.toThrow(/No circle or arc lies within 5 mm/);
  await expect(buildDrawing(drawing([{ id: "a", kind: "angle", viewId: "front", decimals: 1, atMm: [75, 112.6], toMm: [85, 112.6], positionMm: [80, 100] }]), project)).rejects.toThrow(/two different straight edges/);
  await expect(buildDrawing(drawing([{ id: "a", kind: "angle", viewId: "front", decimals: 1, atMm: [80, 112.6], toMm: [80, 107.4], positionMm: [80, 100] }]), project)).rejects.toThrow(/parallel/);
  expect(() => parseDrawingDocument(JSON.stringify({ ...drawing([]), formatVersion: 2, sheets: [{ ...drawing([]).sheets[0], annotations: [{ id: "d", kind: "diameter", viewId: "top", decimals: 2, atMm: [0, 0], positionMm: [0, 0] }] }] }))).toThrow(/format version 3/);
}, 60000);
