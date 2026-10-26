import { Vector3 } from 'three';
import type { SelectedTopologyMeasurement } from '../viewport/topology-measurement';
import type { MeasurePoint as Vec } from './measurement-geometry';
export interface MeasuredSpan {
    distance_mm: number;
    points: [
        Vec,
        Vec
    ];
    approximate?: boolean;
}
const vector = (v: Vec) => new Vector3(...v);
const span = (a: Vector3, b: Vector3, approximate = false): MeasuredSpan => ({ distance_mm: a.distanceTo(b), points: [a.toArray(), b.toArray()], ...(approximate ? { approximate } : {}) });
const EPS = 1e-8;
type Entity = SelectedTopologyMeasurement & {
    point?: Vec;
};
const circle = (m: Entity) => m.fullCircle && m.radiusMillimeters && m.centerMillimeters && m.axisDirection
    ? { center: vector(m.centerMillimeters), normal: vector(m.axisDirection).normalize(), radius: m.radiusMillimeters } : null;
const samples = (m: Entity): Vec[] => m.point ? [m.point] : m.samples ?? (m.endpoints && m.linearDirection ? m.endpoints : []);
/** Finite line segments, including degenerate point segments. */
export function segmentDistance(a: Vec, b: Vec, c: Vec, d: Vec): MeasuredSpan {
    const p = vector(a), q = vector(c), u = vector(b).sub(p), v = vector(d).sub(q), w = p.clone().sub(q);
    const aa = u.dot(u), bb = u.dot(v), cc = v.dot(v), dd = u.dot(w), ee = v.dot(w), det = aa * cc - bb * bb;
    const clamp = (n: number) => Math.max(0, Math.min(1, n));
    let s = aa < EPS ? 0 : cc < EPS ? clamp(-dd / aa) : det > EPS ? clamp((bb * ee - cc * dd) / det) : 0;
    let t = cc < EPS ? 0 : (bb * s + ee) / cc;
    if (t < 0) {
        t = 0;
        s = aa < EPS ? 0 : clamp(-dd / aa);
    }
    else if (t > 1) {
        t = 1;
        s = aa < EPS ? 0 : clamp((bb - dd) / aa);
    }
    return span(p.addScaledVector(u, s), q.addScaledVector(v, t));
}
/** Exact circular extrema and finite line/point distances; sampled surfaces are explicitly marked. */
export function analyticSpans(a: Entity, b: Entity): {
    minimum?: MeasuredSpan;
    maximum?: MeasuredSpan;
} {
    const ca = circle(a), cb = circle(b);
    if (ca && b.point) {
        const p = vector(b.point), delta = p.clone().sub(ca.center), radial = delta.clone().addScaledVector(ca.normal, -delta.dot(ca.normal));
        if (radial.length() < EPS)
            radial.copy(Math.abs(ca.normal.x) < .9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0)).addScaledVector(ca.normal, -radial.dot(ca.normal));
        radial.normalize();
        return { minimum: span(ca.center.clone().addScaledVector(radial, ca.radius), p), maximum: span(ca.center.clone().addScaledVector(radial, -ca.radius), p) };
    }
    if (cb && a.point) {
        const result = analyticSpans(b, a);
        return Object.fromEntries(Object.entries(result).map(([key, value]) => [key, { ...value, points: [value.points[1], value.points[0]] }])) as ReturnType<typeof analyticSpans>;
    }
    if (ca && cb && Math.abs(ca.normal.dot(cb.normal)) > 1 - 1e-8) {
        const delta = cb.center.clone().sub(ca.center), axial = delta.dot(ca.normal), radial = delta.clone().addScaledVector(ca.normal, -axial), distance = radial.length();
        if (distance < EPS)
            radial.copy(Math.abs(ca.normal.x) < .9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0)).addScaledVector(ca.normal, -radial.dot(ca.normal));
        radial.normalize();
        const maximum = span(ca.center.clone().addScaledVector(radial, -ca.radius), cb.center.clone().addScaledVector(radial, cb.radius));
        if (distance >= ca.radius + cb.radius)
            return { minimum: span(ca.center.clone().addScaledVector(radial, ca.radius), cb.center.clone().addScaledVector(radial, -cb.radius)), maximum };
        if (distance <= Math.abs(ca.radius - cb.radius)) {
            const sign = ca.radius >= cb.radius ? 1 : -1;
            return { minimum: span(ca.center.clone().addScaledVector(radial, sign * ca.radius), cb.center.clone().addScaledVector(radial, sign * cb.radius)), maximum };
        }
        const x = (distance * distance + ca.radius * ca.radius - cb.radius * cb.radius) / (2 * distance), y = Math.sqrt(Math.max(0, ca.radius * ca.radius - x * x));
        const p = ca.center.clone().addScaledVector(radial, x).addScaledVector(ca.normal.clone().cross(radial), y);
        return { minimum: span(p, p.clone().addScaledVector(ca.normal, axial)), maximum };
    }
    const pa = samples(a), pb = samples(b);
    if (ca && pb.length) {
        const farthest = pb.map(point => analyticSpans(a, { id: 'point', label: '', kind: 'vertex', point }).maximum!).sort((a, b) => b.distance_mm - a.distance_mm)[0];
        return { maximum: { ...farthest, ...(b.approximate ? { approximate: true } : {}) } };
    }
    if (cb && pa.length) {
        const answer = analyticSpans(b, a).maximum;
        return { maximum: answer ? { ...answer, points: [answer.points[1], answer.points[0]] } : undefined };
    }
    let minimum: MeasuredSpan | undefined;
    if ((a.point || a.linearDirection && a.endpoints) && (b.point || b.linearDirection && b.endpoints))
        minimum = segmentDistance(pa[0], pa.at(-1)!, pb[0], pb.at(-1)!);
    let maximum: MeasuredSpan | undefined;
    if (pa.length && pb.length) {
        // Convex distances attain their maximum at a vertex. Curved tessellations are labelled estimates.
        const strideA = Math.max(1, Math.ceil(pa.length / 1800)), strideB = Math.max(1, Math.ceil(pb.length / 1800));
        const approximate = Boolean(a.approximate || b.approximate || strideA > 1 || strideB > 1);
        let best = -1, chosen: [
            Vec,
            Vec
        ] = [pa[0], pb[0]];
        for (let i = 0; i < pa.length; i += strideA)
            for (let j = 0; j < pb.length; j += strideB) {
                const distance = pa[i].reduce((sum, n, k) => sum + (n - pb[j][k]) ** 2, 0);
                if (distance > best) {
                    best = distance;
                    chosen = [pa[i], pb[j]];
                }
            }
        maximum = { distance_mm: Math.sqrt(best), points: chosen, ...(approximate ? { approximate } : {}) };
    }
    return { minimum, maximum };
}
/** Distance from analytic axes, or between actual centers. Camera changes never alter it. */
export function centerSpan(a: Entity, b: Entity): MeasuredSpan | null {
    const ca = a.point ?? a.axisOriginMillimeters ?? a.centerMillimeters, cb = b.point ?? b.axisOriginMillimeters ?? b.centerMillimeters;
    if (!ca || !cb)
        return null;
    const p = vector(ca), q = vector(cb), u = a.axisOriginMillimeters && a.axisDirection ? vector(a.axisDirection).normalize() : null, v = b.axisOriginMillimeters && b.axisDirection ? vector(b.axisDirection).normalize() : null;
    if (u && v) {
        const w = p.clone().sub(q), dot = u.dot(v), det = 1 - dot * dot;
        const t = det > EPS ? (dot * v.dot(w) - u.dot(w)) / det : -u.dot(w);
        const s = v.dot(w) + dot * t;
        return span(p.addScaledVector(u, t), q.addScaledVector(v, s));
    }
    if (u)
        return span(p.addScaledVector(u, q.clone().sub(p).dot(u)), q);
    if (v)
        return span(p, q.addScaledVector(v, p.clone().sub(q).dot(v)));
    return span(p, q);
}
/** Shared corners preserve the actual obtuse angle; unrelated edges remain unoriented. */
export function cornerAngle(a: Entity, b: Entity): {
    radians: number;
    points: Vec[];
} | null {
    if (!a.linearDirection || !b.linearDirection || !a.endpoints || !b.endpoints)
        return null;
    for (let i = 0; i < 2; i++)
        for (let j = 0; j < 2; j++) {
            const p = vector(a.endpoints[i]);
            if (p.distanceTo(vector(b.endpoints[j])) > 1e-7)
                continue;
            const u = vector(a.endpoints[1 - i]).sub(p), v = vector(b.endpoints[1 - j]).sub(p);
            if (u.length() < EPS || v.length() < EPS)
                return null;
            return { radians: u.angleTo(v), points: [a.endpoints[1 - i], a.endpoints[i], b.endpoints[1 - j]] };
        }
    return null;
}
