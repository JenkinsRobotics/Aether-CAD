import { Vector3, type BufferGeometry } from 'three';
import type { ConnectorCandidate, FaceTopologyData, PartGeometryData } from '@aether/core/contracts';
/** Transient cap topology is for inspection only: it never becomes a modeling reference. */
export function sectionInspectionGeometry(geometry: BufferGeometry, source: PartGeometryData, cutIds: readonly string[]): PartGeometryData {
    const positions = geometry.getAttribute('position'), topology: FaceTopologyData[] = [], faceRanges: PartGeometryData['faceRanges'] = [];
    if (!positions)
        return { ...source, vertices: new Float32Array(), normals: new Float32Array(), triangles: new Uint32Array(), edgeLines: new Float32Array(), topology, faceRanges };
    const edgeLines: number[] = [];
    geometry.groups.forEach((group, index) => {
        if (!group.count)
            return;
        const cutId = cutIds[index] ?? String(index), number = Number(cutId.match(/\d+$/)?.[0] ?? index), faceId = Number.MAX_SAFE_INTEGER - number;
        const points: Vector3[] = [], ids = new Map<string, number>(), edges = new Map<string, {
            a: number;
            b: number;
            count: number;
        }>();
        const vertex = (v: Vector3) => { const key = v.toArray().map(n => Math.round(n * 1e6)).join(','); let id = ids.get(key); if (id === undefined) {
            id = points.length;
            points.push(v);
            ids.set(key, id);
        } return id; };
        let area = 0;
        const centroid = new Vector3(), normal = new Vector3();
        for (let i = group.start; i < group.start + group.count; i += 3) {
            const tri = [0, 1, 2].map(k => new Vector3().fromBufferAttribute(positions, i + k));
            const cross = tri[1].clone().sub(tri[0]).cross(tri[2].clone().sub(tri[0])), size = cross.length() / 2;
            if (!size)
                continue;
            area += size;
            normal.add(cross);
            centroid.add(tri[0].clone().add(tri[1]).add(tri[2]).multiplyScalar(size / 3));
            const v = tri.map(vertex);
            v.forEach((a, k) => { const b = v[(k + 1) % 3], key = [a, b].sort((a, b) => a - b).join(','); const edge = edges.get(key); if (edge)
                edge.count++;
            else
                edges.set(key, { a, b, count: 1 }); });
        }
        if (area <= 1e-12)
            return;
        centroid.divideScalar(area);
        normal.normalize();
        const x = (Math.abs(normal.x) < .9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0)).addScaledVector(normal, -(Math.abs(normal.x) < .9 ? normal.x : normal.y)).normalize(), y = normal.clone().cross(x);
        const axes = { xAxis: x.toArray(), yAxis: y.toArray(), zAxis: normal.toArray() }, candidates: ConnectorCandidate[] = [];
        const boundary = [...edges.values()].filter(edge => edge.count === 1), adjacent = new Map<number, number[]>();
        boundary.forEach(({ a, b }) => { adjacent.set(a, [...(adjacent.get(a) ?? []), b]); adjacent.set(b, [...(adjacent.get(b) ?? []), a]); });
        // Only geometric corners survive; subdivision points on straight boundaries are not anchors.
        const corners = [...adjacent].filter(([id, neighbors]) => neighbors.length !== 2 || Math.abs(points[neighbors[0]].clone().sub(points[id]).normalize().dot(points[neighbors[1]].clone().sub(points[id]).normalize())) < 1 - 1e-8).map(([id]) => id);
        let perimeter = 0;
        boundary.forEach(({ a, b }) => { perimeter += points[a].distanceTo(points[b]); edgeLines.push(...points[a].toArray(), ...points[b].toArray()); });
        candidates.push({ id: `section-${cutId}-center`, faceId, kind: 'face-center', label: 'Section center', origin: centroid.toArray(), ...axes });
        corners.forEach((id, i) => candidates.push({ id: `section-${cutId}-vertex-${i}`, faceId, kind: 'vertex', label: `Section corner ${i + 1}`, origin: points[id].toArray(), ...axes }));
        const cornerSet = new Set(corners), seen = new Set<string>();
        for (const start of corners)
            for (const neighbor of adjacent.get(start) ?? []) {
                let before = start, current = neighbor, steps = 0;
                while (!cornerSet.has(current) && steps++ <= boundary.length) {
                    const next = adjacent.get(current)?.find(id => id !== before);
                    if (next === undefined)
                        break;
                    before = current;
                    current = next;
                }
                if (!cornerSet.has(current) || current === start)
                    continue;
                const key = [start, current].sort((a, b) => a - b).join(',');
                if (seen.has(key))
                    continue;
                seen.add(key);
                const a = points[start], b = points[current], middle = a.clone().add(b).multiplyScalar(.5);
                candidates.push({ id: `section-${cutId}-edge-${seen.size}`, faceId, kind: 'edge-midpoint', label: `Section edge ${seen.size}`, origin: middle.toArray(), ...axes,
                    measurements: { lengthMillimeters: a.distanceTo(b), linearDirection: b.clone().sub(a).normalize().toArray(), centerMillimeters: middle.toArray() } });
            }
        topology.push({ id: faceId, surfaceType: 'SECTION', measurements: { areaSquareMillimeters: area, centerMillimeters: centroid.toArray(), planarNormal: normal.toArray() }, candidates });
        // Kept apart from native geometry contracts; inspection consumes this transient extension.
        Object.assign(topology.at(-1)!, { perimeterMillimeters: perimeter });
        faceRanges.push({ start: group.start, count: group.count, faceId });
    });
    return { ...source, vertices: new Float32Array(positions.array), normals: new Float32Array(geometry.getAttribute('normal').array), triangles: Uint32Array.from({ length: positions.count }, (_, i) => i), edgeLines: new Float32Array(edgeLines), topology, faceRanges };
}
