/** Diameter, radius and angle dimensions attached to projected edges by proximity:
 *  the circle, arc or straight edge nearest the authored pick point is measured on
 *  every rebuild, so the reference needs no edge numbering. All graphics are sheet mm. */
import type { DrawingAnnotation, DrawingPoint } from "./document";
import { sheetPoint, type BuiltDrawingAnnotation, type BuiltDrawingView } from "./build";

type Attached = Extract<DrawingAnnotation, { kind: "diameter" | "radius" | "angle" | "center-mark" }>;
type Segment = { a: DrawingPoint; b: DrawingPoint };
type Round = { center: DrawingPoint; radiusMm: number; modelRadius: number };
type Line = [DrawingPoint, DrawingPoint];

const sub = (p: DrawingPoint, q: DrawingPoint): DrawingPoint => [p[0] - q[0], p[1] - q[1]];
const add = (p: DrawingPoint, q: DrawingPoint): DrawingPoint => [p[0] + q[0], p[1] + q[1]];
const mul = (p: DrawingPoint, k: number): DrawingPoint => [p[0] * k, p[1] * k];
const norm = (p: DrawingPoint) => Math.hypot(p[0], p[1]);
const unit = (p: DrawingPoint, fallback: DrawingPoint = [1, 0]): DrawingPoint => { const n = norm(p); return n < 1e-9 ? fallback : mul(p, 1 / n); };
const perp = (p: DrawingPoint): DrawingPoint => [-p[1], p[0]];

/** Closed arrowhead at `tip`; `back` is the unit direction from the tip into the dimension line. */
function arrowhead(tip: DrawingPoint, back: DrawingPoint): Line[] {
  const base = add(tip, mul(back, 2)), side = mul(perp(back), 0.7);
  const p = add(base, side), q = sub(base, side);
  return [[tip, p], [p, q], [q, tip]];
}

function footOnSegment(p: DrawingPoint, { a, b }: Segment): DrawingPoint {
  const ab = sub(b, a), t = norm(ab) < 1e-9 ? 0 : Math.max(0, Math.min(1, (sub(p, a)[0] * ab[0] + sub(p, a)[1] * ab[1]) / (ab[0] ** 2 + ab[1] ** 2)));
  return add(a, mul(ab, t));
}

function sheetCurves(view: BuiltDrawingView): { rounds: Round[]; segments: Segment[] } {
  const rounds: Round[] = [], segments: Segment[] = [];
  const curves = view.view.hiddenLines ? [...view.geometry.visible, ...view.geometry.hidden] : view.geometry.visible;
  for (const curve of curves) {
    if (curve.kind === "line") segments.push({ a: sheetPoint(view, curve.start), b: sheetPoint(view, curve.end) });
    else if (curve.kind === "circle" || curve.kind === "arc") rounds.push({ center: sheetPoint(view, curve.center), radiusMm: curve.radius * view.view.scale, modelRadius: curve.radius });
  }
  return { rounds, segments };
}

function nearestRound(rounds: Round[], at: DrawingPoint, viewName: string): Round {
  let best: Round | undefined, bestDistance = Infinity;
  for (const round of rounds) {
    const distance = Math.abs(norm(sub(at, round.center)) - round.radiusMm);
    if (distance < bestDistance) { best = round; bestDistance = distance; }
  }
  if (!best || bestDistance > 5) throw Error(`No circle or arc lies within 5 mm of the picked point in view ${viewName}.`);
  return best;
}

function nearestSegment(segments: Segment[], at: DrawingPoint, viewName: string): Segment {
  let best: Segment | undefined, bestDistance = Infinity;
  for (const segment of segments) {
    const distance = norm(sub(at, footOnSegment(at, segment)));
    if (distance < bestDistance) { best = segment; bestDistance = distance; }
  }
  if (!best || bestDistance > 5) throw Error(`No straight edge lies within 5 mm of the picked point in view ${viewName}.`);
  return best;
}

export function attachedDimension(annotation: Attached, view: BuiltDrawingView): BuiltDrawingAnnotation {
  const { rounds, segments } = sheetCurves(view);
  const label = annotation.kind === "center-mark" ? annotation.atMm : annotation.positionMm, name = view.view.name;
  if (annotation.kind === "angle") {
    const first = nearestSegment(segments, annotation.atMm, name), second = nearestSegment(segments, annotation.toMm, name);
    if (first === second) throw Error("Pick two different straight edges for an angle dimension.");
    const d1 = sub(first.b, first.a), d2 = sub(second.b, second.a), cross = d1[0] * d2[1] - d1[1] * d2[0];
    if (Math.abs(cross) < 1e-9 * Math.max(norm(d1) * norm(d2), 1e-9)) throw Error("The picked edges are parallel; an angle needs edges that meet.");
    const ac = sub(second.a, first.a), t = (ac[0] * d2[1] - ac[1] * d2[0]) / cross, vertex = add(first.a, mul(d1, t));
    // Rays from the vertex through the pick points select the sector to measure.
    const ray = (pick: DrawingPoint, segment: Segment, direction: DrawingPoint) => {
      const foot = footOnSegment(pick, segment), away = sub(foot, vertex);
      return norm(away) < 1e-6 ? unit(norm(sub(segment.b, vertex)) > norm(sub(segment.a, vertex)) ? sub(segment.b, vertex) : sub(segment.a, vertex), unit(direction)) : unit(away);
    };
    const r1 = ray(annotation.atMm, first, d1), r2 = ray(annotation.toMm, second, d2);
    const valueDeg = Math.acos(Math.max(-1, Math.min(1, r1[0] * r2[0] + r1[1] * r2[1]))) * 180 / Math.PI;
    const radius = Math.max(5, norm(sub(label, vertex))), sweep = Math.sign(r1[0] * r2[1] - r1[1] * r2[0]) || 1, start = Math.atan2(r1[1], r1[0]);
    const steps = Math.max(8, Math.ceil(valueDeg / 5)), total = valueDeg * Math.PI / 180;
    const arcPoint = (i: number): DrawingPoint => { const angle = start + sweep * total * i / steps; return add(vertex, [radius * Math.cos(angle), radius * Math.sin(angle)]); };
    const lines: Line[] = [[vertex, add(vertex, mul(r1, radius + 2))], [vertex, add(vertex, mul(r2, radius + 2))]];
    for (let i = 0; i < steps; i++) lines.push([arcPoint(i), arcPoint(i + 1)]);
    lines.push(...arrowhead(arcPoint(0), unit(sub(arcPoint(1), arcPoint(0)))), ...arrowhead(arcPoint(steps), unit(sub(arcPoint(steps - 1), arcPoint(steps)))));
    return { id: annotation.id, viewId: annotation.viewId, text: `${valueDeg.toFixed(annotation.decimals)}°`, valueDeg, measure: "angle", textAlign: "center", positionMm: label, lines };
  }
  const round = nearestRound(rounds, annotation.atMm, name);
  if (annotation.kind === "center-mark") {
    const reach = round.radiusMm + 2, [cx, cy] = round.center;
    return { id: annotation.id, viewId: annotation.viewId, symbol: "center-mark", text: "", textAlign: "left", positionMm: round.center, lines: [[[cx - reach, cy], [cx + reach, cy]], [[cx, cy - reach], [cx, cy + reach]]] };
  }
  const toward = unit(sub(label, round.center)), edge = add(round.center, mul(toward, round.radiusMm));
  const outside = norm(sub(label, round.center)) > round.radiusMm + 1e-6;
  const lines: Line[] = annotation.kind === "diameter"
    ? [[sub(round.center, mul(toward, round.radiusMm)), edge], ...arrowhead(edge, mul(toward, -1)), ...arrowhead(sub(round.center, mul(toward, round.radiusMm)), toward)]
    : [[round.center, edge], ...arrowhead(edge, mul(toward, -1))];
  if (outside) lines.push([edge, label]);
  const value = annotation.kind === "diameter" ? 2 * round.modelRadius : round.modelRadius;
  return { id: annotation.id, viewId: annotation.viewId, text: `${annotation.kind === "diameter" ? "Ø" : "R"}${value.toFixed(annotation.decimals)}`, valueMm: value, measure: annotation.kind, textAlign: "left", positionMm: label, lines };
}
