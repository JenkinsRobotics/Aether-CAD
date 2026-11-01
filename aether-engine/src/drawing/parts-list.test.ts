/** Parts list (BOM table) on a sheet: rows from the source's parts, exported in SVG and DXF. */
import { beforeAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { initNodeKernel } from "../kernel/node-kernel";
import { projectPartDrawing } from "../kernel/drawing-projection";
import { createRectanglePartDocument, type PartDocument } from "../document/part-document";
import { availableBodies } from "../document/feature-history";
import { applyDrawingCommand, createDrawingDocument, parseDrawingDocument, serializeDrawingDocument } from "./document";
import { buildDrawing } from "./build";
import { exportDrawingDXF, exportDrawingSVG } from "./export";

beforeAll(async () => { await initNodeKernel(readFileSync(new URL("../../node_modules/replicad-opencascadejs/src/replicad_single.wasm", import.meta.url))); }, 30000);

it("lists every part of the source with its material and prints the table", async () => {
  const part: PartDocument = createRectanglePartDocument("Bracket", { widthMillimeters: 40, heightMillimeters: 20, depthMillimeters: 10 });
  part.features.push({ id: "p2", type: "profile", name: "Boss profile", plane: "XY", offsetMillimeters: 30, suppressed: false, profile: { type: "circle", radiusMillimeters: 5, centerMillimeters: [0, 0] } } as never,
    { id: "e2", type: "extrude", name: "Boss", suppressed: false, profileFeatureId: "p2", distanceMillimeters: 5, operation: "new" } as never);
  const [plate] = availableBodies(part);
  part.bodyProperties = { [plate.id]: { name: "Plate", visible: true, material: { name: "AISI 304", densityKgPerM3: 8000 } } };
  let doc = createDrawingDocument(part);
  const sheet = doc.sheets[0];
  doc = applyDrawingCommand(doc, { type: "update-sheet", sheetId: sheet.id, partsList: { originMm: [167, 20] } });
  expect(doc.formatVersion).toBe(4);
  const built = await buildDrawing(parseDrawingDocument(serializeDrawingDocument(doc)), async (document, options) => projectPartDrawing(document, options));
  const list = built.sheets[0].partsList!;
  expect(list.widthMm).toBe(120);
  expect(list.rows.map(r => r.cells)).toEqual([["1", "Plate", "1", "AISI 304"], ["2", "Body 2", "1", ""]]);
  const svg = exportDrawingSVG(built), dxf = exportDrawingDXF(built);
  expect(svg).toContain("AISI 304"); expect(svg).toContain('font-weight="700">material<');
  expect((svg.match(/data-layer="parts-list"/g) ?? []).length).toBe(4 + 2 + 3);
  expect(dxf).toContain("PARTS_LIST"); expect(dxf).toContain("AISI 304");
  const cleared = applyDrawingCommand(doc, { type: "update-sheet", sheetId: sheet.id, partsList: null });
  expect(cleared.sheets[0].partsList).toBeUndefined();
  expect(() => applyDrawingCommand(doc, { type: "update-sheet", sheetId: sheet.id, partsList: { originMm: [10, 10], widthMm: 10 } })).toThrow();
});
