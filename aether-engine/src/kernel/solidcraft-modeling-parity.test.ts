import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { initNodeKernel } from "./node-kernel";
import { evaluatePartDocument } from "./part-evaluator";
import { exportPart } from "./export";
import { exportCurrentViewDXF } from "./view-dxf";
import { extractSheetFlatPattern, sheetFlatPatternToDXF } from "./features/sheet-metal-flat";
import { analyzePart } from "./analysis";
import {
  createEmptyPartDocument,
  resolveAxisLine,
  resolvePlaneFrame,
  FRAME_PROFILE_LIBRARY,
  SHEET_METAL_RULE_LIBRARY,
  frameCutList,
  frameCutListCSV,
  type ConstructionAxisFeature,
  type ConstructionPlaneFeature,
  type PartDocument,
} from "../document";

beforeAll(async () => {
  await initNodeKernel(readFileSync(new URL("../../node_modules/replicad-opencascadejs/src/replicad_single.wasm", import.meta.url)));
}, 60_000);

const bodyVolume = (doc: PartDocument, index = 0): number => {
  const res = analyzePart(doc, { kind: "properties" });
  return Number(res.measurements[index]?.volume_mm3);
};

describe("SolidCraft 0.47 CAD modeling parity", () => {
  it("patterns a hole feature without rejecting source.type === 'hole'", () => {
    const doc = createEmptyPartDocument("PatternHole");
    const bodyId = `${doc.documentId}:body-1`;
    doc.features.push(
      {
        id: "plate-sk",
        type: "profile",
        name: "Plate Sketch",
        plane: "XY",
        offsetMillimeters: 0,
        suppressed: false,
        profile: { type: "polygon", pointsMillimeters: [[0, 0], [80, 0], [80, 30], [0, 30]] },
      },
      {
        id: "plate",
        type: "extrude",
        name: "Plate",
        profileFeatureId: "plate-sk",
        distanceMillimeters: 10,
        operation: "new",
        suppressed: false,
      },
      {
        id: "hole1",
        type: "hole",
        name: "Hole 1",
        placement: {
          kind: "face-point",
          face: { sourceFeatureId: "plate", bodyId, normal: [0, 0, 1], label: "Top" },
          pointMillimeters: [15, 15, 10],
        },
        diameterMillimeters: 6,
        depthMillimeters: 10,
        depthType: "through-all",
        cutType: "plain",
        targetBodyId: bodyId,
        suppressed: false,
      } as never,
      {
        id: "pat1",
        type: "pattern",
        name: "Hole Pattern",
        patternType: "linear",
        sourceFeatureId: "hole1",
        targetBodyId: bodyId,
        axis: "X",
        count: 3,
        reversed: false,
        spacingMillimeters: 20,
        suppressed: false,
      } as never,
    );
    // Analytic volume: 80*30*10 - 3 * pi * 3^2 * 10 = 24000 - 848.23 = 23151.77 mm^3
    const expected = 80 * 30 * 10 - 3 * Math.PI * 9 * 10;
    expect(bodyVolume(doc, 0)).toBeCloseTo(expected, 0);
  });

  it("sweeps a pipe along a 3D circular arc path (curve3d.kind === 'arc')", () => {
    const doc = createEmptyPartDocument("Arc3DPipe");
    doc.features.push(
      {
        id: "arc3d",
        type: "curve3d",
        name: "3D Bend",
        kind: "arc",
        pointsMillimeters: [[0, 0, 0], [10, 0, 10], [20, 0, 0]],
        suppressed: false,
      },
      {
        id: "pipe1",
        type: "pipe",
        name: "Elbow Pipe",
        pathFeatureId: "arc3d",
        diameterMillimeters: 4,
        operation: "new",
        suppressed: false,
      },
    );
    // Semicircle of radius 10 => path length pi * 10; pipe radius 2 => volume pi * 4 * pi * 10 ≈ 394.78 mm^3
    expect(bodyVolume(doc, 0)).toBeCloseTo(Math.PI * 4 * Math.PI * 10, 0);
  });

  it("builds a real modelled external helical thread on a cylindrical shaft", () => {
    const doc = createEmptyPartDocument("ModeledBolt");
    const bodyId = `${doc.documentId}:body-1`;
    doc.features.push(
      {
        id: "sk",
        type: "profile",
        name: "Shaft Sketch",
        plane: "XY",
        offsetMillimeters: 0,
        suppressed: false,
        profile: { type: "circle", centerMillimeters: [0, 0], radiusMillimeters: 4 },
      },
      {
        id: "shaft",
        type: "extrude",
        name: "Shaft",
        profileFeatureId: "sk",
        distanceMillimeters: 16,
        operation: "new",
        suppressed: false,
      },
    );
    const volBefore = bodyVolume(doc, 0);

    doc.features.push({
      id: "th1",
      type: "thread",
      name: "M8 External",
      face: { sourceFeatureId: "shaft", bodyId, surfaceType: "cylinder", label: "Cylinder" },
      designation: "M8",
      lengthMillimeters: 10,
      modeled: true,
      form: "v60",
      starts: 1,
      targetBodyId: bodyId,
      suppressed: false,
    });
    const volAfter = bodyVolume(doc, 0);
    expect(volAfter).toBeGreaterThan(0);
    expect(volAfter).toBeLessThan(volBefore - 20); // helical groove removed real material!
  });

  it("embosses and debosses a sketch profile onto a planar face", () => {
    const doc = createEmptyPartDocument("EmbossPlate");
    const bodyId = `${doc.documentId}:body-1`;
    doc.features.push(
      {
        id: "base-sk",
        type: "profile",
        name: "Base",
        plane: "XY",
        offsetMillimeters: 0,
        suppressed: false,
        profile: { type: "polygon", pointsMillimeters: [[0, 0], [40, 0], [40, 40], [0, 40]] },
      },
      {
        id: "base",
        type: "extrude",
        name: "Plate",
        profileFeatureId: "base-sk",
        distanceMillimeters: 10,
        operation: "new",
        suppressed: false,
      },
      {
        id: "logo-sk",
        type: "profile",
        name: "Boss Circle",
        plane: "XY",
        offsetMillimeters: 10,
        suppressed: false,
        profile: { type: "circle", centerMillimeters: [20, 20], radiusMillimeters: 5 },
      },
      {
        id: "emb",
        type: "emboss",
        name: "Raised Emblem",
        profileFeatureId: "logo-sk",
        face: { sourceFeatureId: "base", bodyId, normal: [0, 0, 1], label: "Top" },
        mode: "emboss",
        depthMillimeters: 2,
        suppressed: false,
      },
    );
    // Volume = 40*40*10 + pi*5^2*2 = 16000 + 157.08 = 16157.08 mm^3
    expect(bodyVolume(doc, 0)).toBeCloseTo(16000 + Math.PI * 25 * 2, 0);
  });

  it("builds structural frame members, end caps, cut list, and 6-side bounding solid", () => {
    expect(FRAME_PROFILE_LIBRARY.length).toBeGreaterThanOrEqual(12);
    expect(SHEET_METAL_RULE_LIBRARY.length).toBeGreaterThanOrEqual(6);

    const doc = createEmptyPartDocument("SteelFrame");
    doc.features.push(
      {
        id: "beam1",
        type: "frame-member",
        name: "Rail",
        operation: "new",
        profileId: "shs-40x40x3",
        segmentsMillimeters: [[[0, 0, 0], [200, 0, 0]]],
        suppressed: false,
      },
      {
        id: "cap1",
        type: "frame-end-cap",
        name: "End Caps",
        operation: "add",
        frameFeatureId: "beam1",
        end: "both",
        thicknessMillimeters: 3,
        suppressed: false,
      },
      {
        id: "bbox",
        type: "bounding-solid",
        name: "Envelope",
        operation: "new",
        marginMillimeters: 0,
        marginsMillimeters: [1, 2, 3, 4, 5, 6],
        suppressed: false,
      },
    );
    // SHS 40x40x3 area = 40^2 - 34^2 = 444 mm^2; length 200 => 88800 mm^3 + two 40x40x3 caps (9600 mm^3) = 98400 mm^3
    expect(bodyVolume(doc, 0)).toBeCloseTo(444 * 200 + 2 * 40 * 40 * 3, -1);
    // Bounding solid around 206 x 40 x 40 with margins [1,2, 3,4, 5,6] => (206+3)*(40+7)*(40+11) = 209*47*51 = 500973 mm^3
    expect(bodyVolume(doc, 1)).toBeCloseTo(209 * 47 * 51, -1);

    const cutRows = frameCutList(doc.features);
    expect(cutRows).toHaveLength(1);
    expect(cutRows[0].lengthMillimeters).toBe(200);
    expect(frameCutListCSV(cutRows)).toContain("SHS 40×40×3");
  });

  it("resolves new construction plane/axis methods and exports current-view DXF + ASCII STL + flat-pattern DXF", async () => {
    const p1: ConstructionPlaneFeature = {
      id: "p-sq",
      name: "Square",
      type: "plane",
      plane: "XY",
      offsetMillimeters: 0,
      suppressed: false,
      definition: {
        method: "square-to-line",
        axis: { kind: "axis", partId: "b", candidateId: "e", originMillimeters: [0, 0, 0], directionMillimeters: [1, 0, 0] },
        point: { kind: "point", partId: "b", candidateId: "v", positionMillimeters: [10, 5, 2] },
      },
    };
    const sqFrame = resolvePlaneFrame(p1);
    expect(sqFrame.originMillimeters).toEqual([10, 5, 2]);
    expect(sqFrame.normal).toEqual([1, 0, 0]);

    const pBisect: ConstructionPlaneFeature = {
      id: "p-mid",
      name: "Bisector",
      type: "plane",
      plane: "XY",
      offsetMillimeters: 0,
      suppressed: false,
      definition: {
        method: "mid",
        references: [{ kind: "principal", plane: "XY" }, { kind: "principal", plane: "YZ" }],
      },
    };
    const midFrame = resolvePlaneFrame(pBisect);
    expect(midFrame.normal[0]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(midFrame.normal[2]).toBeCloseTo(Math.SQRT1_2, 6);

    const cylAxis: ConstructionAxisFeature = {
      id: "ax-cyl",
      name: "Cylinder Axis",
      type: "axis",
      suppressed: false,
      definition: { method: "through-cylinder", originMillimeters: [5, 5, 0], directionMillimeters: [0, 0, 2] },
    };
    expect(resolveAxisLine(cylAxis).directionMillimeters).toEqual([0, 0, 1]);

    const doc: PartDocument = createEmptyPartDocument("DXFTest");
    doc.features.push(
      { id: "sk", type: "profile", name: "Sk", plane: "XY", offsetMillimeters: 0, suppressed: false, profile: { type: "polygon", pointsMillimeters: [[0, 0], [30, 0], [30, 20], [0, 20]] } },
      { id: "sb", type: "sheet-base", name: "Sheet", profileFeatureId: "sk", thicknessMillimeters: 1.5, bendRadiusMillimeters: 1.5, kFactor: 0.44, operation: "new", suppressed: false },
    );
    const viewDxf = exportCurrentViewDXF(doc, { viewNormal: [1, -1, 1], hiddenEdges: "dashed", zero: "center" });
    expect(viewDxf.visibleSegments).toBeGreaterThan(4);
    expect(viewDxf.dxf).toContain("VISIBLE");
    expect(viewDxf.dxf).toContain("HIDDEN");

    const stlAscii = await exportPart(doc, { format: "stl", ascii: true });
    const stlText = new TextDecoder().decode(stlAscii.bytes);
    expect(stlText.startsWith("solid aether")).toBe(true);

    let flatShape: import("replicad").Shape3D | undefined;
    evaluatePartDocument(doc, { withBodies: (bodies) => { flatShape = [...bodies.values()][0]?.clone(); } });
    const fp = extractSheetFlatPattern(doc, `${doc.documentId}:body-1`, flatShape!, doc.features[1] as never);
    flatShape?.delete();
    expect(fp.widthMillimeters).toBeCloseTo(30, 1);
    expect(fp.heightMillimeters).toBeCloseTo(20, 1);
    expect(sheetFlatPatternToDXF(fp)).toContain("BEND_UP");
  });
});
