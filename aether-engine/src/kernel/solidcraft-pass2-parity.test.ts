import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { initNodeKernel } from "./node-kernel";
import { evaluatePartDocument } from "./part-evaluator";
import { analyzePart } from "./analysis";
import { exportPart, exportPartOBJWithMTL } from "./export";
import { projectPartDrawing } from "./drawing-projection";
import {
  assignBodyMaterial,
  availableBodies,
  createEmptyPartDocument,
  createRectanglePartDocument,
  validatePartDocument,
  type PartFeature,
} from "../document/index";
import { rotateSketchContours, scaleSketchContours, type SketchDrawing } from "../sketch/index";
import { applyDrawingCommand, buildDrawing, createDrawingDocument } from "../drawing/index";

describe("SolidCraft 0.47 Parity Pass 2 — Sketch Transforms, Plastic Depth, Flat-Pattern Views, OBJ+MTL, Deflated 3MF & Mesh Inspect", () => {
  beforeAll(async () => {
    await initNodeKernel(readFileSync(new URL("../../node_modules/replicad-opencascadejs/src/replicad_single.wasm", import.meta.url)));
  }, 30_000);

  it("rotates and scales constrained sketches while adapting horizontal/vertical and driving dimensions", () => {
    const rect: SketchDrawing = {
      type: "drawing",
      contours: [
        {
          type: "path",
          start: [0, 0],
          segments: [
            { type: "line", end: [20, 0] },
            { type: "line", end: [20, 10] },
            { type: "line", end: [0, 10] },
            { type: "line", end: [0, 0] },
          ],
        },
      ],
      constraints: [
        { id: "h0", kind: "horizontal", a: { contour: 0, kind: "line", index: 0 } },
        { id: "v1", kind: "vertical", a: { contour: 0, kind: "line", index: 1 } },
        { id: "d0", kind: "length", a: { contour: 0, kind: "line", index: 0 }, value: 20 },
      ],
    };

    // 90° rotation swaps horizontal <-> vertical and keeps distance=20 intact!
    const rot90 = rotateSketchContours(rect, [0], [0, 0], 90);
    expect(rot90.adaptedConstraints).toBe(2);
    expect(rot90.droppedConstraints).toBe(0);
    expect(rot90.drawing.constraints?.find((c) => c.id === "h0")?.kind).toBe("vertical");
    expect(rot90.drawing.constraints?.find((c) => c.id === "v1")?.kind).toBe("horizontal");
    expect(rot90.drawing.constraints?.find((c) => c.id === "d0")?.value).toBe(20);

    // 45° oblique rotation drops axis locks cleanly instead of failing, keeping distance=20
    const rot45 = rotateSketchContours(rect, [0], [0, 0], 45);
    expect(rot45.droppedConstraints).toBe(2);
    expect(rot45.drawing.constraints?.map((c) => c.id)).toEqual(["d0"]);

    // 2× uniform scale scales distance 20 -> 40 while preserving horizontal & vertical
    const scaled = scaleSketchContours(rect, [0], [0, 0], 2);
    expect(scaled.scaledDimensions).toBe(1);
    expect(scaled.drawing.constraints?.find((c) => c.id === "d0")?.value).toBeCloseTo(40, 6);
    expect(scaled.drawing.constraints?.find((c) => c.id === "h0")?.kind).toBe("horizontal");
  });

  it("builds Boss with radial mounting ribs, hollow Rest, and Snap Fit with thickened base pedestal in OCCT", () => {
    const base = createRectanglePartDocument("Housing", { widthMillimeters: 80, heightMillimeters: 60, depthMillimeters: 6 });
    const bodyId = availableBodies(base)[0].id;
    const extrudeId = base.features[1].id;
    const topFace = { bodyId, sourceFeatureId: extrudeId, label: "Top", normal: [0, 0, 1] as [number, number, number] };

    // Plain boss vs ribbed boss: ribs must add positive exact volume
    const plainBossDoc = structuredClone(base);
    plainBossDoc.features.push({
      id: "boss-1", type: "boss", name: "Boss 1", suppressed: false,
      targetBodyId: bodyId, face: topFace, pointMillimeters: [-20, 0, 6],
      diameterMillimeters: 10, heightMillimeters: 12, holeDiameterMillimeters: 4, holeDepthMillimeters: 8,
    } as PartFeature);
    const ribbedBossDoc = structuredClone(plainBossDoc);
    (ribbedBossDoc.features[2] as any).ribs = { count: 4, thicknessMillimeters: 2, lengthMillimeters: 5, heightMillimeters: 8 };
    validatePartDocument(ribbedBossDoc);

    const vPlain = Number(analyzePart(plainBossDoc, { kind: "properties" }).measurements[0].volume_mm3);
    const vRibbed = Number(analyzePart(ribbedBossDoc, { kind: "properties" }).measurements[0].volume_mm3);
    expect(vRibbed).toBeGreaterThan(vPlain + 100);

    // Solid rest vs hollow rest: hollow rest must remove core volume
    const solidRest = structuredClone(base);
    solidRest.features.push({
      id: "rest-1", type: "rest", name: "Rest 1", suppressed: false,
      targetBodyId: bodyId, face: topFace, pointMillimeters: [0, 0, 6],
      widthMillimeters: 16, lengthMillimeters: 20, heightMillimeters: 8,
    } as PartFeature);
    const hollowRest = structuredClone(solidRest);
    (hollowRest.features[2] as any).wallThicknessMillimeters = 2;
    validatePartDocument(hollowRest);

    const vSolidRest = Number(analyzePart(solidRest, { kind: "properties" }).measurements[0].volume_mm3);
    const vHollowRest = Number(analyzePart(hollowRest, { kind: "properties" }).measurements[0].volume_mm3);
    expect(vHollowRest).toBeLessThan(vSolidRest - 200);

    // Snap fit with base pedestal adds extra root stiffness volume
    const plainSnap = structuredClone(base);
    plainSnap.features.push({
      id: "snap-1", type: "snap-fit", name: "Snap 1", suppressed: false,
      targetBodyId: bodyId, face: topFace, pointMillimeters: [20, 0, 6],
      hookDirectionMillimeters: [1, 0, 0], lengthMillimeters: 14, thicknessMillimeters: 2, widthMillimeters: 6,
      catchDepthMillimeters: 2, catchLengthMillimeters: 3,
    } as PartFeature);
    const baseSnap = structuredClone(plainSnap);
    (baseSnap.features[2] as any).baseHeightMillimeters = 3;
    validatePartDocument(baseSnap);

    const vSnap = Number(analyzePart(plainSnap, { kind: "properties" }).measurements[0].volume_mm3);
    const vBaseSnap = Number(analyzePart(baseSnap, { kind: "properties" }).measurements[0].volume_mm3);
    expect(vBaseSnap).toBeGreaterThan(vSnap + 5);
  });

  it("projects a sheet-metal flat-pattern DrawingView, exports OBJ+MTL & deflated 3MF, and runs mesh_inspect", async () => {
    // 1. Sheet metal flat pattern view in Drawing format v6
    const sheet = createEmptyPartDocument("BracketSheet");
    sheet.features.push(
      { id: "sk-base", type: "profile", name: "BaseSketch", plane: "XY", offsetMillimeters: 0, suppressed: false, profile: { type: "polygon", pointsMillimeters: [[0, 0], [50, 0], [50, 30], [0, 30]] } } as PartFeature,
      { id: "sb-1", type: "sheet-base", name: "BaseFlange", operation: "new", profileFeatureId: "sk-base", thicknessMillimeters: 2, bendRadiusMillimeters: 2, kFactor: 0.4, suppressed: false } as PartFeature,
    );
    let dwg = createDrawingDocument(sheet, "dwg-flat");
    dwg = applyDrawingCommand(dwg, {
      type: "add-view",
      sheetId: dwg.activeSheetId,
      view: { id: "v-flat", name: "Flat Pattern", orientation: "top", originMm: [140, 100], scale: 1, hiddenLines: true, flatPattern: true },
    });
    expect(dwg.formatVersion).toBe(6);
    const built = await buildDrawing(dwg, async (src, opts) => projectPartDrawing(src, opts));
    const flatView = built.sheets[0].views[0];
    expect(flatView.geometry.visible.length).toBeGreaterThanOrEqual(4);
    expect(flatView.geometry.bounds[2] - flatView.geometry.bounds[0]).toBeCloseTo(50, 1);

    // 2. OBJ+MTL export with assigned physical material color + compressed 3MF + mesh_inspect
    let block = createRectanglePartDocument("Block", { widthMillimeters: 20, heightMillimeters: 20, depthMillimeters: 20 });
    const bId = availableBodies(block)[0].id;
    block = assignBodyMaterial(block, bId, "copper-c110");
    evaluatePartDocument(block);

    const objMtl = exportPartOBJWithMTL(block, { mtlFileName: "block.mtl" });
    expect(objMtl.obj).toContain("mtllib block.mtl");
    expect(objMtl.obj).toContain("usemtl Copper");
    expect(objMtl.mtl).toContain("newmtl Copper");

    const exported3mf = await exportPart(block, { format: "3mf" });
    expect(exported3mf.bytes.byteLength).toBeGreaterThan(100);
    // ZIP local header magic PK\x03\x04
    const magic = new DataView(exported3mf.bytes).getUint32(0, true);
    expect(magic).toBe(0x04034b50);

    const meshReport = analyzePart(block, { kind: "mesh_inspect" }).measurements[0] as any;
    expect(meshReport.watertight).toBe(true);
    expect(meshReport.triangle_count).toBeGreaterThanOrEqual(12);
    expect(meshReport.signed_volume_mm3).toBeCloseTo(8000, 1);
    expect(meshReport.surface_area_mm2).toBeCloseTo(2400, 1);
  });
});
