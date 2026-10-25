import { expect, it } from "vitest";
import { createRectanglePartDocument } from "../document/part-document";
import { applyDrawingCommand, createDrawingDocument, parseDrawingDocument, resolvedDrawingView, serializeDrawingDocument, type DrawingView } from "./document";

const part = () => createRectanglePartDocument("Bracket", { widthMillimeters: 40, heightMillimeters: 20, depthMillimeters: 10 });
const base: DrawingView = { id: "front", name: "Front", orientation: "front", originMm: [80, 100], scale: 2, hiddenLines: true };
it("round trips authoring intent and its independent exact source snapshot", () => {
  const source = part(), drawing = createDrawingDocument(source, "drawing");
  const next = applyDrawingCommand(drawing, { type: "add-view", sheetId: drawing.activeSheetId, view: base });
  source.name = "Changed elsewhere";
  expect(drawing.sheets[0].views).toHaveLength(0);
  expect(next.source.name).toBe("Bracket");
  expect(parseDrawingDocument(serializeDrawingDocument(next))).toEqual(next);
});
it("preserves aligned projection, inherited scale and first/third angle placement", () => {
  const drawing = createDrawingDocument(part());
  const sheet = drawing.sheets[0];
  const top: DrawingView = { ...base, id: "top", orientation: "top", parentId: "front", originMm: [200, 50], scale: 1 };
  sheet.views = [base, top];
  expect(resolvedDrawingView(sheet, top)).toMatchObject({ originMm: [80, 50], scale: 2 });
  sheet.projection = "first_angle";
  expect(resolvedDrawingView(sheet, top)).toMatchObject({ originMm: [80, 150], scale: 2 });
});
it("refuses missing references, cycles, ID collisions and nonfinite values without mutation", () => {
  const drawing = createDrawingDocument(part());
  const before = serializeDrawingDocument(drawing), sheetId = drawing.activeSheetId;
  for (const view of [{ ...base, scale: NaN }, { ...base, parentId: "missing" }, { ...base, id: sheetId }]) {
    expect(() => applyDrawingCommand(drawing, { type: "add-view", sheetId, view })).toThrow();
  }
  expect(serializeDrawingDocument(drawing)).toBe(before);
});
it("retains dimension references on refresh and refuses a different Part", () => {
  const drawing = createDrawingDocument(part()), sheetId = drawing.activeSheetId;
  const withView = applyDrawingCommand(drawing, { type: "add-view", sheetId, view: base });
  const dimensioned = applyDrawingCommand(withView, { type: "add-annotation", sheetId, annotation: { id: "width", kind: "width", viewId: base.id, decimals: 2, positionMm: [80, 120] } });
  const changed = structuredClone(drawing.source); changed.name = "Edited bracket";
  const refreshed = applyDrawingCommand(dimensioned, { type: "refresh-source", source: changed });
  expect(refreshed.sheets).toEqual(dimensioned.sheets);
  expect(() => applyDrawingCommand(refreshed, { type: "remove-view", sheetId, viewId: "front" })).toThrow(/dependent/);
  expect(() => applyDrawingCommand(refreshed, { type: "refresh-source", source: part() })).toThrow(/same source/);
});
