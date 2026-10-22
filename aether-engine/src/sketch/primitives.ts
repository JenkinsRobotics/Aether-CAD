import { ellipticalArcContour } from "./elliptical-arc";
import type { SketchContour, SketchPoint } from "./drawing";

export const sketchVariantTools = [
  "point",
  "ellipse",
  "elliptical-arc",
  "cubic-bezier",
  "midpoint-line",
  "center-rectangle",
  "aligned-rectangle",
  "three-point-circle",
  "center-arc",
  "inscribed-polygon",
  "circumscribed-polygon",
  "two-point-circle",
  "rounded-rectangle",
  "edge-polygon",
  "center-slot",
  "overall-slot",
  "center-point-slot",
  "center-arc-slot",
  "three-point-arc-slot",
] as const;
export type SketchVariantTool = (typeof sketchVariantTools)[number];
export const sketchVariantPointCounts: Record<SketchVariantTool, number> = {
  point: 1,
  ellipse: 3,
  "elliptical-arc": 4,
  "cubic-bezier": 4,
  "midpoint-line": 2,
  "center-rectangle": 2,
  "aligned-rectangle": 3,
  "three-point-circle": 3,
  "center-arc": 3,
  "inscribed-polygon": 2,
  "circumscribed-polygon": 2,
  "two-point-circle": 2,
  "rounded-rectangle": 2,
  "edge-polygon": 2,
  "center-slot": 2,
  "overall-slot": 2,
  "center-point-slot": 2,
  "center-arc-slot": 3,
  "three-point-arc-slot": 3,
};
/** The same exact geometry supplies both pointer previews and committed contours. Units: mm. */
export function sketchVariantContour(
  tool: SketchVariantTool,
  points: SketchPoint[],
  sides = 6,
  options: {
    clockwise?: boolean;
    secondaryRadiusMillimeters?: number;
    rememberedRadiusMillimeters?: number;
    /** Rounded rectangle: the corner radius, less than half the shorter side. */
    cornerRadiusMillimeters?: number;
    /** Slots: the width across the slot. */
    slotWidthMillimeters?: number;
  } = {},
): SketchContour {
  if (
    points.length !== sketchVariantPointCounts[tool] ||
    !points.every((p) => p.length === 2 && p.every(Number.isFinite))
  )
    throw new Error("Select the required finite points.");
  if (tool === "elliptical-arc")
    return ellipticalArcContour(
      points,
      options.clockwise,
      options.secondaryRadiusMillimeters,
      options.rememberedRadiusMillimeters,
    );
  if (tool === "point")
    return { type: "path", start: [...points[0]], segments: [] };
  const [a, b, c] = points,
    dx = b[0] - a[0],
    dy = b[1] - a[1],
    length = Math.hypot(dx, dy);
  if (length < 1e-8) throw new Error("Choose distinct points.");
  const path = (vertices: SketchPoint[], closed = true): SketchContour => ({
    type: "path",
    start: vertices[0],
    segments: [...vertices.slice(1), ...(closed ? [vertices[0]] : [])].map(
      (end) => ({ type: "line", end: [...end] }),
    ),
  });
  if (tool === "cubic-bezier")
    return {
      type: "path",
      start: a,
      segments: [{ type: "bezier", controls: [b, c], end: points[3] }],
    };
  if (tool === "ellipse") {
    const radiusY = Math.abs(
      ((c[0] - a[0]) * -dy + (c[1] - a[1]) * dx) / length,
    );
    if (radiusY < 1e-8)
      throw new Error("Ellipse needs a nonzero minor radius.");
    const opposite: SketchPoint = [a[0] - dx, a[1] - dy];
    const ellipse = {
      type: "ellipse" as const,
      radiusX: length,
      radiusY,
      rotationDegrees: (Math.atan2(dy, dx) * 180) / Math.PI,
      largeArc: false,
      sweep: true,
    };
    return {
      type: "path",
      start: b,
      segments: [
        { ...ellipse, end: opposite },
        { ...ellipse, end: b },
      ],
    };
  }
  if (tool === "two-point-circle")
    return { type: "circle", center: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], radius: length / 2 };
  if (tool === "edge-polygon") {
    // The first edge is given; the polygon sits to the left of it.
    if (!Number.isInteger(sides) || sides < 3) throw new Error("Polygon needs at least 3 sides.");
    const vertices: SketchPoint[] = [a, b];
    const turn = (2 * Math.PI) / sides;
    let direction = Math.atan2(dy, dx), at: SketchPoint = b;
    for (let i = 2; i < sides; i++) {
      direction += turn;
      at = [at[0] + length * Math.cos(direction), at[1] + length * Math.sin(direction)];
      vertices.push(at);
    }
    return path(vertices);
  }
  if (tool === "rounded-rectangle") {
    const r = options.cornerRadiusMillimeters ?? 0;
    const w = Math.abs(dx), h = Math.abs(dy);
    if (w < 1e-8 || h < 1e-8) throw new Error("Rectangle needs width and height.");
    if (!(r > 0) || r >= Math.min(w, h) / 2) throw new Error("Corner radius must be positive and less than half the shorter side.");
    const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]), k = r * Math.SQRT1_2;
    return {
      type: "path",
      start: [x0 + r, y0],
      segments: [
        { type: "line", end: [x1 - r, y0] },
        { type: "arc", middle: [x1 - r + k, y0 + r - k], end: [x1, y0 + r] },
        { type: "line", end: [x1, y1 - r] },
        { type: "arc", middle: [x1 - r + k, y1 - r + k], end: [x1 - r, y1] },
        { type: "line", end: [x0 + r, y1] },
        { type: "arc", middle: [x0 + r - k, y1 - r + k], end: [x0, y1 - r] },
        { type: "line", end: [x0, y0 + r] },
        { type: "arc", middle: [x0 + r - k, y0 + r - k], end: [x0 + r, y0] },
      ],
    };
  }
  if (tool === "center-slot" || tool === "overall-slot" || tool === "center-point-slot") {
    // A slot between two arc centres: given centre to centre, by its overall ends, or by
    // its centre and one arc centre.
    const width = options.slotWidthMillimeters ?? 0;
    if (!(width > 0)) throw new Error("Slot width must be positive.");
    const r = width / 2, u: SketchPoint = [dx / length, dy / length], n: SketchPoint = [-u[1], u[0]];
    let c1: SketchPoint = a, c2: SketchPoint = b;
    if (tool === "overall-slot") {
      if (length <= width) throw new Error("A slot's overall length must exceed its width.");
      c1 = [a[0] + u[0] * r, a[1] + u[1] * r]; c2 = [b[0] - u[0] * r, b[1] - u[1] * r];
    } else if (tool === "center-point-slot") c1 = [2 * a[0] - b[0], 2 * a[1] - b[1]];
    const side = (c: SketchPoint, s: 1 | -1): SketchPoint => [c[0] + n[0] * r * s, c[1] + n[1] * r * s];
    const tip = (c: SketchPoint, s: 1 | -1): SketchPoint => [c[0] + u[0] * r * s, c[1] + u[1] * r * s];
    return {
      type: "path",
      start: side(c1, 1),
      segments: [
        { type: "line", end: side(c2, 1) },
        { type: "arc", middle: tip(c2, 1), end: side(c2, -1) },
        { type: "line", end: side(c1, -1) },
        { type: "arc", middle: tip(c1, -1), end: side(c1, 1) },
      ],
    };
  }
  if (tool === "center-arc-slot" || tool === "three-point-arc-slot") {
    // A slot along a centre arc: its centre, start and end direction (counter-clockwise
    // unless clockwise is asked), or three points on the centre arc. Two concentric arcs
    // and a semicircle cap at each end.
    const width = options.slotWidthMillimeters ?? 0;
    if (!(width > 0)) throw new Error("Slot width must be positive.");
    let center: SketchPoint, startAngle: number, sweep: number, R: number;
    if (tool === "center-arc-slot") {
      center = a; R = length;
      if (R < 1e-8 || Math.hypot(c[0] - a[0], c[1] - a[1]) < 1e-8) throw new Error("Choose the start and end away from the center.");
      startAngle = Math.atan2(dy, dx);
      const positiveSweep = (Math.atan2(c[1] - a[1], c[0] - a[0]) - startAngle + 2 * Math.PI) % (2 * Math.PI);
      if (positiveSweep < 1e-8 || 2 * Math.PI - positiveSweep < 1e-8) throw new Error("Arc endpoints must differ.");
      sweep = options.clockwise ? positiveSweep - 2 * Math.PI : positiveSweep;
    } else {
      const ux = c[0] - a[0], uy = c[1] - a[1], det = 2 * (dx * uy - dy * ux);
      if (Math.abs(det) < 1e-10) throw new Error("Arc points must not be collinear.");
      const q = dx * dx + dy * dy, r2 = ux * ux + uy * uy;
      center = [a[0] + (q * uy - r2 * dy) / det, a[1] + (dx * r2 - ux * q) / det];
      R = Math.hypot(center[0] - a[0], center[1] - a[1]);
      startAngle = Math.atan2(a[1] - center[1], a[0] - center[0]);
      const endAngle = Math.atan2(c[1] - center[1], c[0] - center[0]), midAngle = Math.atan2(b[1] - center[1], b[0] - center[0]);
      const ccw = (Math.max(endAngle - startAngle, 0) + (endAngle < startAngle ? 2 * Math.PI : 0)) % (2 * Math.PI);
      const toMid = (midAngle - startAngle + 2 * Math.PI) % (2 * Math.PI);
      sweep = toMid <= ccw ? ccw : ccw - 2 * Math.PI; // the through point decides the way round
    }
    const r = width / 2;
    if (R <= r) throw new Error("The centre arc's radius must exceed half the slot width.");
    const at = (angle: number, radius: number): SketchPoint => [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)];
    const endAngle = startAngle + sweep, mid = startAngle + sweep / 2, dir = Math.sign(sweep);
    // Caps: semicircles about the centre arc's ends, bulging along the arc's tangent.
    const cap = (angle: number, radius: number, s: number): SketchPoint => [center[0] + radius * Math.cos(angle) - s * r * Math.sin(angle), center[1] + radius * Math.sin(angle) + s * r * Math.cos(angle)];
    return {
      type: "path",
      start: at(startAngle, R + r),
      segments: [
        { type: "arc", middle: at(mid, R + r), end: at(endAngle, R + r) },
        { type: "arc", middle: cap(endAngle, R, dir), end: at(endAngle, R - r) },
        { type: "arc", middle: at(mid, R - r), end: at(startAngle, R - r) },
        { type: "arc", middle: cap(startAngle, R, -dir), end: at(startAngle, R + r) },
      ],
    };
  }
  if (tool === "midpoint-line")
    return path([[2 * a[0] - b[0], 2 * a[1] - b[1]], b], false);
  if (tool === "center-rectangle") {
    if (Math.abs(dx * dy) < 1e-10)
      throw new Error("Rectangle needs width and height.");
    return path([
      [a[0] - dx, a[1] - dy],
      [b[0], a[1] - dy],
      b,
      [a[0] - dx, b[1]],
    ]);
  }
  if (tool === "aligned-rectangle") {
    const height = ((c[0] - a[0]) * -dy + (c[1] - a[1]) * dx) / length;
    if (Math.abs(height) < 1e-8)
      throw new Error("Choose a point away from the first edge.");
    const offset: SketchPoint = [
      (-dy / length) * height,
      (dx / length) * height,
    ];
    return path([
      a,
      b,
      [b[0] + offset[0], b[1] + offset[1]],
      [a[0] + offset[0], a[1] + offset[1]],
    ]);
  }
  if (tool === "three-point-circle") {
    const ux = c[0] - a[0],
      uy = c[1] - a[1],
      det = 2 * (dx * uy - dy * ux);
    if (Math.abs(det) < 1e-10)
      throw new Error("Circle points must not be collinear.");
    const q = dx * dx + dy * dy,
      r = ux * ux + uy * uy;
    const center: SketchPoint = [
      a[0] + (q * uy - r * dy) / det,
      a[1] + (dx * r - ux * q) / det,
    ];
    return {
      type: "circle",
      center,
      radius: Math.hypot(center[0] - a[0], center[1] - a[1]),
    };
  }
  if (tool === "center-arc") {
    if (Math.hypot(c[0] - a[0], c[1] - a[1]) < 1e-8)
      throw new Error("Choose an end direction away from the center.");
    const start = Math.atan2(dy, dx),
      end = Math.atan2(c[1] - a[1], c[0] - a[0]);
    const positiveSweep = (end - start + 2 * Math.PI) % (2 * Math.PI);
    const sweep = options.clockwise
      ? positiveSweep - 2 * Math.PI
      : positiveSweep;
    if (positiveSweep < 1e-8 || 2 * Math.PI - positiveSweep < 1e-8)
      throw new Error("Arc endpoints must differ.");
    const at = (angle: number): SketchPoint => [
      a[0] + length * Math.cos(angle),
      a[1] + length * Math.sin(angle),
    ];
    return {
      type: "path",
      start: b,
      segments: [{ type: "arc", middle: at(start + sweep / 2), end: at(end) }],
    };
  }
  if (!Number.isInteger(sides) || sides < 3 || sides > 100)
    throw new Error("Polygon sides must be an integer from 3 to 100.");
  const circumscribed = tool === "circumscribed-polygon";
  const radius = circumscribed ? length / Math.cos(Math.PI / sides) : length;
  const angle = Math.atan2(dy, dx) - (circumscribed ? Math.PI / sides : 0);
  return path(
    Array.from({ length: sides }, (_, i) => [
      a[0] + radius * Math.cos(angle + (i * 2 * Math.PI) / sides),
      a[1] + radius * Math.sin(angle + (i * 2 * Math.PI) / sides),
    ]),
  );
}
