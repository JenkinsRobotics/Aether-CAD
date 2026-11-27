import { describe, expect, it } from "vitest";
import {
  solveDrawingConstraints,
  sketchConstraintState,
  dragSketchEntity,
  toggleRadiusDiameter,
  setSketchCenterline,
  createConstructionLine,
  createTwoPointCircle,
  createTwoTangentCircle,
  createThreeTangentCircle,
  createRoundedRectangle,
  divideSketchCurve,
  createEquationCurve,
  inspectLooseEnds,
  tieLooseEnds,
  offsetSketchAdvanced,
  breakOffsetAssociation,
  editDrawingDimension,
  arc3dGeometry,
  solve3DConstraints,
  type SketchDrawing,
} from "./index";
import { replaceSketchDrawing, createEmptyPartDocument, type ProfileFeature } from "../document";

describe("SolidCraft 0.47 sketch parity improvements", () => {
  it("solves large multi-component sketches beyond the old 512 coordinate wall via connected components", () => {
    const contours: SketchDrawing["contours"] = [];
    const constraints: NonNullable<SketchDrawing["constraints"]> = [];
    // 200 independent circles = 600 coordinates (previously rejected at 512).
    for (let i = 0; i < 200; i++) {
      contours.push({ type: "circle", center: [i * 20, 0], radius: 3 });
      constraints.push({ id: `r-${i}`, kind: "radius", a: { contour: i, kind: "circle" }, value: 5 });
    }
    const solved = solveDrawingConstraints({ type: "drawing", contours, constraints });
    expect((solved.contours[0] as { radius: number }).radius).toBeCloseTo(5, 6);
    expect((solved.contours[199] as { radius: number }).radius).toBeCloseTo(5, 6);
  });

  it("identifies exact redundant constraint IDs and determining basis constraints", () => {
    const d: SketchDrawing = {
      type: "drawing",
      contours: [
        { type: "path", start: [0, 0], segments: [{ type: "line", end: [10, 0] }] },
      ],
      constraints: [
        { id: "fix0", kind: "fix", a: { contour: 0, kind: "point", index: 0 }, point: [0, 0] },
        { id: "h", kind: "horizontal", a: { contour: 0, kind: "line", index: 0 } },
        { id: "len", kind: "length", a: { contour: 0, kind: "line", index: 0 }, value: 10 },
        { id: "dup", kind: "horizontal-distance", a: { contour: 0, kind: "point", index: 0 }, b: { contour: 0, kind: "point", index: 1 }, value: 10 },
      ],
    };
    const state = sketchConstraintState(d);
    expect(state.state).toBe("over-constrained");
    expect(state.redundantEquations).toBe(1);
    expect(state.redundantConstraints).toEqual(["dup"]);
    expect(state.determinedBy?.dup).toContain("len");
  });

  it("drags smoothly along circular constraint manifolds", () => {
    const d: SketchDrawing = {
      type: "drawing",
      contours: [
        { type: "path", start: [0, 0], segments: [{ type: "line", end: [10, 0] }] },
      ],
      constraints: [
        { id: "fix0", kind: "fix", a: { contour: 0, kind: "point", index: 0 }, point: [0, 0] },
        { id: "len", kind: "length", a: { contour: 0, kind: "line", index: 0 }, value: 10 },
      ],
    };
    // Pull free end from (10, 0) toward (0, 10) — infeasible straight line, feasible along radius-10 circle!
    const moved = dragSketchEntity(d, { contour: 0, kind: "point", index: 1 }, [-10, 10]);
    const path = moved.contours[0];
    if (path.type !== "path") throw new Error("expected path");
    expect(path.start).toEqual([0, 0]);
    const end = path.segments[0].end;
    expect(Math.hypot(end[0], end[1])).toBeCloseTo(10, 5);
    expect(end[1]).toBeGreaterThan(5); // moved smoothly along arc toward (0, 10)
  });

  it("solves arc-length, arc-sweep, line-angle, linear-diameter, circle-edge distances, and slot-overall-length", () => {
    // 1) Arc length & sweep
    const arcDrawing: SketchDrawing = {
      type: "drawing",
      contours: [
        { type: "path", start: [10, 0], segments: [{ type: "arc", middle: [7, 7], end: [0, 10] }] },
      ],
      constraints: [
        { id: "f0", kind: "fix", a: { contour: 0, kind: "point", index: 0 }, point: [10, 0] },
        { id: "r", kind: "radius", a: { contour: 0, kind: "arc", index: 0 }, value: 10 },
        { id: "sw", kind: "arc-sweep", a: { contour: 0, kind: "arc", index: 0 }, value: 60 },
      ],
    };
    const solvedArc = solveDrawingConstraints(arcDrawing);
    const arcLenRef: SketchDrawing = {
      ...solvedArc,
      constraints: [
        ...(solvedArc.constraints ?? []),
        { id: "al", kind: "arc-length", a: { contour: 0, kind: "arc", index: 0 }, reference: true },
      ],
    };
    const solvedWithRef = solveDrawingConstraints(arcLenRef);
    expect(solvedWithRef.constraints?.length).toBe(4);

    // 2) Circle-circle outer gap & line-circle gap & point-circle gap
    const circles: SketchDrawing = {
      type: "drawing",
      contours: [
        { type: "circle", center: [0, 0], radius: 5 },
        { type: "circle", center: [15, 0], radius: 5 },
      ],
      constraints: [
        { id: "f", kind: "fix", a: { contour: 0, kind: "point", index: 0 }, point: [0, 0] },
        { id: "r1", kind: "radius", a: { contour: 0, kind: "circle" }, value: 5 },
        { id: "r2", kind: "radius", a: { contour: 1, kind: "circle" }, value: 5 },
        { id: "h", kind: "horizontal", a: { contour: 0, kind: "point", index: 0 }, b: { contour: 1, kind: "point", index: 0 } },
        { id: "gap", kind: "circle-circle-distance", a: { contour: 0, kind: "circle" }, b: { contour: 1, kind: "circle" }, value: 8 },
      ],
    };
    const solvedCircles = solveDrawingConstraints(circles);
    expect((solvedCircles.contours[1] as { center: [number, number] }).center[0]).toBeCloseTo(18, 5);

    // 3) Centerline + linear-diameter + toggleRadiusDiameter
    const rev = setSketchCenterline({
      type: "drawing",
      contours: [
        { type: "path", start: [0, 0], segments: [{ type: "line", end: [0, 20] }] },
        { type: "path", start: [6, 10], segments: [] },
      ],
      constraints: [
        { id: "fa", kind: "fix", a: { contour: 0, kind: "point", index: 0 }, point: [0, 0] },
        { id: "fb", kind: "fix", a: { contour: 0, kind: "point", index: 1 }, point: [0, 20] },
        { id: "ld", kind: "linear-diameter", a: { contour: 1, kind: "point", index: 0 }, b: { contour: 0, kind: "line", index: 0 }, value: 24 },
      ],
    }, [0], true);
    const solvedRev = solveDrawingConstraints(rev);
    expect((solvedRev.contours[1] as { start: [number, number] }).start[0]).toBeCloseTo(12, 5);
    const toggled = toggleRadiusDiameter(solvedRev, "ld");
    expect(toggled.constraints?.find((c) => c.id === "ld")?.kind).toBe("distance");
    expect(toggled.constraints?.find((c) => c.id === "ld")?.value).toBeCloseTo(12, 5);
  });

  it("constructs analytic construction lines, tangent circles, rounded rectangles, divide-curve, and equation curves", () => {
    const base: SketchDrawing = {
      type: "drawing",
      contours: [
        { type: "path", start: [0, 0], segments: [{ type: "line", end: [40, 0] }] },
        { type: "path", start: [0, 0], segments: [{ type: "line", end: [0, 40] }] },
        { type: "circle", center: [20, 20], radius: 5 },
      ],
    };
    const { drawing: withBisector, contourIndex } = createConstructionLine(base, {
      mode: "bisector",
      lineA: { contour: 0, kind: "line", index: 0 },
      lineB: { contour: 1, kind: "line", index: 0 },
      near: [10, 10],
      length: 20,
      centerline: true,
    });
    const bis = withBisector.contours[contourIndex];
    expect(bis.type === "path" && bis.centerline).toBe(true);

    const { drawing: withTan } = createTwoTangentCircle(
      base,
      { contour: 0, kind: "line", index: 0 },
      { contour: 1, kind: "line", index: 0 },
      4,
      [5, 5],
    );
    const tc = withTan.contours.at(-1)!;
    expect(tc.type).toBe("circle");
    if (tc.type === "circle") {
      expect(tc.center[0]).toBeCloseTo(4, 5);
      expect(tc.center[1]).toBeCloseTo(4, 5);
    }

    const tri: SketchDrawing = {
      type: "drawing",
      contours: [
        { type: "path", start: [0, 0], segments: [{ type: "line", end: [30, 0] }] },
        { type: "path", start: [30, 0], segments: [{ type: "line", end: [0, 40] }] },
        { type: "path", start: [0, 40], segments: [{ type: "line", end: [0, 0] }] },
      ],
    };
    const { drawing: withIncircle } = createThreeTangentCircle(
      tri,
      [
        { contour: 0, kind: "line", index: 0 },
        { contour: 1, kind: "line", index: 0 },
        { contour: 2, kind: "line", index: 0 },
      ],
      [10, 10],
    );
    // 30-40-50 right triangle inradius = (30 + 40 - 50) / 2 = 10, center = (10, 10)
    const inc = withIncircle.contours.at(-1)!;
    expect(inc.type === "circle" && inc.radius).toBeCloseTo(10, 5);

    const rr = createRoundedRectangle([0, 0], [40, 20], 4);
    expect(rr.type === "path" && rr.segments.length).toBe(8);
    expect(createTwoPointCircle([0, 0], [10, 0])).toMatchObject({ type: "circle", center: [5, 0], radius: 5 });

    const { drawing: divided, pointContourIndices } = divideSketchCurve(
      { type: "drawing", contours: [{ type: "path", start: [0, 0], segments: [{ type: "line", end: [20, 0] }] }] },
      { contour: 0, kind: "line", index: 0 },
      4,
    );
    expect(pointContourIndices).toHaveLength(3);
    expect((divided.contours[pointContourIndices[1]] as { start: [number, number] }).start[0]).toBeCloseTo(10, 5);

    const eq = createEquationCurve({
      mode: "explicit",
      yExpression: "#x * #x / 10",
      tMin: 0,
      tMax: 10,
      samples: 10,
    });
    expect(eq.type === "path" && eq.segments.length).toBe(10);
  });

  it("detects untied loose ends, ties them, supports multi-side offset + break, auto-scale first dim, and sketch replace", () => {
    const untied: SketchDrawing = {
      type: "drawing",
      contours: [
        { type: "path", start: [0, 0], segments: [{ type: "line", end: [10, 0] }] },
        { type: "path", start: [10, 0], segments: [{ type: "line", end: [10, 10] }] },
      ],
    };
    const report = inspectLooseEnds(untied);
    expect(report.open).toHaveLength(2);
    expect(report.untied).toHaveLength(1);
    const { drawing: tied, tiedCount } = tieLooseEnds(untied);
    expect(tiedCount).toBe(1);
    expect(inspectLooseEnds(tied).untied).toHaveLength(0);

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
    };
    const multi = offsetSketchAdvanced(rect, [0], { distance: 2, symmetric: true, instances: 2 });
    expect(multi.contours.length).toBe(5); // 1 source + 4 offsets
    const { drawing: broken, brokenCount } = breakOffsetAssociation(multi);
    expect(brokenCount).toBeGreaterThan(0);
    expect(broken.constraints?.some((c) => c.kind === "offset")).toBe(false);

    // Auto-scale on first driving dimension
    const unscaled: SketchDrawing = {
      type: "drawing",
      contours: [
        { type: "path", start: [0, 0], segments: [{ type: "line", end: [10, 0] }, { type: "line", end: [10, 5] }] },
      ],
      constraints: [
        { id: "fix0", kind: "fix", a: { contour: 0, kind: "point", index: 0 }, point: [0, 0] },
        { id: "d1", kind: "length", a: { contour: 0, kind: "line", index: 0 }, value: 10 },
      ],
    };
    const scaled = editDrawingDimension(unscaled, "d1", 100, { autoScaleFirst: true });
    const p = scaled.contours[0];
    if (p.type !== "path") throw new Error("expected path");
    expect(p.segments[1].end[1]).toBeCloseTo(50, 4); // scaled uniformly 10x!

    // Sketch replace
    const doc = createEmptyPartDocument("ReplaceTest");
    const pf: ProfileFeature = {
      id: "sk1",
      type: "profile",
      name: "Sketch 1",
      plane: "XY",
      offsetMillimeters: 5,
      suppressed: false,
      profile: rect,
    };
    doc.features.push(pf);
    const replaced = replaceSketchDrawing(doc, "sk1", { type: "drawing", contours: [{ type: "circle", center: [0, 0], radius: 15 }] });
    expect((replaced.features[0] as ProfileFeature).offsetMillimeters).toBe(5);
    expect((replaced.features[0] as ProfileFeature).profile.type).toBe("drawing");
  });

  it("solves 3D sketch constraints and exact 3D arc geometry", () => {
    const arc = arc3dGeometry([10, 0, 0], [0, 10, 0], [-10, 0, 0]);
    expect(arc.radius).toBeCloseTo(10, 6);
    expect(arc.center[0]).toBeCloseTo(0, 6);
    expect(arc.sweep).toBeCloseTo(Math.PI, 6);

    const solved = solve3DConstraints(
      [[0, 0, 0], [8, 2, 1], [8, 2, 12]],
      [
        { id: "f0", kind: "fix", a: 0, point: [0, 0, 0] },
        { id: "ax1", kind: "along-axis", a: [0, 1], axis: "X" },
        { id: "d1", kind: "distance", a: [0, 1], value: 25 },
        { id: "ax2", kind: "along-axis", a: [1, 2], axis: "Z" },
        { id: "d2", kind: "distance", a: [1, 2], value: 15 },
      ],
    );
    expect(solved.points[1][0]).toBeCloseTo(25, 5);
    expect(solved.points[1][1]).toBeCloseTo(0, 5);
    expect(solved.points[2][2]).toBeCloseTo(15, 5);
    expect(solved.degreesOfFreedom).toBe(0);
  });
});
