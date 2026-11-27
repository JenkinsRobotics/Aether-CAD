import { contourClosed, validateSketchDrawing, type SketchDrawing, type SketchPoint } from "../drawing";
import type { SketchEntityRef } from "../solver/types";
import { solveDrawingConstraints } from "../solver/solve";

export interface LooseEndEntry {
  ref: SketchEntityRef;
  at: SketchPoint;
}

export interface UntiedEndEntry {
  a: SketchEntityRef;
  b: SketchEntityRef;
  at: SketchPoint;
  distanceMillimeters: number;
}

export interface LooseEndsReport {
  /** Open endpoints not touching any other open endpoint within tolerance. */
  open: LooseEndEntry[];
  /** Pairs of open endpoints touching within tolerance without a coincident constraint. */
  untied: UntiedEndEntry[];
}

function collectOpenEnds(drawing: SketchDrawing): LooseEndEntry[] {
  const ends: LooseEndEntry[] = [];
  drawing.contours.forEach((contour, index) => {
    if (contour.type !== "path" || contour.construction || contourClosed(contour) || !contour.segments.length) return;
    ends.push({ ref: { contour: index, kind: "point", index: 0 }, at: contour.start });
    ends.push({
      ref: { contour: index, kind: "point", index: contour.segments.length },
      at: contour.segments[contour.segments.length - 1].end,
    });
  });
  return ends;
}

function refKey(r: SketchEntityRef): string {
  return `${r.contour}:${r.index}`;
}

function tiedPairKeys(drawing: SketchDrawing): { tiedEndpoints: Set<string>; pairs: Set<string> } {
  const tiedEndpoints = new Set<string>();
  const pairs = new Set<string>();
  for (const c of drawing.constraints ?? []) {
    if (c.kind === "coincident" && c.b && c.a.kind === "point" && c.b.kind === "point") {
      const ka = refKey(c.a), kb = refKey(c.b);
      tiedEndpoints.add(ka);
      tiedEndpoints.add(kb);
      pairs.add(ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`);
    } else if (c.kind === "coincident" && c.b) {
      if (c.a.kind === "point") tiedEndpoints.add(refKey(c.a));
      if (c.b.kind === "point") tiedEndpoints.add(refKey(c.b));
    }
  }
  return { tiedEndpoints, pairs };
}

/** Loose Ends (SolidCraft's `sketch.loose_ends`): the open path endpoints that no other
 *  endpoint touches (within tolerance) and no coincident relation ties. */
export function looseEnds(drawing: SketchDrawing, toleranceMillimeters = 1e-6): LooseEndEntry[] {
  return inspectLooseEnds(drawing, toleranceMillimeters).open;
}

/** Full loose-ends report separating genuinely open endpoints from coincident-position
 *  but algebraically untied endpoint pairs (`sketch.loose_ends`). */
export function inspectLooseEnds(drawing: SketchDrawing, toleranceMillimeters = 1e-3): LooseEndsReport {
  const ends = collectOpenEnds(drawing);
  const { tiedEndpoints, pairs } = tiedPairKeys(drawing);
  const open: LooseEndEntry[] = [];
  const untied: UntiedEndEntry[] = [];
  const touching = new Set<number>();

  for (let i = 0; i < ends.length; i++) {
    for (let j = i + 1; j < ends.length; j++) {
      const dist = Math.hypot(ends[i].at[0] - ends[j].at[0], ends[i].at[1] - ends[j].at[1]);
      if (dist <= toleranceMillimeters) {
        touching.add(i);
        touching.add(j);
        const ka = refKey(ends[i].ref), kb = refKey(ends[j].ref);
        const pk = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
        if (!pairs.has(pk)) {
          untied.push({
            a: ends[i].ref,
            b: ends[j].ref,
            at: [(ends[i].at[0] + ends[j].at[0]) / 2, (ends[i].at[1] + ends[j].at[1]) / 2],
            distanceMillimeters: dist,
          });
        }
      }
    }
  }
  for (let i = 0; i < ends.length; i++) {
    if (!touching.has(i) && !tiedEndpoints.has(refKey(ends[i].ref))) {
      open.push(ends[i]);
    }
  }
  return { open, untied };
}

/** Add coincident constraints for every untied touching endpoint pair (`sketch.loose_ends.tie`). */
export function tieLooseEnds(
  source: SketchDrawing,
  toleranceMillimeters = 1e-2,
): { drawing: SketchDrawing; tiedCount: number } {
  const report = inspectLooseEnds(source, toleranceMillimeters);
  if (!report.untied.length) return { drawing: structuredClone(source), tiedCount: 0 };
  const next = structuredClone(source);
  next.constraints ??= [];
  const used = new Set(next.constraints.map((c) => c.id));
  let counter = 1;
  let tiedCount = 0;
  for (const pair of report.untied) {
    while (used.has(`tie-${counter}`)) counter++;
    const id = `tie-${counter++}`;
    used.add(id);
    next.constraints.push({ id, kind: "coincident", a: pair.a, b: pair.b });
    tiedCount++;
  }
  const solved = solveDrawingConstraints(next);
  validateSketchDrawing(solved);
  return { drawing: solved, tiedCount };
}
