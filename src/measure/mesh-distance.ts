import { Box3, Ray, Triangle, Vector3 } from 'three';
import type { SelectedTopologyMeasurement } from '../viewport/topology-measurement';
import type { MeasurePoint as Vec } from './measurement-geometry';
import { segmentDistance, type MeasuredSpan } from './measurement-relations';
type Entity = SelectedTopologyMeasurement & {
    point?: Vec;
};
type Primitive = {
    points: Vec[];
    bounds: Box3;
};
const vector = (p: Vec) => new Vector3(...p);
function primitives(entity: Entity): Primitive[] {
    let points: Vec[][] = [];
    if (entity.point)
        points = [[entity.point]];
    else if (entity.triangles?.length)
        points = entity.triangles;
    else if (entity.endpoints && entity.linearDirection)
        points = [entity.endpoints];
    else if (entity.fullCircle && entity.radiusMillimeters && entity.centerMillimeters && entity.axisDirection) {
        const n = vector(entity.axisDirection).normalize(), x = (Math.abs(n.x) < .9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0));
        x.addScaledVector(n, -x.dot(n)).normalize();
        const y = n.clone().cross(x), origin = vector(entity.centerMillimeters), radius = entity.radiusMillimeters;
        const ring = Array.from({ length: 129 }, (_, i) => origin.clone().addScaledVector(x, radius * Math.cos(2 * Math.PI * i / 128)).addScaledVector(y, radius * Math.sin(2 * Math.PI * i / 128)).toArray());
        points = ring.slice(1).map((point, i) => [ring[i], point]);
    }
    return points.map(points => ({ points, bounds: new Box3().setFromPoints(points.map(vector)) }));
}
type BoundsNode = { bounds: Box3; count: number; leaves?: Primitive[]; children?: [BoundsNode, BoundsNode] };
function boundsTree(primitives: Primitive[]): BoundsNode {
    const bounds = primitives.reduce((bounds, primitive) => bounds.union(primitive.bounds), new Box3());
    if (primitives.length <= 8) return { bounds, count: primitives.length, leaves: primitives };
    const size = bounds.getSize(new Vector3()), axis = size.x >= size.y && size.x >= size.z ? 'x' : size.y >= size.z ? 'y' : 'z';
    primitives.sort((a,b) => a.bounds.min[axis] + a.bounds.max[axis] - b.bounds.min[axis] - b.bounds.max[axis]);
    const middle = Math.floor(primitives.length / 2);
    return { bounds, count: primitives.length, children: [boundsTree(primitives.slice(0,middle)), boundsTree(primitives.slice(middle))] };
}
const boxDistance = (a: Box3, b: Box3) => ['x', 'y', 'z'].reduce((sum, key) => {
    const axis = key as 'x' | 'y' | 'z', gap = Math.max(0, a.min[axis] - b.max[axis], b.min[axis] - a.max[axis]);
    return sum + gap * gap;
}, 0);
/** Distance on displayed surfaces, used for cap faces/meshes or when no exact Part query exists. */
export function meshSurfaceDistance(first: Entity, second: Entity): MeasuredSpan | null {
    const a = primitives(first), b = primitives(second);
    if (!a.length || !b.length)
        return null;
    let best = Infinity, pair: [
        Vec,
        Vec
    ] = [a[0].points[0], b[0].points[0]];
    const offer = (x: Vec, y: Vec) => { const d = x.reduce((sum, n, i) => sum + (n - y[i]) ** 2, 0); if (d < best) {
        best = d;
        pair = [x, y];
    } };
    const edges = (points: Vec[]) => points.length === 1 ? [[points[0], points[0]]] : points.length === 2 ? [points] : points.map((point, i) => [point, points[(i + 1) % 3]]);
    const vertexFace = (points: Vec[], face: Vec[], swap = false) => {
        if (face.length !== 3)
            return;
        const triangle = new Triangle(...face.map(vector) as [
            Vector3,
            Vector3,
            Vector3
        ]);
        for (const p of points) {
            const q = triangle.closestPointToPoint(vector(p), new Vector3()).toArray();
            swap ? offer(q, p) : offer(p, q);
        }
    };
    const edgeFace = (edge: Vec[], face: Vec[]) => {
        if (face.length !== 3)
            return;
        const start = vector(edge[0]), end = vector(edge[1]), direction = end.clone().sub(start), length = direction.length();
        if (length < 1e-12)
            return;
        const hit = new Ray(start, direction.divideScalar(length)).intersectTriangle(vector(face[0]), vector(face[1]), vector(face[2]), false, new Vector3());
        if (hit && hit.distanceTo(start) <= length + 1e-8)
            offer(hit.toArray(), hit.toArray());
    };
    const compare = (x: Primitive, y: Primitive) => {
            if (boxDistance(x.bounds, y.bounds) >= best) return;
            vertexFace(x.points, y.points);
            vertexFace(y.points, x.points, true);
            const ex = edges(x.points), ey = edges(y.points);
            for (const p of ex) {
                edgeFace(p, y.points);
                for (const q of ey) {
                    const value = segmentDistance(p[0], p[1], q[0], q[1]);
                    offer(...value.points);
                }
            }
            for (const q of ey)
                edgeFace(q, x.points);
    };
    // Bounds pruning considers every displayed triangle without sampling away small faces.
    const visit = (x: BoundsNode, y: BoundsNode): void => {
        if (boxDistance(x.bounds,y.bounds) >= best) return;
        if (x.leaves && y.leaves) {
            for (const a of x.leaves) for (const b of y.leaves) compare(a,b);
            return;
        }
        const splitX = !!x.children && (!y.children || x.count >= y.count);
        const pairs = splitX ? x.children!.map(child => [child,y] as const) : y.children!.map(child => [x,child] as const);
        pairs.sort((a,b) => boxDistance(a[0].bounds,a[1].bounds)-boxDistance(b[0].bounds,b[1].bounds));
        for (const [a,b] of pairs) visit(a,b);
    };
    visit(boundsTree(a),boundsTree(b));
    return Number.isFinite(best) ? { distance_mm: Math.sqrt(best), points: pair, approximate: true } : null;
}
