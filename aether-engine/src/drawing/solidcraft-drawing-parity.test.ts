import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import {
  addDocumentNote,
  createRectanglePartDocument,
  deleteDocumentNote,
  listDocumentNotes,
  updateDocumentNote,
  validatePartDocument,
} from "../document/index";
import {
  applyDrawingCommand,
  applyDrawingTemplate,
  auditDrawing,
  buildDrawing,
  createDrawingDocument,
  createStandardDrawing,
  DRAWING_SHEET_TEMPLATES,
  drawingHitTest,
  drawingLineAt,
  exportDrawingDXF,
  exportDrawingPDF,
  exportDrawingSVG,
  extractProjectionSnapPoints,
  importModelDimensions,
  parseDrawingDocument,
  reorderDrawingSheets,
  repairDrawingAnnotation,
  serializeDrawingDocument,
  type DrawingProjector,
} from "./index";
import type { PartDrawingProjection } from "./projection";

/** Analytic rectangular plate with a centered circular hole (40×20 mm, hole R5 at (0,0)). */
const plateProjector: DrawingProjector = async () => ({
  orientation: "front",
  bodyIds: ["body-1"],
  bounds: [-20, -10, 20, 10],
  visible: [
    { kind: "line", start: [-20, -10], end: [20, -10] },
    { kind: "line", start: [20, -10], end: [20, 10] },
    { kind: "line", start: [20, 10], end: [-20, 10] },
    { kind: "line", start: [-20, 10], end: [-20, -10] },
    { kind: "circle", center: [0, 0], radius: 5 },
  ],
  hidden: [],
} satisfies PartDrawingProjection);

describe("SolidCraft 0.47 Parity — 3D Notes & 2D Drawings", () => {
  it("persists, updates, resolves, and deletes 3D DocumentNotes on PartDocument", () => {
    const part = createRectanglePartDocument("Bracket", { widthMillimeters: 40, heightMillimeters: 20, depthMillimeters: 10 });
    const added = addDocumentNote(part, {
      text: "Break all sharp edges 0.5 mm",
      positionMillimeters: [20, 10, 5],
      category: "pmi",
    });
    expect(added.note.id).toBe("note-1");
    validatePartDocument(added.document);
    expect(listDocumentNotes(added.document)).toHaveLength(1);

    const updated = updateDocumentNote(added.document, added.note.id, { resolved: true });
    expect(updated.notes?.[0].resolved).toBe(true);
    validatePartDocument(updated);

    const deleted = deleteDocumentNote(updated, added.note.id);
    expect(deleted.notes).toBeUndefined();
    validatePartDocument(deleted);
  });

  it("creates standard 4-view ISO/ANSI template drawings and imports model dimensions", async () => {
    expect(DRAWING_SHEET_TEMPLATES.length).toBeGreaterThanOrEqual(7);
    const part = createRectanglePartDocument("Plate", { widthMillimeters: 40, heightMillimeters: 20, depthMillimeters: 10 });
    let doc = createStandardDrawing(part, "iso-a3", 1);
    const sheetId = doc.activeSheetId;
    expect(doc.sheets[0].widthMm).toBe(420);
    expect(doc.sheets[0].projection).toBe("first_angle");
    expect(doc.sheets[0].views.map((v) => v.id)).toEqual(["view-front", "view-top", "view-right", "view-iso"]);

    doc = importModelDimensions(doc, sheetId, "view-front");
    expect(doc.sheets[0].annotations.some((a) => a.kind === "width")).toBe(true);
    expect(doc.sheets[0].annotations.some((a) => a.kind === "height")).toBe(true);

    // Apply ANSI B template and verify switch to third-angle projection
    doc = applyDrawingTemplate(doc, sheetId, "ansi-b");
    expect(doc.sheets[0].projection).toBe("third_angle");
    expect(doc.sheets[0].widthMm).toBeCloseTo(431.8, 2);

    const built = await buildDrawing(doc, plateProjector);
    const front = built.sheets[0].views.find((v) => v.view.id === "view-front")!;
    const snaps = extractProjectionSnapPoints(front);
    // 4 corners + 4 midpoints + 1 circle center = 9 snap points
    expect(snaps.filter((s) => s.kind === "endpoint")).toHaveLength(4);
    expect(snaps.filter((s) => s.kind === "midpoint")).toHaveLength(4);
    expect(snaps.filter((s) => s.kind === "center")).toHaveLength(1);
  });

  it("supports format-v6 tolerances, overrides, ordinate, GD&T, datum, surface texture, weld, hole/chamfer callouts, revision table, and exports SVG/DXF/PDF", async () => {
    const part = createRectanglePartDocument("Plate", { widthMillimeters: 40, heightMillimeters: 20, depthMillimeters: 10 });
    let doc = createDrawingDocument(part, "dwg-v6");
    const sheetId = doc.activeSheetId;
    doc = applyDrawingCommand(doc, {
      type: "add-view",
      sheetId,
      view: { id: "v1", name: "Front", orientation: "front", originMm: [100, 100], scale: 1, hiddenLines: true },
    });
    expect(doc.formatVersion).toBe(1);

    // Add all format-v6 annotations & tolerances
    doc = applyDrawingCommand(doc, {
      type: "update-sheet",
      sheetId,
      revisions: [{ rev: "A", description: "Initial release", date: "2026-11-22", author: "J.J." }],
      revisionTable: { originMm: [155, 15], widthMm: 120 },
    });
    expect(doc.formatVersion).toBe(6);

    const v6Annotations = [
      { id: "w-tol", kind: "width" as const, viewId: "v1", decimals: 2, positionMm: [100, 82] as [number, number], toleranceUpperMm: 0.1, toleranceLowerMm: -0.1, overrideText: "{value} REF" },
      { id: "ord-x", kind: "ordinate" as const, viewId: "v1", axis: "x" as const, datumMm: [80, 110] as [number, number], targetMm: [120, 110] as [number, number], decimals: 1, positionMm: [120, 125] as [number, number] },
      { id: "cl-1", kind: "centerline" as const, viewId: "v1", startMm: [100, 88] as [number, number], endMm: [100, 112] as [number, number], positionMm: [100, 100] as [number, number] },
      { id: "ln-1", kind: "leader-note" as const, viewId: "v1", text: "{{part}} REV {{rev}}", leaderPointsMm: [[120, 90] as [number, number]], positionMm: [138, 78] as [number, number] },
      { id: "hc-1", kind: "hole-callout" as const, viewId: "v1", atMm: [105, 100] as [number, number], decimals: 1, positionMm: [130, 105] as [number, number] },
      { id: "ch-1", kind: "chamfer-note" as const, viewId: "v1", atMm: [80, 90] as [number, number], positionMm: [60, 80] as [number, number], text: "2X 1.5 x 45 DEG" },
      { id: "gdt-1", kind: "gdt" as const, viewId: "v1", characteristic: "position" as const, tolerance: "0.05", datums: ["A", "B"], positionMm: [135, 120] as [number, number], leaderMm: [100, 100] as [number, number] },
      { id: "dat-a", kind: "datum" as const, viewId: "v1", label: "A", positionMm: [100, 122] as [number, number], leaderMm: [100, 110] as [number, number] },
      { id: "surf-1", kind: "surface-texture" as const, viewId: "v1", ra: "1.6", process: "machined" as const, positionMm: [70, 90] as [number, number], leaderMm: [80, 95] as [number, number] },
      { id: "weld-1", kind: "weld-symbol" as const, viewId: "v1", weldType: "fillet" as const, size: "3", allAround: true, positionMm: [140, 140] as [number, number], leaderMm: [120, 110] as [number, number] },
      { id: "rev-a", kind: "revision-tag" as const, revision: "A", positionMm: [150, 60] as [number, number] },
    ];
    for (const annotation of v6Annotations) {
      doc = applyDrawingCommand(doc, { type: "add-annotation", sheetId, annotation });
    }

    // Serialization round trip + older version rejection
    const json = serializeDrawingDocument(doc);
    expect(parseDrawingDocument(json)).toEqual(doc);
    expect(() => serializeDrawingDocument({ ...doc, formatVersion: 5 })).toThrow(/version 6/);

    const built = await buildDrawing(doc, plateProjector);
    const byId = new Map(built.sheets[0].annotations.map((a) => [a.id, a]));
    expect(byId.get("w-tol")?.text).toBe("40.00 REF +/-0.10");
    expect(byId.get("ord-x")?.valueMm).toBeCloseTo(40, 6);
    expect(byId.get("ln-1")?.text).toBe("Plate REV A");
    expect(byId.get("hc-1")?.text).toBe("DIA 10.0 THRU");
    expect(byId.get("gdt-1")?.text).toBe("POS | 0.05 | A | B");
    expect(byId.get("surf-1")?.text).toBe("Ra 1.6");
    expect(byId.get("weld-1")?.text).toBe("3 FILLET");
    expect(byId.get("rev-a")?.text).toBe("A");
    expect(built.sheets[0].revisionTable?.revisions).toHaveLength(1);

    // SVG, DXF, and PDF exports all succeed and include revision table & annotations
    const svg = exportDrawingSVG(built);
    expect(svg).toContain('data-layer="revision-table"');
    expect(svg).toContain("POS | 0.05 | A | B");
    expect(svg).toContain("DIA 10.0 THRU");

    const dxf = exportDrawingDXF(built);
    expect(dxf).toContain("REVISION_TABLE");
    expect(dxf).toContain("POS | 0.05 | A | B");

    const fontBytes = readFileSync(createRequire(import.meta.url).resolve("@aether/assets/fonts/noto-sans/NotoSans-Regular.ttf"));
    const pdf = await exportDrawingPDF(built, { fontBytes });
    expect(pdf.byteLength).toBeGreaterThan(1000);
  });

  it("supports hit-testing, line pick, audit, dangling tolerance + repair, and sheet reordering", async () => {
    const part = createRectanglePartDocument("Plate", { widthMillimeters: 40, heightMillimeters: 20, depthMillimeters: 10 });
    let doc = createDrawingDocument(part, "dwg-audit");
    const s1 = doc.activeSheetId;
    doc = applyDrawingCommand(doc, {
      type: "add-sheet",
      sheet: { id: "sheet-2", name: "Sheet 2", widthMm: 297, heightMm: 210, projection: "third_angle", views: [], annotations: [] },
    });
    doc = applyDrawingCommand(doc, { type: "reorder-sheets", sheetIds: ["sheet-2", s1] });
    expect(doc.sheets.map((s) => s.id)).toEqual(["sheet-2", s1]);
    doc = reorderDrawingSheets(doc, [s1, "sheet-2"]);
    expect(doc.sheets.map((s) => s.id)).toEqual([s1, "sheet-2"]);

    doc = applyDrawingCommand(doc, {
      type: "add-view",
      sheetId: s1,
      view: { id: "v1", name: "Front", orientation: "front", originMm: [100, 100], scale: 1, hiddenLines: true },
    });
    // Add a diameter dimension that deliberately misses the hole (far from circle at [100, 100], r=5)
    doc = applyDrawingCommand(doc, {
      type: "add-annotation",
      sheetId: s1,
      annotation: { id: "d1", kind: "diameter", viewId: "v1", decimals: 1, atMm: [160, 160], positionMm: [170, 160] },
    });

    // Strict build throws; allowDangling produces a dangling annotation flagged by auditDrawing
    await expect(buildDrawing(doc, plateProjector)).rejects.toThrow(/No circle or arc/);
    const builtDangling = await buildDrawing(doc, plateProjector, { allowDangling: true });
    expect(builtDangling.sheets[0].annotations[0].dangling).toBe(true);

    const audit = auditDrawing(builtDangling);
    expect(audit.ok).toBe(false);
    expect(audit.findings.some((f) => f.code === "dangling_annotation" && f.entityId === "d1")).toBe(true);

    // Hit-test the circle center snap and top edge line
    const hits = drawingHitTest(builtDangling, s1, [100, 100], 3);
    expect(hits.some((h) => h.kind === "snap" && h.viewId === "v1")).toBe(true);
    const lineHit = drawingLineAt(builtDangling, s1, [100, 90], 3);
    expect(lineHit?.kind).toBe("line");

    // Repair the dangling diameter attachment to the circle rim [105, 100]
    const repaired = repairDrawingAnnotation(doc, s1, "d1", { atMm: [105, 100] });
    const builtFixed = await buildDrawing(repaired, plateProjector);
    expect(builtFixed.sheets[0].annotations[0].dangling).toBeUndefined();
    expect(builtFixed.sheets[0].annotations[0].valueMm).toBeCloseTo(10, 6);
    expect(auditDrawing(builtFixed).ok).toBe(true);
  });
});
