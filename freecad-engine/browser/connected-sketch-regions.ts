import type { SketchContour, SketchDrawing, SketchPoint, SketchSegment } from '../../aether-engine/src/sketch/drawing';
import { contourClosed } from '../../aether-engine/src/sketch/drawing';
import { curveIntersections } from '../../aether-engine/src/sketch/curves/pairs';
import { polynomialRoots } from '../../aether-engine/src/sketch/curves/intersections';
import { circleSegments } from '../../aether-engine/src/sketch/curves/picking';

type Path = Extract<SketchContour, { type: 'path' }>;
export interface ConnectedSketchRegion {
  /** Authored contours, in traversal order. Never replaces the saved drawing. */
  contourIndices: number[];
  /** Present only after every contributor has acquired a stable identity. */
  contourIds?: string[];
  /** Transient exact boundary for filling/picking; contains no authored IDs. */
  contour: Path;
}
export interface ConnectedRegionIssue {
  contourIndices: number[];
  reason: 'open' | 'branched' | 'ambiguous-endpoints' | 'invalid-boundary';
}
const tolerance = 1e-7; // Match the native wire endpoint tolerance, in mm.
const distance = (a: SketchPoint, b: SketchPoint) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const cross = (a: SketchPoint, b: SketchPoint) => a[0] * b[1] - a[1] * b[0];

/** Reverse exact geometry, including ellipse sweep and Bézier controls. IDs
 * remain on the source; a derived boundary must not impersonate one contour. */
function oriented(path: Path, reverse: boolean): Path {
  const points = [path.start, ...path.segments.map(s => s.end)];
  const segments = path.segments.map((_, j): SketchSegment => {
    const i = reverse ? path.segments.length - 1 - j : j;
    const { id: _id, endVertexId: _vertex, ...segment } = structuredClone(path.segments[i]);
    if (!reverse) return segment;
    return {
      ...segment, end: [...points[i]],
      ...(segment.type === 'bezier' ? { controls: [segment.controls[1], segment.controls[0]] as [SketchPoint, SketchPoint] } : {}),
      ...(segment.type === 'ellipse' ? { sweep: !segment.sweep } : {}),
    };
  });
  return { type: 'path', start: [...points[reverse ? points.length - 1 : 0]], segments };
}

/** Cubic self-intersections cannot be found by intersecting different spans.
 * Factor B(t)-B(u) by (t-u) and solve for t+u and tu analytically. Also reject
 * stationary interior cusps/retracing, which are not regular face boundaries. */
function regularCubic(start: SketchPoint, segment: Extract<SketchSegment, { type: 'bezier' }>): boolean {
  const [p, q] = segment.controls, end = segment.end;
  const a = start.map((v, k) => -v + 3 * p[k] - 3 * q[k] + end[k]) as SketchPoint;
  const b = start.map((v, k) => 3 * v - 6 * p[k] + 3 * q[k]) as SketchPoint;
  const c = start.map((v, k) => 3 * (p[k] - v)) as SketchPoint;
  const scale = Math.max(1, Math.hypot(...a), Math.hypot(...b), Math.hypot(...c));
  const axis = Math.abs(a[0]) + Math.abs(b[0]) + Math.abs(c[0]) >= Math.abs(a[1]) + Math.abs(b[1]) + Math.abs(c[1]) ? 0 : 1;
  for (const t of polynomialRoots([c[axis], 2 * b[axis], 3 * a[axis]])) {
    if (t > 1e-9 && t < 1 - 1e-9 && Math.hypot(...a.map((v, k) => 3 * v * t * t + 2 * b[k] * t + c[k])) < scale * 1e-10) return false;
  }
  const denominator = cross(a, b);
  if (Math.abs(denominator) <= scale * scale * 1e-12) return true;
  const sum = -cross(a, c) / denominator;
  const k = Math.abs(a[0]) >= Math.abs(a[1]) ? 0 : 1;
  const product = sum * sum + (b[k] * sum + c[k]) / a[k];
  const discriminant = sum * sum - 4 * product;
  if (discriminant <= 1e-16) return true;
  const low = (sum - Math.sqrt(discriminant)) / 2, high = (sum + Math.sqrt(discriminant)) / 2;
  return low < -1e-9 || high > 1 + 1e-9;
}

function simpleBoundary(path: Path): boolean {
  const curves = path.segments.map((segment, i) => ({ start: i ? path.segments[i - 1].end : path.start, segment }));
  try {
    for (let i = 0; i < curves.length; i++) {
      const curve = curves[i];
      if (curve.segment.type === 'bezier' && !regularCubic(curve.start, curve.segment)) return false;
      if (distance(curve.start, curve.segment.end) <= tolerance) return false;
      for (let j = i + 1; j < curves.length; j++) {
        const allowed: SketchPoint[] = [];
        if (j === i + 1) allowed.push(curve.segment.end);
        if (i === 0 && j === curves.length - 1) allowed.push(path.start);
        const hits = curveIntersections(curve, curves[j]);
        if (curve.segment.type === 'line' && curves[j].segment.type === 'line' && hits.length > 1 && distance(hits[0].point, hits[1].point) > tolerance) return false;
        if (hits.some(hit => !allowed.some(p => distance(p, hit.point) <= tolerance))) return false;
      }
    }
    return true;
  } catch {
    // Coincident/overlapping curves and numerically ambiguous intersections
    // require repair, never a guessed region or a flattened approximation.
    return false;
  }
}

/** Closed degree-two components of separate open paths. Does not solve, snap,
 * trim, merge or mutate authored entities. Interior crossings/shared branches
 * need the later planar-arrangement path; this routine refuses ambiguous loops.
 * Existing closed contours remain the caller's ordinary one-contour regions. */
export function connectedSketchRegions(drawing: SketchDrawing): { regions: ConnectedSketchRegion[]; issues: ConnectedRegionIssue[] } {
  const edges: { path: Path; index: number; nodes: [number, number] }[] = [];
  const points: SketchPoint[] = [];
  drawing.contours.forEach((path, index) => {
    if (path.type !== 'path' || path.construction || !path.segments.length || distance(path.start, path.segments.at(-1)!.end) <= tolerance) return;
    const first = points.length;
    points.push(path.start, path.segments.at(-1)!.end);
    edges.push({ path, index, nodes: [first, first + 1] });
  });
  const parents = points.map((_, i) => i);
  function root(i: number): number {
    while (parents[i] !== i) { parents[i] = parents[parents[i]]; i = parents[i]; }
    return i;
  }
  // Union all near pairs, then check cluster diameter: a chain of individually
  // close endpoints must not bridge a gap larger than the tolerance.
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
    if (distance(points[i], points[j]) <= tolerance) parents[root(j)] = root(i);
  }
  const members = new Map<number, number[]>(), incident = new Map<number, number[]>();
  points.forEach((_, i) => { const r = root(i); members.set(r, [...(members.get(r) ?? []), i]); });
  edges.forEach((edge, i) => {
    edge.nodes = edge.nodes.map(root) as [number, number];
    for (const n of edge.nodes) incident.set(n, [...(incident.get(n) ?? []), i]);
  });
  const ambiguous = new Set<number>();
  for (const [node, list] of members) for (const a of list) for (const b of list) {
    if (distance(points[a], points[b]) > tolerance) ambiguous.add(node);
  }
  const regions: ConnectedSketchRegion[] = [], issues: ConnectedRegionIssue[] = [], visited = new Set<number>();
  edges.forEach((first, firstIndex) => {
    if (visited.has(firstIndex)) return;
    const component = new Set<number>(), nodes = new Set<number>(), pending = [firstIndex];
    while (pending.length) {
      const id = pending.pop()!;
      if (component.has(id)) continue;
      component.add(id); visited.add(id);
      for (const node of edges[id].nodes) { nodes.add(node); pending.push(...incident.get(node)!); }
    }
    const indices = [...component].map(i => edges[i].index).sort((a, b) => a - b);
    const reason = [...nodes].some(n => ambiguous.has(n)) ? 'ambiguous-endpoints'
      : [...nodes].some(n => incident.get(n)!.length > 2) ? 'branched'
      : [...nodes].some(n => incident.get(n)!.length !== 2) ? 'open' : undefined;
    if (reason) { issues.push({ contourIndices: indices, reason }); return; }
    let current = first.nodes[0], id = firstIndex;
    const order: number[] = [], parts: Path[] = [];
    do {
      const edge = edges[id], reverse = edge.nodes[0] !== current;
      parts.push(oriented(edge.path, reverse)); order.push(edge.index);
      current = edge.nodes[reverse ? 0 : 1];
      id = incident.get(current)!.find(candidate => candidate !== id)!;
    } while (id !== firstIndex && order.length <= component.size);
    const contour: Path = { type: 'path', start: parts[0].start, segments: parts.flatMap(p => p.segments) };
    if (order.length !== component.size || !simpleBoundary(contour)) {
      issues.push({ contourIndices: indices, reason: 'invalid-boundary' }); return;
    }
    const ids = order.map(index => drawing.contours[index].id);
    regions.push({ contourIndices: order, ...(ids.every((value): value is string => !!value) && new Set(ids).size === ids.length ? { contourIds: ids } : {}), contour });
  });
  const isolated = regions.filter(region => {
    const boundary = region.contour.segments.map((segment, i) => ({ start: i ? region.contour.segments[i - 1].end : region.contour.start, segment }));
    try {
      for (let i = 0; i < drawing.contours.length; i++) {
        const other = drawing.contours[i];
        if (other.construction || region.contourIndices.includes(i)) continue;
        const curves = other.type === 'circle' ? circleSegments(other.center, other.radius)
          : other.segments.map((segment, j) => ({ start: j ? other.segments[j - 1].end : other.start, segment }));
        if (boundary.some(a => curves.some(b => curveIntersections(a, b).length > 0))) {
          issues.push({ contourIndices: region.contourIndices, reason: 'invalid-boundary' }); return false;
        }
      }
      return true;
    } catch {
      issues.push({ contourIndices: region.contourIndices, reason: 'invalid-boundary' }); return false;
    }
  });
  return { regions: isolated, issues };
}

/** Stable contributor sets survive source reorder and edits. Losing a source,
 * adding a branch, or joining a different boundary must never retarget a solid. */
export function resolveConnectedSketchRegion(drawing: SketchDrawing, contourIds: readonly string[]): ConnectedSketchRegion {
  if (contourIds.length < 2 || contourIds.some(id => typeof id !== 'string' || !id.trim() || id.length > 128) || new Set(contourIds).size !== contourIds.length) throw Error('A connected region needs distinct source contour identities.');
  const counts = new Map<string, number>();
  for (const contour of drawing.contours) if (contour.id) counts.set(contour.id, (counts.get(contour.id) ?? 0) + 1);
  if (contourIds.some(id => counts.get(id) !== 1)) throw Error('A connected region source is missing or ambiguous. Reselect the region.');
  const region = connectedSketchRegions(drawing).regions.find(candidate => candidate.contourIds?.length === contourIds.length && candidate.contourIds.every(id => contourIds.includes(id)));
  if (!region) throw Error('The referenced curves no longer form the same closed region. Repair the sketch or reselect the region.');
  return region;
}

/** One region projection shared by canvas filling, picking and job translation.
 * The index is transient UI identity only; saved features use contributor IDs. */
export function sketchFaceRegions(drawing: SketchDrawing) {
  const closed = drawing.contours.flatMap((contour, index) => contour.construction || !contourClosed(contour) ? [] : [{
    contourIndex: index, contour, sourceContourIndices: [index], sourceContourIds: contour.id ? [contour.id] : undefined,
  }]);
  const joined = connectedSketchRegions(drawing).regions.map(region => ({
    contourIndex: Math.min(...region.contourIndices), contour: region.contour as SketchContour,
    sourceContourIndices: region.contourIndices, sourceContourIds: region.contourIds,
  }));
  return [...closed, ...joined].sort((a, b) => a.contourIndex - b.contourIndex);
}
