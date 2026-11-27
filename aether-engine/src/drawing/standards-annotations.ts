import type { DrawingPoint } from "./document";
import type { BuiltDrawingAnnotation, BuiltDrawingView } from "./build";
import { sheetPoint } from "./build";
import { circleChords } from "./detail-view";
import type { PartDrawingProjection } from "./projection";

export type GdtCharacteristic =
  | "flatness"
  | "straightness"
  | "circularity"
  | "cylindricity"
  | "profile-line"
  | "profile-surface"
  | "perpendicularity"
  | "angularity"
  | "parallelism"
  | "position"
  | "concentricity"
  | "symmetry"
  | "runout"
  | "total-runout";

export const gdtCharacteristicCodes: Record<GdtCharacteristic, string> = {
  flatness: "FLT",
  straightness: "STR",
  circularity: "CIR",
  cylindricity: "CYL",
  "profile-line": "PRL",
  "profile-surface": "PRS",
  perpendicularity: "PERP",
  angularity: "ANG",
  parallelism: "PAR",
  position: "POS",
  concentricity: "CON",
  symmetry: "SYM",
  runout: "RUN",
  "total-runout": "TRUN",
};

function arrowhead(tip: DrawingPoint, from: DrawingPoint): [DrawingPoint, DrawingPoint][] {
  const dx = tip[0] - from[0], dy = tip[1] - from[1], d = Math.hypot(dx, dy);
  if (d < 1e-6) return [];
  const ux = dx / d, uy = dy / d;
  const base: DrawingPoint = [tip[0] - ux * 2.2, tip[1] - uy * 2.2];
  const p: DrawingPoint = [base[0] - uy * 0.7, base[1] + ux * 0.7];
  const q: DrawingPoint = [base[0] + uy * 0.7, base[1] - ux * 0.7];
  return [[tip, p], [p, q], [q, tip]];
}

/** Format a dimension value with optional symmetric/asymmetric tolerances and `{value}` override. */
export function formatDimensionText(
  value: number,
  decimals: number,
  prefix = "",
  suffix = "",
  toleranceUpper?: number,
  toleranceLower?: number,
  overrideText?: string,
): string {
  const base = `${prefix}${value.toFixed(decimals)}${suffix}`;
  let formatted = overrideText ? overrideText.replace(/\{value\}/g, base) : base;
  if (toleranceUpper !== undefined || toleranceLower !== undefined) {
    const up = toleranceUpper ?? 0;
    const lo = toleranceLower ?? 0;
    if (Math.abs(up + lo) < 1e-9 && up > 0) {
      formatted += ` +/-${up.toFixed(decimals)}`;
    } else {
      const sUp = up >= 0 ? `+${up.toFixed(decimals)}` : up.toFixed(decimals);
      const sLo = lo >= 0 ? `+${lo.toFixed(decimals)}` : lo.toFixed(decimals);
      formatted += ` (${sUp}/${sLo})`;
    }
  }
  return formatted;
}

/** Build an Ordinate dimension (`kind: "ordinate"`) measuring X or Y from a datum point in view model mm. */
export function buildOrdinateDimension(
  id: string,
  view: BuiltDrawingView,
  axis: "x" | "y",
  datumMm: DrawingPoint,
  targetMm: DrawingPoint,
  positionMm: DrawingPoint,
  decimals: number,
  toleranceUpperMm?: number,
  toleranceLowerMm?: number,
  overrideText?: string,
): BuiltDrawingAnnotation {
  const s = view.view.scale;
  const valMm = axis === "x"
    ? Math.abs(targetMm[0] - datumMm[0]) / s
    : Math.abs(targetMm[1] - datumMm[1]) / s;
  const text = formatDimensionText(valMm, decimals, "", "", toleranceUpperMm, toleranceLowerMm, overrideText);
  const lines: [DrawingPoint, DrawingPoint][] =
    axis === "x"
      ? [[targetMm, [targetMm[0], positionMm[1]]]]
      : [[targetMm, [positionMm[0], targetMm[1]]]];
  return {
    id,
    viewId: view.view.id,
    text,
    valueMm: valMm,
    measure: "length",
    symbol: "ordinate",
    textAlign: "center",
    positionMm: axis === "x" ? [targetMm[0], positionMm[1] - 1.5] : [positionMm[0] + 1.5, targetMm[1] + 1],
    lines,
  };
}

/** Build a dashed ISO 128 centerline segment between two sheet points. */
export function buildCenterline(id: string, viewId: string, startMm: DrawingPoint, endMm: DrawingPoint): BuiltDrawingAnnotation {
  const dx = endMm[0] - startMm[0], dy = endMm[1] - startMm[1], len = Math.hypot(dx, dy);
  const lines: [DrawingPoint, DrawingPoint][] = [];
  if (len > 1e-6) {
    const ux = dx / len, uy = dy / len;
    // Extend 2 mm past endpoints with long-short-long cadence (8 mm dash, 2 mm gap, 2 mm dash, 2 mm gap).
    let t = -2;
    const total = len + 2;
    let longDash = true;
    while (t < total) {
      const dash = longDash ? 8 : 2;
      const tEnd = Math.min(total, t + dash);
      lines.push([
        [startMm[0] + ux * t, startMm[1] + uy * t],
        [startMm[0] + ux * tEnd, startMm[1] + uy * tEnd],
      ]);
      t = tEnd + 2;
      longDash = !longDash;
    }
  }
  return { id, viewId, symbol: "centerline", text: "", textAlign: "left", positionMm: startMm, lines };
}

/** Build a Leader Note with optional dynamic template fields (`{{name}}`, `{{sheet}}`, `{{projection}}`). */
export function buildLeaderNote(
  id: string,
  text: string,
  positionMm: DrawingPoint,
  leaderPointsMm: DrawingPoint[],
  fields: Record<string, string>,
): BuiltDrawingAnnotation {
  const resolved = text.replace(/\{\{(\w+)\}\}/g, (_, k) => fields[k] ?? `{{${k}}}`);
  const lines: [DrawingPoint, DrawingPoint][] = [];
  const chain = [...leaderPointsMm, positionMm];
  for (let i = 1; i < chain.length; i++) lines.push([chain[i - 1], chain[i]]);
  if (chain.length >= 2) lines.push(...arrowhead(chain[0], chain[1]));
  return { id, symbol: "leader-note", text: resolved, textAlign: "left", positionMm: [positionMm[0] + 1.5, positionMm[1] - 1], lines };
}

/** Build a Hole Callout attaching to the nearest visible circle/arc to `atMm`. */
export function buildHoleCallout(
  id: string,
  view: BuiltDrawingView,
  atMm: DrawingPoint,
  positionMm: DrawingPoint,
  decimals: number,
  customText?: string,
): BuiltDrawingAnnotation {
  let bestRadius: number | undefined;
  let bestDist = Infinity;
  let targetPt: DrawingPoint = atMm;
  for (const c of view.geometry.visible) {
    if (c.kind !== "circle" && c.kind !== "arc") continue;
    const center = sheetPoint(view, c.center);
    const rSheet = c.radius * view.view.scale;
    const dCenter = Math.hypot(atMm[0] - center[0], atMm[1] - center[1]);
    const dRim = Math.abs(dCenter - rSheet);
    if (dRim < bestDist) {
      bestDist = dRim;
      bestRadius = c.radius;
      const ang = Math.atan2(positionMm[1] - center[1], positionMm[0] - center[0]);
      targetPt = [center[0] + rSheet * Math.cos(ang), center[1] + rSheet * Math.sin(ang)];
    }
  }
  const dia = bestRadius !== undefined ? 2 * bestRadius : undefined;
  const text = customText ?? (dia !== undefined ? `DIA ${dia.toFixed(decimals)} THRU` : "HOLE");
  const lines: [DrawingPoint, DrawingPoint][] = [[targetPt, positionMm], ...arrowhead(targetPt, positionMm)];
  return {
    id,
    viewId: view.view.id,
    symbol: "hole-callout",
    text,
    valueMm: dia,
    measure: dia !== undefined ? "diameter" : undefined,
    textAlign: "left",
    positionMm: [positionMm[0] + 1.5, positionMm[1] - 1],
    lines,
  };
}

/** Build a Chamfer Note with leader arrow. */
export function buildChamferNote(
  id: string,
  viewId: string,
  atMm: DrawingPoint,
  positionMm: DrawingPoint,
  text: string,
): BuiltDrawingAnnotation {
  const lines: [DrawingPoint, DrawingPoint][] = [[atMm, positionMm], ...arrowhead(atMm, positionMm)];
  return { id, viewId, symbol: "chamfer-note", text, textAlign: "left", positionMm: [positionMm[0] + 1.5, positionMm[1] - 1], lines };
}

/** Build a boxed GD&T Feature Control Frame (`[CHAR | TOL | A | B | C]`). */
export function buildGdtFrame(
  id: string,
  characteristic: GdtCharacteristic,
  tolerance: string,
  datums: string[] | undefined,
  positionMm: DrawingPoint,
  leaderMm?: DrawingPoint,
): BuiltDrawingAnnotation {
  const cells = [gdtCharacteristicCodes[characteristic], tolerance, ...(datums ?? [])];
  const label = cells.join(" | ");
  const boxW = Math.max(24, label.length * 2.1 + 4);
  const boxH = 6;
  const [x, y] = positionMm;
  const lines: [DrawingPoint, DrawingPoint][] = [
    [[x, y - boxH], [x + boxW, y - boxH]],
    [[x + boxW, y - boxH], [x + boxW, y]],
    [[x + boxW, y], [x, y]],
    [[x, y], [x, y - boxH]],
  ];
  if (leaderMm) {
    lines.push([[x, y - boxH / 2], leaderMm], ...arrowhead(leaderMm, [x, y - boxH / 2]));
  }
  return { id, symbol: "gdt", text: label, textAlign: "left", positionMm: [x + 1.5, y - 1.5], lines };
}

/** Build an ISO/ASME Datum Feature Symbol (triangle foot + stem + boxed letter). */
export function buildDatumSymbol(id: string, label: string, positionMm: DrawingPoint, leaderMm: DrawingPoint): BuiltDrawingAnnotation {
  const [x, y] = positionMm;
  const s = 6;
  const lines: [DrawingPoint, DrawingPoint][] = [
    [[x - s / 2, y - s], [x + s / 2, y - s]],
    [[x + s / 2, y - s], [x + s / 2, y]],
    [[x + s / 2, y], [x - s / 2, y]],
    [[x - s / 2, y], [x - s / 2, y - s]],
    [[x, y], leaderMm],
    ...arrowhead(leaderMm, [x, y]),
  ];
  return { id, symbol: "datum", text: label, textAlign: "center", positionMm: [x, y - 1.6], lines };
}

/** Build an ISO 1302 Surface Texture / Roughness symbol (check-mark V + optional top bar + Ra text). */
export function buildSurfaceTextureSymbol(
  id: string,
  ra: string,
  process: "machined" | "unmachined" | "any" | undefined,
  positionMm: DrawingPoint,
  leaderMm?: DrawingPoint,
): BuiltDrawingAnnotation {
  const [x, y] = positionMm;
  const lines: [DrawingPoint, DrawingPoint][] = [
    [[x - 2, y - 3.5], [x, y]],
    [[x, y], [x + 4, y - 7]],
    [[x + 4, y - 7], [x + 14, y - 7]],
  ];
  if (process === "machined") lines.push([[x - 2, y - 3.5], [x + 2, y - 3.5]]);
  else if (process === "unmachined") lines.push(...circleChords([x, y - 2.3], 1.1));
  if (leaderMm) lines.push([[x, y], leaderMm], ...arrowhead(leaderMm, [x, y]));
  return { id, symbol: "surface-texture", text: `Ra ${ra}`, textAlign: "left", positionMm: [x + 4.5, y - 8], lines };
}

/** Build a Weld Symbol (leader + reference line + weld tail/symbol + optional all-around circle). */
export function buildWeldSymbol(
  id: string,
  weldType: "fillet" | "butt" | "groove" | "plug" | "spot",
  size: string | undefined,
  allAround: boolean | undefined,
  positionMm: DrawingPoint,
  leaderMm: DrawingPoint,
): BuiltDrawingAnnotation {
  const [x, y] = positionMm;
  const lines: [DrawingPoint, DrawingPoint][] = [
    [leaderMm, [x, y]],
    [[x, y], [x + 18, y]],
    ...arrowhead(leaderMm, [x, y]),
  ];
  if (allAround) lines.push(...circleChords([x, y], 1.5));
  if (weldType === "fillet") {
    lines.push([[x + 6, y], [x + 6, y + 3.5]], [[x + 6, y + 3.5], [x + 10, y]]);
  } else if (weldType === "spot") {
    lines.push(...circleChords([x + 8, y], 1.4));
  }
  const text = size ? `${size} ${weldType.toUpperCase()}` : weldType.toUpperCase();
  return { id, symbol: "weld-symbol", text, textAlign: "left", positionMm: [x + 2, y - 1.5], lines };
}

/** Build a triangular Revision Callout Tag (`drawing.revision.tag.add`). */
export function buildRevisionTag(id: string, revision: string, positionMm: DrawingPoint): BuiltDrawingAnnotation {
  const [x, y] = positionMm;
  const r = 4.2;
  const top: DrawingPoint = [x, y - r];
  const left: DrawingPoint = [x - r * 0.9, y + r * 0.65];
  const right: DrawingPoint = [x + r * 0.9, y + r * 0.65];
  return {
    id,
    symbol: "revision-tag",
    text: revision,
    textAlign: "center",
    positionMm: [x, y + 1.5],
    lines: [[top, right], [right, left], [left, top]],
  };
}

/** Extract all visible snap points (endpoints, midpoints, circle/arc centers) in sheet mm. */
export function extractProjectionSnapPoints(
  view: BuiltDrawingView,
): { id: string; kind: "endpoint" | "midpoint" | "center"; pointMm: DrawingPoint }[] {
  const snaps: { id: string; kind: "endpoint" | "midpoint" | "center"; pointMm: DrawingPoint }[] = [];
  const seen = new Set<string>();
  const add = (kind: "endpoint" | "midpoint" | "center", pt: DrawingPoint, suffix: string) => {
    const key = `${kind}:${Math.round(pt[0] * 100)}:${Math.round(pt[1] * 100)}`;
    if (seen.has(key)) return;
    seen.add(key);
    snaps.push({ id: `${view.view.id}/snap/${suffix}`, kind, pointMm: pt });
  };
  const curves: readonly PartDrawingProjection["visible"][number][] = view.geometry.visible;
  curves.forEach((curve, i) => {
    if (curve.kind === "line") {
      const a = sheetPoint(view, curve.start);
      const b = sheetPoint(view, curve.end);
      add("endpoint", a, `l${i}a`);
      add("endpoint", b, `l${i}b`);
      add("midpoint", [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], `l${i}m`);
    } else if (curve.kind === "circle" || curve.kind === "arc") {
      add("center", sheetPoint(view, curve.center), `c${i}`);
      if (curve.kind === "arc") {
        const s: DrawingPoint = [curve.center[0] + curve.radius * Math.cos(curve.start), curve.center[1] + curve.radius * Math.sin(curve.start)];
        const e: DrawingPoint = [curve.center[0] + curve.radius * Math.cos(curve.end), curve.center[1] + curve.radius * Math.sin(curve.end)];
        add("endpoint", sheetPoint(view, s), `a${i}s`);
        add("endpoint", sheetPoint(view, e), `a${i}e`);
      }
    } else if (curve.kind === "polyline" && curve.points.length >= 2) {
      add("endpoint", sheetPoint(view, curve.points[0]), `p${i}s`);
      add("endpoint", sheetPoint(view, curve.points[curve.points.length - 1]), `p${i}e`);
    }
  });
  return snaps;
}
