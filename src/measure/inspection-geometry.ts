import { Matrix4, Vector3 } from 'three';
import type { ConnectorCandidate, FaceTopologyData, PartGeometryData, Vec3 } from '@aether/core/contracts';
import type { CADSelectionItem } from '../cad-selection-store';
import { measurementsInWorld, type SelectedTopologyMeasurement } from '../viewport/topology-measurement';
import { selectedCandidateId } from '../viewport/topology-selection';
/** Read-only inspection metadata. Exact analytic values stay separate from mesh samples. */
export function inspectGeometry(data: PartGeometryData, matrix: Matrix4, item: CADSelectionItem): SelectedTopologyMeasurement | null {
    const face = data.topology.find(face => face.id === item.faceId);
    const candidateId = selectedCandidateId(item);
    const candidate = candidateId ? data.topology.flatMap(face => face.candidates).find(candidate => candidate.id === candidateId) : undefined;
    const source = item.kind === 'vertex' && candidate ? {} : item.kind === 'face' ? face?.measurements : candidate?.measurements;
    const world = (point: Vec3): Vec3 => new Vector3(...point).applyMatrix4(matrix).toArray();
    if (!source && item.kind !== 'body' && item.kind !== 'component')
        return null;
    const result: SelectedTopologyMeasurement = { id: item.id, label: item.label, kind: item.kind, ...measurementsInWorld(source ?? {}, matrix) };
    if (candidate?.id.startsWith('section-'))
        result.surfaceType = 'SECTION';
    const perimeter = (face: FaceTopologyData) => face.candidates.filter(candidate => candidate.kind === 'edge-midpoint').reduce((sum, candidate) => sum + (candidate.measurements?.lengthMillimeters ?? 0), 0);
    if (item.kind === 'face' && face) {
        result.surfaceType = face.surfaceType;
        result.perimeterMillimeters = (face as FaceTopologyData & {
            perimeterMillimeters?: number;
        }).perimeterMillimeters ?? perimeter(face);
        const axis = face.candidates.find(candidate => ['cylinder-axis', 'cone-axis'].includes(candidate.kind));
        if (axis) {
            result.axisDirection = new Vector3(...axis.zAxis).transformDirection(matrix).toArray();
            result.axisOriginMillimeters = world(axis.origin);
        }
    }
    if (candidate && item.kind === 'edge') {
        const edgeIndex = /(?:edge|circle|ellipse)-(\d+)$/.exec(candidate.id)?.[1];
        const owner = data.topology.find(face => face.id === candidate.faceId);
        const endpoint = (suffix: string): ConnectorCandidate | undefined => owner?.candidates.find(c => c.id === `face-${candidate.faceId}-vertex-${edgeIndex}-${suffix}`);
        const a = endpoint('a'), b = endpoint('b');
        if (a && b)
            result.endpoints = [world(a.origin), world(b.origin)];
        else if (source?.linearDirection && source.lengthMillimeters) {
            const center = new Vector3(...candidate.origin), delta = new Vector3(...source.linearDirection).multiplyScalar(source.lengthMillimeters / 2);
            result.endpoints = [world(center.clone().sub(delta).toArray()), world(center.add(delta).toArray())];
        }
        if (source?.radiusMillimeters && source.lengthMillimeters)
            result.fullCircle = Math.abs(source.lengthMillimeters - 2 * Math.PI * source.radiusMillimeters) < 1e-6 * Math.max(1, source.lengthMillimeters);
        result.centerMillimeters ??= world(candidate.origin);
    }
    if (['body', 'component', 'face'].includes(item.kind)) {
        const ranges = item.kind === 'face' ? data.faceRanges.filter(range => range.faceId === item.faceId) : data.faceRanges.length ? data.faceRanges : [{start:0,count:data.triangles.length,faceId:0}];
        const indices = new Set<number>();
        for (const range of ranges)
            for (let i = range.start; i < range.start + range.count; i++)
                indices.add(data.triangles[i]);
        result.samples = [...indices].map(index => world([data.vertices[index * 3], data.vertices[index * 3 + 1], data.vertices[index * 3 + 2]]));
        result.triangles = ranges.flatMap(range => Array.from({ length: Math.floor(range.count / 3) }, (_, i) => [0, 1, 2].map(k => {
            const index = data.triangles[range.start + i * 3 + k];
            return world([data.vertices[index * 3], data.vertices[index * 3 + 1], data.vertices[index * 3 + 2]]);
        }) as [
            Vec3,
            Vec3,
            Vec3
        ]));
        result.approximate = data.geometryKind === 'mesh' || (item.kind === 'face' ? [face!] : data.topology).some(face => face.surfaceType !== 'PLANE' || face.candidates.some(c => c.kind === 'circle-center' || c.kind === 'ellipse-center'));
        if (item.kind !== 'face') {
            const exact = data.topology.length > 0 && data.topology.every(face=>face.measurements?.areaSquareMillimeters !== undefined);
            result.areaApproximate = !exact;
            result.areaSquareMillimeters = exact ? data.topology.reduce((sum, face) => sum + face.measurements!.areaSquareMillimeters!, 0)
              : result.triangles.reduce((sum,[a,b,c])=>sum+new Vector3(...b).sub(new Vector3(...a)).cross(new Vector3(...c).sub(new Vector3(...a))).length()/2,0);
        }
    }
    else if (result.endpoints && result.linearDirection)
        result.samples = result.endpoints;
    return result;
}
