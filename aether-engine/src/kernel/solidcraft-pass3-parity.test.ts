import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { initNodeKernel } from "./node-kernel";
import { evaluatePartDocument } from "./part-evaluator";
import { analyzePart } from "./analysis";
import { extractSheetFlatPattern, sheetFlatPatternToDXF } from "./features/sheet-metal-flat";
import {
  assignSheetMetalRule,
  createEmptyPartDocument,
  createRectanglePartDocument,
  exportPartScript,
  insertFeature,
  setSheetMetalRule,
  sheetMetalRuleFor,
  validatePartDocument,
  type PartDocument,
  type ProfileFeature,
} from "../document/index";

beforeAll(async () => {
  await initNodeKernel(readFileSync(new URL("../../node_modules/replicad-opencascadejs/src/replicad_single.wasm", import.meta.url)));
}, 60_000);

function rectProfile(id: string, name: string, plane: "XY" | "XZ" | "YZ", offset: number, w: number, h: number, cx = 0, cy = 0): ProfileFeature {
  const hw = w / 2, hh = h / 2;
  return {
    id,
    type: "profile",
    name,
    plane,
    offsetMillimeters: offset,
    suppressed: false,
    profile: {
      type: "drawing",
      contours: [{
        type: "path",
        id: `${id}-rect`,
        start: [cx - hw, cy - hh],
        segments: [
          { type: "line", end: [cx + hw, cy - hh] },
          { type: "line", end: [cx + hw, cy + hh] },
          { type: "line", end: [cx - hw, cy + hh] },
          { type: "line", end: [cx - hw, cy - hh] },
        ],
      }],
    },
  };
}

function circleProfile(id: string, name: string, plane: "XY" | "XZ" | "YZ", offset: number, radius: number, cx = 0, cy = 0): ProfileFeature {
  return {
    id,
    type: "profile",
    name,
    plane,
    offsetMillimeters: offset,
    suppressed: false,
    profile: {
      type: "drawing",
      contours: [{
        type: "circle",
        id: `${id}-circle`,
        center: [cx, cy],
        radius,
      }],
    },
  };
}

describe("SolidCraft 0.47 Pass 3 parity — primitives, G2 fillet, surface, sheet metal, framing, loft rails, inspection", () => {
  it("builds exact solid primitives (box, cylinder, sphere, cone/frustum, torus) and boolean cut", async () => {
    let doc = createEmptyPartDocument("Primitives");
    doc = insertFeature(doc, {
      id: "p-box", type: "primitive", name: "Box", suppressed: false, operation: "new",
      kind: "box", widthMillimeters: 20, depthMillimeters: 10, heightMillimeters: 5, centered: true,
    });
    doc = insertFeature(doc, {
      id: "p-cyl", type: "primitive", name: "Cylinder", suppressed: false, operation: "new",
      kind: "cylinder", radiusMillimeters: 5, heightMillimeters: 10, originMillimeters: [40, 0, 0],
    });
    doc = insertFeature(doc, {
      id: "p-sph", type: "primitive", name: "Sphere", suppressed: false, operation: "new",
      kind: "sphere", radiusMillimeters: 6, originMillimeters: [80, 0, 0],
    });
    doc = insertFeature(doc, {
      id: "p-cone", type: "primitive", name: "Frustum", suppressed: false, operation: "new",
      kind: "cone", bottomRadiusMillimeters: 6, topRadiusMillimeters: 3, heightMillimeters: 10, originMillimeters: [120, 0, 0],
    });
    doc = insertFeature(doc, {
      id: "p-torus", type: "primitive", name: "Torus", suppressed: false, operation: "new",
      kind: "torus", majorRadiusMillimeters: 10, minorRadiusMillimeters: 2, originMillimeters: [160, 0, 0],
    });
    // Cut a cylinder bore through the center of the box
    doc = insertFeature(doc, {
      id: "p-cut", type: "primitive", name: "Bore Cut", suppressed: false, operation: "cut",
      targetBodyId: `${doc.documentId}:body-1`,
      kind: "cylinder", radiusMillimeters: 2, heightMillimeters: 20, originMillimeters: [0, 0, -5],
    });

    const props = analyzePart(doc, { kind: "properties" });
    const byId = new Map(props.measurements.map((m) => [String(m.body_id), Number(m.volume_mm3)]));
    expect(byId.get(`${doc.documentId}:body-1`)!).toBeCloseTo(20 * 10 * 5 - Math.PI * 4 * 5, 1);
    expect(byId.get(`${doc.documentId}:body-p-cyl`)!).toBeCloseTo(Math.PI * 25 * 10, 1);
    expect(byId.get(`${doc.documentId}:body-p-sph`)!).toBeCloseTo((4 / 3) * Math.PI * 216, 1);
    expect(byId.get(`${doc.documentId}:body-p-cone`)!).toBeCloseTo((Math.PI * 10 / 3) * (36 + 18 + 9), 1);
    expect(byId.get(`${doc.documentId}:body-p-torus`)!).toBeCloseTo(2 * Math.PI * Math.PI * 10 * 4, 1);
  });

  it("applies G2 curvature-continuous fillet and setback radii cleanly", async () => {
    let doc = createEmptyPartDocument("G2 Fillet");
    doc = insertFeature(doc, {
      id: "box", type: "primitive", name: "Block", suppressed: false, operation: "new",
      kind: "box", widthMillimeters: 20, depthMillimeters: 20, heightMillimeters: 20, centered: false,
    });
    const baseEval = evaluatePartDocument(doc);
    const bodyId = baseEval.parts[0].id;
    doc = insertFeature(doc, {
      id: "fillet-g2", type: "fillet", name: "G2 Fillet", suppressed: false,
      targetBodyId: bodyId,
      radiusMillimeters: 2.5,
      continuity: "g2",
      setbacks: [{ vertexMillimeters: [20, 20, 20], distanceMillimeters: 4 }],
    });
    const props = analyzePart(doc, { kind: "properties" });
    const vol = Number(props.measurements[0].volume_mm3);
    expect(vol).toBeGreaterThan(6000);
    expect(vol).toBeLessThan(8000);
  });

  it("builds surface blend (G1/G2), surface match (G1), surface fillet, and body-tool surface trim", () => {
    let doc = createEmptyPartDocument("Advanced Surfaces");
    // Two offset sheets extruded normal to YZ (along -X and +X) so blend & match bridge the gap between x=0 and x=10.
    doc = insertFeature(doc, {
      id: "sk-a", type: "profile", name: "Line A", plane: "YZ", offsetMillimeters: 0, suppressed: false,
      profile: { type: "drawing", contours: [{ type: "path", id: "la", start: [0, 0], segments: [{ type: "line", end: [20, 0] }] }] },
    });
    doc = insertFeature(doc, {
      id: "sh-a", type: "surface-extrude", name: "Sheet A", suppressed: false, operation: "new",
      profileFeatureId: "sk-a", distanceMillimeters: 15, reversed: true,
    });
    doc = insertFeature(doc, {
      id: "sk-b", type: "profile", name: "Line B", plane: "YZ", offsetMillimeters: 10, suppressed: false,
      profile: { type: "drawing", contours: [{ type: "path", id: "lb", start: [0, 4], segments: [{ type: "line", end: [20, 4] }] }] },
    });
    doc = insertFeature(doc, {
      id: "sh-b", type: "surface-extrude", name: "Sheet B", suppressed: false, operation: "new",
      profileFeatureId: "sk-b", distanceMillimeters: 15,
    });

    const before = evaluatePartDocument(doc);
    const idA = before.parts[0].id;
    const idB = before.parts[1].id;
    const edgeA = { kind: "curved-edge" as const, sourceFeatureId: "sh-a", bodyId: idA, label: "Edge A", midpointMillimeters: [0, 10, 0] as [number, number, number], lengthMillimeters: 20 };
    const edgeB = { kind: "curved-edge" as const, sourceFeatureId: "sh-b", bodyId: idB, label: "Edge B", midpointMillimeters: [10, 10, 4] as [number, number, number], lengthMillimeters: 20 };

    // 1. G1 Blend surface
    const withBlend = insertFeature(doc, {
      id: "blend-g1", type: "surface-blend", name: "G1 Blend", suppressed: false, operation: "new",
      from: { bodyId: idA, edges: [edgeA] },
      to: { bodyId: idB, edges: [edgeB] },
      continuity: "g1",
    });
    const blendRes = evaluatePartDocument(withBlend);
    expect(blendRes.parts.length).toBe(3);

    // 2. Surface Match (deform Sheet A edge to meet Sheet B edge with G1 continuity)
    const withMatch = insertFeature(doc, {
      id: "match-g1", type: "surface-match", name: "Match G1", suppressed: false,
      bodyIds: [idA], sourceEdges: [edgeA], targetBodyId: idB, targetEdges: [edgeB], continuity: "g1",
    });
    const matchRes = evaluatePartDocument(withMatch);
    const matchedVerts = matchRes.parts.find((p) => p.id === idA)!.vertices;
    let maxX = -Infinity;
    for (let i = 0; i < matchedVerts.length; i += 3) maxX = Math.max(maxX, matchedVerts[i]);
    expect(maxX).toBeCloseTo(10, 1);

    // 3. Surface Fillet across two touching perpendicular sheets sharing the X-axis edge [0..20, 0, 0]
    let filletDoc = createEmptyPartDocument("Surface Fillet");
    filletDoc = insertFeature(filletDoc, {
      id: "sk1", type: "profile", name: "S1", plane: "XZ", offsetMillimeters: 0, suppressed: false,
      profile: { type: "drawing", contours: [{ type: "path", id: "c1", start: [0, 0], segments: [{ type: "line", end: [20, 0] }] }] },
    });
    filletDoc = insertFeature(filletDoc, {
      id: "f1", type: "surface-extrude", name: "Floor", suppressed: false, operation: "new",
      profileFeatureId: "sk1", distanceMillimeters: 20,
    });
    filletDoc = insertFeature(filletDoc, {
      id: "sk2", type: "profile", name: "S2", plane: "XY", offsetMillimeters: 0, suppressed: false,
      profile: { type: "drawing", contours: [{ type: "path", id: "c2", start: [0, 0], segments: [{ type: "line", end: [20, 0] }] }] },
    });
    filletDoc = insertFeature(filletDoc, {
      id: "f2", type: "surface-extrude", name: "Wall", suppressed: false, operation: "new",
      profileFeatureId: "sk2", distanceMillimeters: 20,
    });
    const fEval = evaluatePartDocument(filletDoc);
    filletDoc = insertFeature(filletDoc, {
      id: "sf", type: "surface-fillet", name: "Sheet Fillet", suppressed: false, operation: "new",
      bodyIds: [fEval.parts[0].id, fEval.parts[1].id],
      radiusMillimeters: 3,
    });
    const sfRes = evaluatePartDocument(filletDoc);
    expect(sfRes.parts.length).toBe(3);
    expect(sfRes.parts[2].topology.length).toBeGreaterThanOrEqual(3); // 2 planar + 1 cylindrical fillet face

    // 4. Surface Trim by another surface body (`toolBodyId`)
    let trimDoc = createEmptyPartDocument("Body Trim");
    trimDoc = insertFeature(trimDoc, rectProfile("sk-sheet", "Sheet", "XY", 0, 40, 20));
    trimDoc = insertFeature(trimDoc, { id: "patch", type: "surface-patch", name: "Patch", suppressed: false, operation: "new", profileFeatureId: "sk-sheet" });
    trimDoc = insertFeature(trimDoc, {
      id: "sk-cut", type: "profile", name: "Cutter Line", plane: "XY", offsetMillimeters: -5, suppressed: false,
      profile: { type: "drawing", contours: [{ type: "path", id: "lc", start: [0, -20], segments: [{ type: "line", end: [0, 20] }] }] },
    });
    trimDoc = insertFeature(trimDoc, { id: "cutter", type: "surface-extrude", name: "Cutter Sheet", suppressed: false, operation: "new", profileFeatureId: "sk-cut", distanceMillimeters: 10 });
    const tEval = evaluatePartDocument(trimDoc);
    trimDoc = insertFeature(trimDoc, {
      id: "trim-body", type: "surface-trim", name: "Trim by Sheet", suppressed: false,
      bodyIds: [tEval.parts[0].id],
      toolBodyId: tEval.parts[1].id,
      keepPointMillimeters: [10, 0, 0],
    });
    const trimmed = evaluatePartDocument(trimDoc);
    const trimmedPart = trimmed.parts.find((p) => p.id === tEval.parts[0].id)!;
    let minX = Infinity;
    for (let i = 0; i < trimmedPart.vertices.length; i += 3) minX = Math.min(minX, trimmedPart.vertices[i]);
    expect(minX).toBeGreaterThanOrEqual(-0.05);
  });

  it("supports sheet metal rules table, sheet-convert, sheet-path-flange, fold unfold, and layered flat DXF", () => {
    // 1. Sheet Metal Rules table persistence
    let ruleDoc = createEmptyPartDocument("Rules");
    ruleDoc = setSheetMetalRule(ruleDoc, { id: "custom-al-2", name: "Alu 2mm Custom", material: "Aluminum 6061", densityKgPerM3: 2700, thicknessMillimeters: 2, bendRadiusMillimeters: 2.5, kFactor: 0.42 });
    ruleDoc = assignSheetMetalRule(ruleDoc, ["body-1"], "custom-al-2");
    validatePartDocument(ruleDoc);
    expect(sheetMetalRuleFor(ruleDoc, "body-1")?.kFactor).toBe(0.42);

    // 2. Convert a plain extruded plate to sheet metal (auto-measuring thickness = 2 mm), then add flange & contour flange & unfold
    let doc = createRectanglePartDocument("Converted Sheet", { widthMillimeters: 60, heightMillimeters: 40, depthMillimeters: 2 });
    const init = evaluatePartDocument(doc);
    const bodyId = init.parts[0].id;
    doc = insertFeature(doc, {
      id: "conv", type: "sheet-convert", name: "Convert Sheet", suppressed: false,
      bodyIds: [bodyId], bendRadiusMillimeters: 2, kFactor: 0.44,
    });
    // Add a flange on the +X edge (x=30, y from -20 to 20, z=2)
    doc = insertFeature(doc, {
      id: "flange-1", type: "sheet-flange", name: "Flange 1", suppressed: false,
      bodyIds: [bodyId],
      edges: [{ kind: "curved-edge", sourceFeatureId: doc.features[1].id, bodyId, label: "+X Top", midpointMillimeters: [30, 0, 2], lengthMillimeters: 40 }],
      distanceMillimeters: 15, angleDegrees: 90, inward: true,
    });
    // Add an open L-profile contour flange on XZ plane extruded along width
    doc = insertFeature(doc, {
      id: "sk-contour", type: "profile", name: "Contour", plane: "XZ", offsetMillimeters: 0, suppressed: false,
      profile: {
        type: "drawing",
        contours: [{
          type: "path", id: "open-l", start: [-30, 2],
          segments: [{ type: "line", end: [-40, 2] }, { type: "line", end: [-40, 12] }],
        }],
      },
    });
    doc = insertFeature(doc, {
      id: "path-flange", type: "sheet-path-flange", name: "Contour Flange", suppressed: false,
      bodyIds: [bodyId], profileFeatureId: "sk-contour", widthMillimeters: 20,
    });
    const bentRes = evaluatePartDocument(doc);
    expect(bentRes.parts.length).toBe(1);

    // 3. Flat pattern with real OUTLINE, CUT (perforated hole), and BEND_UP layers
    let flatDoc = createEmptyPartDocument("Flat Layers");
    flatDoc = insertFeature(flatDoc, rectProfile("sk-base", "Base", "XY", 0, 80, 50));
    flatDoc = insertFeature(flatDoc, {
      id: "sb", type: "sheet-base", name: "Sheet Base", suppressed: false, operation: "new",
      profileFeatureId: "sk-base", thicknessMillimeters: 2, bendRadiusMillimeters: 2, kFactor: 0.44,
    });
    const sbEval = evaluatePartDocument(flatDoc);
    const sbId = sbEval.parts[0].id;
    flatDoc = insertFeature(flatDoc, {
      id: "perf", type: "sheet-perforate", name: "Holes", suppressed: false,
      bodyIds: [sbId],
      face: { sourceFeatureId: "sb", bodyId: sbId, label: "Top", normal: [0, 0, 1] },
      diameterMillimeters: 6, pitchMillimeters: 16, marginMillimeters: 10, pattern: "square",
    });
    flatDoc = insertFeature(flatDoc, {
      id: "fl", type: "sheet-flange", name: "Up Flange", suppressed: false,
      bodyIds: [sbId],
      edges: [{ kind: "curved-edge", sourceFeatureId: "sb", bodyId: sbId, label: "+X Top", midpointMillimeters: [40, 0, 2], lengthMillimeters: 50 }],
      distanceMillimeters: 15, angleDegrees: 90, inward: true,
    });
    flatDoc = insertFeature(flatDoc, { id: "unf", type: "sheet-unfold", name: "Unfold", suppressed: false, bodyIds: [sbId] });

    let flatShape: any;
    evaluatePartDocument(flatDoc, { withBodies: (map) => { flatShape = map.get(sbId)?.clone(); } });
    const pattern = extractSheetFlatPattern(flatDoc, sbId, flatShape, { thicknessMillimeters: 2, bendRadiusMillimeters: 2, kFactor: 0.44 }, [0, 0, 1]);
    flatShape.delete();
    expect(pattern.lines.some((l) => l.layer === "OUTLINE")).toBe(true);
    expect(pattern.lines.some((l) => l.layer === "CUT")).toBe(true);
    expect(pattern.lines.some((l) => l.layer === "BEND_UP")).toBe(true);
    const dxf = sheetFlatPatternToDXF(pattern);
    expect(dxf).toContain("CUT");
    expect(dxf).toContain("BEND_UP");
    expect(dxf).toContain("BEND_NOTES");
  });

  it("trims structural frame members (cope & miter) and builds exact frame gussets", async () => {
    let doc = createEmptyPartDocument("Weldment");
    doc = insertFeature(doc, {
      id: "m1", type: "frame-member", name: "Post", suppressed: false, operation: "new",
      profileId: "shs-20x20x2", segmentsMillimeters: [[[0, 0, 0], [0, 0, 100]]],
    });
    doc = insertFeature(doc, {
      id: "m2", type: "frame-member", name: "Beam", suppressed: false, operation: "new",
      profileId: "shs-20x20x2", segmentsMillimeters: [[[-10, 0, 50], [100, 0, 50]]],
    });
    const before = analyzePart(doc, { kind: "properties" });
    const postId = String(before.measurements[0].body_id);
    const beamId = String(before.measurements[1].body_id);
    const beamVolBefore = Number(before.measurements[1].volume_mm3);

    // Cope Beam against Post
    doc = insertFeature(doc, {
      id: "trim-cope", type: "frame-trim", name: "Cope Beam", suppressed: false,
      targetBodyIds: [beamId], toolBodyId: postId, mode: "cope", keepPointMillimeters: [60, 0, 50],
    });
    // Add right-triangle gusset with 5 mm weld chamfer: area = 0.5*40*40 - 0.5*5*5 = 787.5 mm², * 6 mm = 4725 mm³
    doc = insertFeature(doc, {
      id: "gusset-1", type: "frame-gusset", name: "Corner Gusset", suppressed: false, operation: "new",
      originMillimeters: [10, 0, 60], axisA: [1, 0, 0], axisB: [0, 0, 1],
      legAMillimeters: 40, legBMillimeters: 40, thicknessMillimeters: 6, chamferMillimeters: 5,
    });
    const after = analyzePart(doc, { kind: "properties" });
    const beamVolAfter = Number(after.measurements.find((m) => m.body_id === beamId)!.volume_mm3);
    const gussetVol = Number(after.measurements.find((m) => m.body_id === `${doc.documentId}:body-gusset-1`)!.volume_mm3);
    expect(beamVolAfter).toBeLessThan(beamVolBefore - 100);
    expect(gussetVol).toBeCloseTo(4725, 1);
  });

  it("lofts with curved guide rails changing the intermediate cross-section volume", async () => {
    let base = createEmptyPartDocument("Loft Rails");
    base = insertFeature(base, circleProfile("c1", "Bottom", "XY", 0, 10));
    base = insertFeature(base, circleProfile("c2", "Top", "XY", 30, 10));
    // Bowed-out 3D spline rail passing through (10,0,0) -> (18,0,15) -> (10,0,30)
    base = insertFeature(base, {
      id: "rail-1", type: "curve3d", name: "Bulge Rail", suppressed: false, kind: "spline",
      pointsMillimeters: [[10, 0, 0], [18, 0, 15], [10, 0, 30]],
    });

    const straightDoc = insertFeature(base, {
      id: "loft-straight", type: "loft", name: "Straight Loft", suppressed: false, operation: "new", ruled: false,
      sections: [{ profileFeatureId: "c1" }, { profileFeatureId: "c2" }],
    });
    const guidedDoc = insertFeature(base, {
      id: "loft-guided", type: "loft", name: "Guided Loft", suppressed: false, operation: "new", ruled: false,
      sections: [{ profileFeatureId: "c1" }, { profileFeatureId: "c2" }],
      guideRails: [{ pathFeatureId: "rail-1" }],
    });

    const straightVol = Number((analyzePart(straightDoc, { kind: "properties" })).measurements[0].volume_mm3);
    const guidedVol = Number((analyzePart(guidedDoc, { kind: "properties" })).measurements[0].volume_mm3);
    expect(straightVol).toBeCloseTo(Math.PI * 100 * 30, 0);
    expect(guidedVol).toBeGreaterThan(straightVol * 1.4);
  });

  it("computes silhouette projected area, continuity gap/tolerances, resilient single-face resize, and script export", async () => {
    let doc = createEmptyPartDocument("Inspection & Resilience");
    doc = insertFeature(doc, rectProfile("sk-base", "Base", "XY", 0, 20, 30));
    doc = insertFeature(doc, { id: "ex-base", type: "extrude", name: "Block", suppressed: false, operation: "new", profileFeatureId: "sk-base", distanceMillimeters: 10 });

    // 1. Silhouette along +Z -> 20x30 = 600 mm², along +Y -> 20x10 = 200 mm²
    const silZ = analyzePart(doc, { kind: "silhouette", direction: [0, 0, 1] });
    expect(Number(silZ.measurements[0].projected_area_mm2)).toBeCloseTo(600, 0);
    expect(Number(silZ.measurements[0].width_mm)).toBeCloseTo(20, 0);
    expect(Number(silZ.measurements[0].height_mm)).toBeCloseTo(30, 0);
    expect(silZ.curves!.length).toBeGreaterThan(0);

    const silY = analyzePart(doc, { kind: "silhouette", direction: [0, 1, 0] });
    expect(Number(silY.measurements[0].projected_area_mm2)).toBeCloseTo(200, 0);

    // 2. Continuity reports max_gap_mm and respects tolerances
    const cont = analyzePart(doc, { kind: "continuity", position_tol_mm: 1e-3, tangent_tol_deg: 0.5 });
    expect(cont.measurements.length).toBeGreaterThan(0);
    expect(Number(cont.measurements[0].max_gap_mm)).toBeLessThan(1e-4);

    // 3. Resilient face anchor: shell anchored to unique +Z face survives resizing base sketch from 20x30 to 40x30
    const bodyId = `${doc.documentId}:body-1`;
    const withShell = insertFeature(doc, {
      id: "sh", type: "shell", name: "Shell", suppressed: false, targetBodyId: bodyId, thicknessMillimeters: 2,
      removedFaces: [{ sourceFeatureId: "ex-base", bodyId, label: "Top", normal: [0, 0, 1], faceAnchor: { centerMillimeters: [0, 0, 10], areaSquareMillimeters: 600 } }],
    });
    const resized: PartDocument = {
      ...withShell,
      features: withShell.features.map((f) => (f.id === "sk-base" ? rectProfile("sk-base", "Base", "XY", 0, 40, 30) : f)),
    };
    const resizedProps = analyzePart(resized, { kind: "properties" });
    // Outer 40x30x10 = 12000, inner cavity 36x26x8 = 7488 -> shell volume = 4512 mm³
    expect(Number(resizedProps.measurements[0].volume_mm3)).toBeCloseTo(4512, 1);

    // 4. Parametric script export
    const script = exportPartScript(withShell);
    expect(script).toContain("export function buildPart(): PartDocument");
    expect(script).toContain('"type": "shell"');
    expect(script).toContain("validatePartDocument(doc);");
  });
});
