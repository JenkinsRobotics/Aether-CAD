import type { SketchDrawing, SketchPoint } from "../drawing";
import type { SketchEntityRef } from "../solver/types";

/** SolidCraft's `sketch.chain`: from a selected edge, every edge joined to it end to
 *  end — along its own path and across paths whose ends meet (within `tolerance`).
 *  Returns edge references; selection is the caller's. */
export function chainSketchSelection(drawing: SketchDrawing, refs: readonly SketchEntityRef[], tolerance = 1e-6): SketchEntityRef[] {
  type Edge = { contour: number; index: number; a: SketchPoint; b: SketchPoint };
  const edges: Edge[] = [];
  drawing.contours.forEach((c, contour) => {
    if (c.type !== "path") return;
    let from = c.start;
    c.segments.forEach((s, index) => { edges.push({ contour, index, a: from, b: s.end }); from = s.end; });
  });
  const near = (p: SketchPoint, q: SketchPoint) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= tolerance;
  const seeds = refs.flatMap((r) => edges.filter((e) => e.contour === r.contour && (r.kind === "contour" || r.index === undefined || e.index === r.index || (r.kind === "point" && (e.index === r.index - 1)))));
  if (!seeds.length) throw new Error("Select an edge to chain from.");
  const chosen = new Set<Edge>(seeds), queue = [...seeds];
  while (queue.length) {
    const e = queue.pop()!;
    for (const other of edges) {
      if (chosen.has(other)) continue;
      if (near(e.a, other.a) || near(e.a, other.b) || near(e.b, other.a) || near(e.b, other.b)) { chosen.add(other); queue.push(other); }
    }
  }
  return [...chosen].sort((x, y) => x.contour - y.contour || x.index - y.index).map((e) => ({ contour: e.contour, kind: segmentKind(drawing, e.contour, e.index), index: e.index }));
}

function segmentKind(drawing: SketchDrawing, contour: number, index: number): SketchEntityRef["kind"] {
  const c = drawing.contours[contour];
  const type = c.type === "path" ? c.segments[index].type : "line";
  return type === "line" ? "line" : type === "arc" ? "arc" : type === "ellipse" ? "ellipse" : "curve";
}
