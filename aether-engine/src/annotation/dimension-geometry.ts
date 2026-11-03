/** One dimension geometry for sketches and drawings (Jonathan, 2026-11-02): ANSI Y14.5
 *  proportions, pure maths in the caller's plane units. The sketch canvas and the drawing
 *  sheet only differ in how they paint the lines, arrows and text this module lays out. */
export type Point = [number, number];
export type Line = [Point, Point];
export interface DimensionStyle {
  /** Arrowhead length and half width. */
  arrow: number;
  arrowWidth: number;
  /** Extension lines start this far from the measured geometry and run this far past the dimension line. */
  extensionGap: number;
  extensionBeyond: number;
}
/** Y14.5 proportions scaled by `unit` (1 = a sheet millimetre). */
export const dimensionStyle = (unit = 1, extensionGap = unit): DimensionStyle => ({ arrow: 2 * unit, arrowWidth: 0.7 * unit, extensionGap, extensionBeyond: 2 * unit });
/** `back` is the unit direction from the tip into the dimension line. */
export interface Arrow { tip: Point; back: Point }
export interface DimensionGraphics {
  /** The dimension line between the arrow tips. */
  line: Line;
  extensions: Line[];
  arrows: Arrow[];
  /** Where the text sits: on the dimension line, or past an arrow when the label was dragged outside. */
  text: { at: Point; align: "center" | "left" };
  /** The line that carries the text on to a label outside the arrows. */
  run?: Line;
  outside: boolean;
}
export interface AngularGraphics extends DimensionGraphics { arc: { center: Point; radius: number; start: number; sweep: number } }

const sub = (p: Point, q: Point): Point => [p[0] - q[0], p[1] - q[1]];
const add = (p: Point, q: Point): Point => [p[0] + q[0], p[1] + q[1]];
const mul = (p: Point, k: number): Point => [p[0] * k, p[1] * k];
const dot = (p: Point, q: Point) => p[0] * q[0] + p[1] * q[1];
const norm = (p: Point) => Math.hypot(p[0], p[1]);
const unit = (p: Point, fallback: Point = [1, 0]): Point => { const n = norm(p); return n < 1e-9 ? fallback : mul(p, 1 / n); };
const perp = (p: Point): Point => [-p[1], p[0]];

/** Closed arrowhead as three segments. */
export function arrowheadLines({ tip, back }: Arrow, style: DimensionStyle): Line[] {
  const base = add(tip, mul(back, style.arrow)), side = mul(perp(back), style.arrowWidth);
  const p = add(base, side), q = sub(base, side);
  return [[tip, p], [p, q], [q, tip]];
}
/** The dimension line split around the text so it never runs through it; `halfGap` is half the text width plus clearance. */
export function splitAroundText(line: Line, at: Point, halfGap: number): Line[] {
  const along = unit(sub(line[1], line[0])), length = norm(sub(line[1], line[0]));
  const t = dot(sub(at, line[0]), along);
  const first: Line = [line[0], add(line[0], mul(along, Math.max(0, Math.min(length, t - halfGap))))];
  const second: Line = [add(line[0], mul(along, Math.max(0, Math.min(length, t + halfGap)))), line[1]];
  return [first, second].filter(([p, q]) => norm(sub(q, p)) > 1e-9);
}

/** Distance between `a` and `b`, measured along the segment ('aligned') or along one axis, with
 *  the dimension line passing through `label`. Text sits on the line at the label's foot; a
 *  label past an arrow extends the line to it. */
export function linearDimension(a: Point, b: Point, label: Point, style: DimensionStyle, axis: "aligned" | "x" | "y" = "aligned"): DimensionGraphics {
  let p: Point, q: Point, extA: Point, extB: Point;
  if (axis === "x") { p = [a[0], label[1]]; q = [b[0], label[1]]; extA = a; extB = b; }
  else if (axis === "y") { p = [label[0], a[1]]; q = [label[0], b[1]]; extA = a; extB = b; }
  else {
    const normal = perp(unit(sub(b, a))), offset = dot(sub(label, a), normal);
    p = add(a, mul(normal, offset)); q = add(b, mul(normal, offset)); extA = a; extB = b;
  }
  const along = unit(sub(q, p)), length = norm(sub(q, p));
  const extension = (from: Point, to: Point): Line => {
    const direction = unit(sub(to, from), perp(along));
    return [add(from, mul(direction, Math.min(style.extensionGap, norm(sub(to, from))))), add(to, mul(direction, style.extensionBeyond))];
  };
  const t = length < 1e-9 ? 0.5 : dot(sub(label, p), along) / length;
  const outside = t < 0 || t > 1;
  const foot: Point = add(p, mul(along, Math.max(Math.min(t, 2), -1) * length));
  const text: Point = outside ? foot : add(p, mul(along, length / 2));
  return {
    line: [p, q],
    extensions: [extension(extA, p), extension(extB, q)],
    arrows: [{ tip: p, back: along }, { tip: q, back: mul(along, -1) }],
    text: { at: text, align: "center" },
    ...(outside ? { run: [t < 0 ? p : q, foot] as Line } : {}),
    outside,
  };
}

/** The angle between two rays from `vertex` (unit directions, `sweep` sign chooses the sector),
 *  drawn as an arc through `label`; `reach` are the distances the measured lines extend from the
 *  vertex, so extension lines appear only where the arc lies beyond them. */
export function angularDimension(vertex: Point, r1: Point, r2: Point, sign: 1 | -1, label: Point, style: DimensionStyle, reach: [number, number] = [0, 0]): AngularGraphics {
  const radius = Math.max(norm(sub(label, vertex)), style.arrow * 2);
  const dotted = Math.max(-1, Math.min(1, dot(r1, r2)));
  const total = Math.acos(dotted), start = Math.atan2(r1[1], r1[0]);
  const at = (angle: number, r = radius): Point => add(vertex, [r * Math.cos(angle), r * Math.sin(angle)]);
  const p = at(start), q = at(start + sign * total), mid = at(start + sign * total / 2);
  const tangent = (angle: number): Point => mul([-Math.sin(angle), Math.cos(angle)], sign);
  const extension = (ray: Point, from: number): Line => [add(vertex, mul(ray, Math.max(from, 0))), add(vertex, mul(ray, radius + style.extensionBeyond))];
  return {
    line: [p, q],
    extensions: [extension(r1, reach[0] < radius ? reach[0] : radius), extension(r2, reach[1] < radius ? reach[1] : radius)],
    arrows: [{ tip: p, back: tangent(start) }, { tip: q, back: mul(tangent(start + sign * total), -1) }],
    text: { at: mid, align: "center" },
    outside: false,
    arc: { center: vertex, radius, start, sweep: sign * total },
  };
}
/** The arc as a polyline, for sheets that draw only segments. */
export function arcPolyline({ center, radius, start, sweep }: AngularGraphics["arc"], steps = Math.max(8, Math.ceil(Math.abs(sweep) * 180 / Math.PI / 5))): Line[] {
  const at = (i: number): Point => { const angle = start + sweep * i / steps; return add(center, [radius * Math.cos(angle), radius * Math.sin(angle)]); };
  const lines: Line[] = [];
  for (let i = 0; i < steps; i++) lines.push([at(i), at(i + 1)]);
  return lines;
}

/** A radius or diameter: the line through the centre toward `label`, text at the label. */
export function radialDimension(center: Point, radius: number, label: Point, kind: "radius" | "diameter"): DimensionGraphics {
  const toward = unit(sub(label, center), [Math.SQRT1_2, Math.SQRT1_2]);
  const edge = add(center, mul(toward, radius)), far = sub(center, mul(toward, radius));
  const outside = norm(sub(label, center)) > radius + 1e-6;
  const line: Line = kind === "diameter" ? [far, edge] : [center, edge];
  return {
    line,
    extensions: [],
    arrows: kind === "diameter" ? [{ tip: edge, back: mul(toward, -1) }, { tip: far, back: toward }] : [{ tip: edge, back: mul(toward, -1) }],
    text: { at: label, align: "left" },
    ...(outside ? { run: [edge, label] as Line } : {}),
    outside,
  };
}
