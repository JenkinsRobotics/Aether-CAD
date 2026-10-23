import { contourClosed, type SketchDrawing } from "../drawing";
import type { DrawingConstraint, SketchEntityRef } from "../solver/types";

/** AutoConstrain (SolidCraft's sketch.auto_constrain): lines within the angle
 *  tolerance of the axes become horizontal or vertical, and path endpoints that
 *  nearly meet become coincident, unless an equivalent relation already exists.
 *  Nothing moves here; the solver places the geometry on the next solve. */
export function autoConstrainDrawing(source: SketchDrawing, options: { angleToleranceDegrees?: number; distanceToleranceMillimeters?: number } = {}): { drawing: SketchDrawing; added: number } {
  const angle = options.angleToleranceDegrees ?? 2, distance = options.distanceToleranceMillimeters ?? 0.05;
  const next = structuredClone(source);
  const constraints = (next.constraints ??= []);
  const ids = new Set(constraints.map((c) => c.id));
  let sequence = 1, added = 0;
  const key = (r: SketchEntityRef) => `${r.contour}:${r.kind}:${r.index ?? ""}:${r.vertexId ?? ""}`;
  const has = (kind: DrawingConstraint["kind"], a: SketchEntityRef, b?: SketchEntityRef) => constraints.some((c) => c.kind === kind && ((key(c.a) === key(a) && (!b || (c.b && key(c.b) === key(b)))) || (b && c.b && key(c.a) === key(b) && key(c.b) === key(a))));
  const add = (constraint: Omit<DrawingConstraint, "id">) => { while (ids.has(`auto-${sequence}`)) sequence++; const id = `auto-${sequence++}`; ids.add(id); constraints.push({ ...constraint, id }); added++; };
  const ends: { ref: SketchEntityRef; at: [number, number] }[] = [];
  next.contours.forEach((contour, index) => {
    if (contour.type !== "path") return;
    let from = contour.start;
    contour.segments.forEach((segment, i) => {
      if (segment.type === "line") {
        const dx = segment.end[0] - from[0], dy = segment.end[1] - from[1], length = Math.hypot(dx, dy);
        if (length > 1e-9) {
          const tilt = Math.abs(Math.atan2(dy, dx) * 180 / Math.PI);
          const ref: SketchEntityRef = { contour: index, kind: "line", index: i };
          if ((tilt < angle || Math.abs(tilt - 180) < angle) && !has("horizontal", ref) && !has("vertical", ref)) add({ kind: "horizontal", a: ref });
          else if (Math.abs(tilt - 90) < angle && !has("horizontal", ref) && !has("vertical", ref)) add({ kind: "vertical", a: ref });
        }
      }
      from = segment.end;
    });
    if (!contourClosed(contour) && contour.segments.length) {
      ends.push({ ref: { contour: index, kind: "point", index: 0 }, at: contour.start });
      ends.push({ ref: { contour: index, kind: "point", index: contour.segments.length }, at: contour.segments[contour.segments.length - 1].end });
    }
  });
  for (let i = 0; i < ends.length; i++) for (let j = i + 1; j < ends.length; j++) {
    if (ends[i].ref.contour === ends[j].ref.contour) continue;
    if (Math.hypot(ends[i].at[0] - ends[j].at[0], ends[i].at[1] - ends[j].at[1]) <= distance && !has("coincident", ends[i].ref, ends[j].ref)) add({ kind: "coincident", a: ends[i].ref, b: ends[j].ref });
  }
  return { drawing: next, added };
}

/** AutoConstrain from datum (SolidCraft's sketch.auto_constrain_from_datum): AutoConstrain,
 *  then every path vertex's position measured from a datum point with horizontal and
 *  vertical distances. Coordinates already tied together (a horizontal line's ends share y,
 *  a vertical line's share x, coincident points share both) are dimensioned once, so no
 *  dimension repeats a relation. Without a datum, a fixed construction point at the
 *  sketch origin is added and used. Circles and arc midpoints are left to the user. */
export function autoConstrainFromDatum(source: SketchDrawing, options: { datum?: SketchEntityRef; angleToleranceDegrees?: number; distanceToleranceMillimeters?: number } = {}): { drawing: SketchDrawing; added: number } {
  const first = autoConstrainDrawing(source, options);
  const next = first.drawing, constraints = (next.constraints ??= []);
  let added = first.added;
  const ids = new Set(constraints.map((c) => c.id));
  let sequence = 1;
  const add = (constraint: Omit<DrawingConstraint, "id">) => { while (ids.has(`datum-${sequence}`)) sequence++; const id = `datum-${sequence++}`; ids.add(id); constraints.push({ ...constraint, id }); added++; };
  let datum = options.datum;
  if (!datum) {
    next.contours.push({ type: "path", start: [0, 0], segments: [], construction: true });
    datum = { contour: next.contours.length - 1, kind: "point", index: 0 };
    add({ kind: "fix", a: datum, point: [0, 0] } as Omit<DrawingConstraint, "id">);
  }
  const pointOf = (r: SketchEntityRef): [number, number] | undefined => {
    const c = next.contours[r.contour];
    if (!c || c.type !== "path" || r.kind !== "point" || r.index === undefined) return undefined;
    return r.index === 0 ? c.start : c.segments[r.index - 1]?.end;
  };
  const at = pointOf(datum);
  if (!at) throw new Error("The datum must be a sketch point or a path vertex.");
  // Vertices by contour:index; a closed path's last vertex is its first.
  const vkey = (contour: number, index: number) => { const c = next.contours[contour]; return c?.type === "path" && contourClosed(c) && index === c.segments.length ? `${contour}:0` : `${contour}:${index}`; };
  const refKey = (r: SketchEntityRef) => r.kind === "point" && r.index !== undefined ? vkey(r.contour, r.index) : undefined;
  const parent = { x: new Map<string, string>(), y: new Map<string, string>() };
  const find = (axis: "x" | "y", k: string): string => { const p = parent[axis].get(k) ?? k; if (p === k) return k; const root = find(axis, p); parent[axis].set(k, root); return root; };
  const union = (axis: "x" | "y", a: string, b: string) => { const ra = find(axis, a), rb = find(axis, b); if (ra !== rb) parent[axis].set(ra, rb); };
  for (const c of constraints) {
    if (c.kind === "coincident" && c.b) { const a = refKey(c.a), b = refKey(c.b); if (a && b) { union("x", a, b); union("y", a, b); } }
    if ((c.kind === "horizontal" || c.kind === "vertical") && c.a.kind === "line" && c.a.index !== undefined) {
      const a = vkey(c.a.contour, c.a.index), b = vkey(c.a.contour, c.a.index + 1);
      union(c.kind === "horizontal" ? "y" : "x", a, b);
    }
    if (c.kind === "fix") { const a = refKey(c.a); if (a) { union("x", a, "fixed"); union("y", a, "fixed"); } }
  }
  const datumKey = refKey(datum)!;
  const done = { x: new Set([find("x", datumKey), find("x", "fixed")]), y: new Set([find("y", datumKey), find("y", "fixed")]) };
  next.contours.forEach((c, contour) => {
    // The datum vertex itself is skipped by its coordinate groups, not by its contour:
    // the rest of a datum's path still needs positions.
    if (c.type !== "path") return;
    for (let index = 0; index <= c.segments.length; index++) {
      const k = vkey(contour, index);
      if (k !== `${contour}:${index}`) continue;
      const p = index === 0 ? c.start : c.segments[index - 1].end, ref: SketchEntityRef = { contour, kind: "point", index };
      for (const axis of ["x", "y"] as const) {
        const root = find(axis, k);
        if (done[axis].has(root)) continue;
        done[axis].add(root);
        add({ kind: axis === "x" ? "horizontal-distance" : "vertical-distance", a: datum!, b: ref, value: axis === "x" ? p[0] - at[0] : p[1] - at[1] });
      }
    }
  });
  return { drawing: next, added };
}
