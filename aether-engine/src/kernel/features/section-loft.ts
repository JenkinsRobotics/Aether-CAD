import { assembleWire, cast, getOC, isShape3D, loft, makeBSplineApproximation, makeLine, measureVolume, type Edge, type Shape3D, type Wire } from 'replicad';
import { add, norm, scale, sub, type V3 } from '../vector';

/** Preserve successful historical lofts. Only retry invalid smooth interpolation
 * without apex constraints: a cubic surface avoids high-degree overshoot between
 * unevenly spaced stations while retaining every supplied section. */
export function sectionLoft(wires: Wire[], options: NonNullable<Parameters<typeof loft>[1]>): Shape3D {
  const original = loft(wires, options);
  const volume = measureVolume(original);
  if (options.ruled || options.startPoint || options.endPoint || (Number.isFinite(volume) && volume > 1e-9)) return original;
  original.delete();
  const oc = getOC();
  const builder = new oc.BRepOffsetAPI_ThruSections(true, false, 1e-6);
  const progress = new oc.Message_ProgressRange_1();
  try {
    builder.SetMaxDegree(3);
    for (const wire of wires) builder.AddWire(wire.wrapped);
    builder.Build(progress);
    const candidate = cast(builder.Shape());
    let accepted = false;
    try {
      if (!isShape3D(candidate)) throw Error('Loft did not produce a closed solid.');
      const check = new oc.BRepCheck_Analyzer(candidate.wrapped, true, false);
      let valid: boolean;
      try { valid = check.IsValid_2(); } finally { check.delete(); }
      const candidateVolume = measureVolume(candidate);
      if (!valid || !Number.isFinite(candidateVolume) || candidateVolume <= 1e-9) {
        throw Error('Loft produced an inverted or degenerate solid. Adjust the sections or use a ruled loft.');
      }
      accepted = true;
      return candidate;
    } finally { if (!accepted) candidate.delete(); }
  } finally { builder.delete(); progress.delete(); }
}

function sampleWirePoints(wire: Wire, count: number): V3[] {
  const edges = wire.edges;
  const lengths = edges.map((e) => e.length);
  const total = lengths.reduce((a, b) => a + b, 0);
  const pts: V3[] = [];
  for (let i = 0; i < count; i++) {
    const target = total * (i / count);
    let acc = 0;
    let chosen: Edge = edges[edges.length - 1];
    let localT = 1;
    for (let k = 0; k < edges.length; k++) {
      if (acc + lengths[k] >= target - 1e-9 || k === edges.length - 1) {
        chosen = edges[k];
        localT = lengths[k] > 1e-9 ? Math.max(0, Math.min(1, (target - acc) / lengths[k])) : 0;
        break;
      }
      acc += lengths[k];
    }
    const p = chosen.pointAt(localT);
    pts.push([p.x, p.y, p.z]);
    p.delete();
  }
  edges.forEach((e) => e.delete());
  return pts;
}

function sampleOpenWireAt(wire: Wire, t: number): V3 {
  const edges = wire.edges;
  const lengths = edges.map((e) => e.length);
  const total = lengths.reduce((a, b) => a + b, 0);
  const target = Math.max(0, Math.min(1, t)) * total;
  let acc = 0;
  let chosen: Edge = edges[edges.length - 1];
  let localT = 1;
  for (let k = 0; k < edges.length; k++) {
    if (acc + lengths[k] >= target - 1e-9 || k === edges.length - 1) {
      chosen = edges[k];
      localT = lengths[k] > 1e-9 ? Math.max(0, Math.min(1, (target - acc) / lengths[k])) : 0;
      break;
    }
    acc += lengths[k];
  }
  const p = chosen.pointAt(localT);
  const out: V3 = [p.x, p.y, p.z];
  p.delete();
  edges.forEach((e) => e.delete());
  return out;
}

function centroid(pts: V3[]): V3 {
  const s: V3 = [0, 0, 0];
  for (const p of pts) { s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; }
  return [s[0] / pts.length, s[1] / pts.length, s[2] / pts.length];
}

function closestRailParam(rail: Wire, target: V3, steps = 40): { t: number; point: V3; dist: number } {
  let bestT = 0, bestPt = sampleOpenWireAt(rail, 0), bestD = norm(sub(bestPt, target));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const pt = sampleOpenWireAt(rail, t);
    const d = norm(sub(pt, target));
    if (d < bestD) { bestD = d; bestT = t; bestPt = pt; }
  }
  return { t: bestT, point: bestPt, dist: bestD };
}

/** Guide-rail constrained solid loft (`solid.loft` with `guideRails`):
 *  samples intermediate cross-sections between each consecutive pair of section wires,
 *  scaling and shifting each intermediate station so its profile follows every guide rail
 *  smoothly from section to section, then builds a watertight OCCT ThruSections solid. */
export function guidedSectionLoft(wires: Wire[], rails: Wire[], ruled: boolean): Shape3D {
  if (!rails.length) return sectionLoft(wires, { ruled });
  const sampleCount = 32;
  const subStations = 5;
  const sectionLoops = wires.map((w) => sampleWirePoints(w, sampleCount));
  const sectionCenters = sectionLoops.map(centroid);

  // Align loop start indices and winding so adjacent sections do not twist.
  for (let k = 1; k < sectionLoops.length; k++) {
    const prev = sectionLoops[k - 1];
    const curr = sectionLoops[k];
    let bestShift = 0, bestReverse = false, bestScore = Infinity;
    for (const rev of [false, true]) {
      const arr = rev ? [...curr].reverse() : curr;
      for (let shift = 0; shift < sampleCount; shift++) {
        let score = 0;
        for (let i = 0; i < sampleCount; i++) {
          score += norm(sub(prev[i], arr[(i + shift) % sampleCount]));
        }
        if (score < bestScore) { bestScore = score; bestShift = shift; bestReverse = rev; }
      }
    }
    const base = bestReverse ? [...curr].reverse() : curr;
    sectionLoops[k] = base.map((_, i) => base[(i + bestShift) % sampleCount]);
  }

  // Locate where each rail meets each section.
  const railParams = rails.map((rail) =>
    sectionCenters.map((c, idx) => {
      // Closest point on the section loop to the rail determines the exact station t on the rail.
      let bestT = idx / Math.max(1, sectionCenters.length - 1);
      let bestDist = Infinity;
      for (let i = 0; i < sampleCount; i += 2) {
        const hit = closestRailParam(rail, sectionLoops[idx][i], 24);
        if (hit.dist < bestDist) { bestDist = hit.dist; bestT = hit.t; }
      }
      const railPt = sampleOpenWireAt(rail, bestT);
      return { t: bestT, radial: Math.max(norm(sub(railPt, c)), 1e-4), point: railPt };
    }),
  );

  const allWires: Wire[] = [];
  const tempWires: Wire[] = [];
  const makeClosedLoopWire = (pts: V3[]): Wire => {
    try {
      const edge = makeBSplineApproximation([...pts, pts[0]], { tolerance: 1e-3, degMin: 2, degMax: 3 });
      const w = assembleWire([edge]);
      edge.delete();
      return w;
    } catch {
      const edges = pts.map((p, i) => makeLine(p, pts[(i + 1) % pts.length]));
      const w = assembleWire(edges);
      edges.forEach((e) => e.delete());
      return w;
    }
  };

  try {
    for (let k = 0; k < wires.length; k++) {
      allWires.push(wires[k]);
      if (k === wires.length - 1) break;
      const loopA = sectionLoops[k], loopB = sectionLoops[k + 1];
      const cA = sectionCenters[k], cB = sectionCenters[k + 1];

      for (let s = 1; s <= subStations; s++) {
        const u = s / (subStations + 1);
        const linCenter: V3 = [
          cA[0] + (cB[0] - cA[0]) * u,
          cA[1] + (cB[1] - cA[1]) * u,
          cA[2] + (cB[2] - cA[2]) * u,
        ];

        // Compute average radial scale & center shift induced by all guide rails at this station.
        let scaleSum = 0;
        let shiftSum: V3 = [0, 0, 0];
        for (let r = 0; r < rails.length; r++) {
          const pA = railParams[r][k], pB = railParams[r][k + 1];
          const railT = pA.t + (pB.t - pA.t) * u;
          const actualPt = sampleOpenWireAt(rails[r], railT);
          const linRailPt: V3 = [
            pA.point[0] + (pB.point[0] - pA.point[0]) * u,
            pA.point[1] + (pB.point[1] - pA.point[1]) * u,
            pA.point[2] + (pB.point[2] - pA.point[2]) * u,
          ];
          const linRad = Math.max(norm(sub(linRailPt, linCenter)), 1e-4);
          const actRad = Math.max(norm(sub(actualPt, linCenter)), 1e-4);
          scaleSum += actRad / linRad;
          if (rails.length >= 2) {
            shiftSum = add(shiftSum, sub(actualPt, linRailPt));
          }
        }
        const radialScale = Math.max(0.1, scaleSum / rails.length);
        const centerShift = rails.length >= 2 ? scale(shiftSum, 1 / rails.length) : ([0, 0, 0] as V3);
        const targetCenter = add(linCenter, centerShift);

        const stationPts: V3[] = loopA.map((pa, i) => {
          const pb = loopB[i];
          const linP: V3 = [
            pa[0] + (pb[0] - pa[0]) * u,
            pa[1] + (pb[1] - pa[1]) * u,
            pa[2] + (pb[2] - pa[2]) * u,
          ];
          const offset = sub(linP, linCenter);
          return add(targetCenter, scale(offset, radialScale));
        });

        const w = makeClosedLoopWire(stationPts);
        tempWires.push(w);
        allWires.push(w);
      }
    }

    const oc = getOC();
    const builder = new oc.BRepOffsetAPI_ThruSections(true, ruled, 1e-6);
    const progress = new oc.Message_ProgressRange_1();
    try {
      if (!ruled) builder.SetMaxDegree(3);
      for (const wire of allWires) builder.AddWire(wire.wrapped);
      builder.Build(progress);
      const candidate = cast(builder.Shape());
      if (!isShape3D(candidate) || !(measureVolume(candidate) > 1e-9)) {
        if (candidate && typeof (candidate as any).delete === "function") (candidate as any).delete();
        throw new Error("Guided loft did not produce a valid closed solid.");
      }
      return candidate;
    } finally {
      builder.delete();
      progress.delete();
    }
  } finally {
    tempWires.forEach((w) => w.delete());
  }
}
