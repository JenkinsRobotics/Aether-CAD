import type { CADSelectionItem } from '../cad-selection-store';
import { selectedTopologyAngle, type SelectedTopologyMeasurement } from '../viewport/topology-measurement';
import { analyticSpans, centerSpan, cornerAngle, type MeasuredSpan } from './measurement-relations';
import { frameCoordinates, framePoint, type MeasurementFrame } from './measurement-frame';
import { pointDistance, threePointAngle, type MeasurePoint as Vec, type MeasurementMode } from './measurement-geometry';
import type { MeasurementAnnotation } from './measurement-overlay';
import { meshSurfaceDistance } from './mesh-distance';
import { radiusAnnotation } from './measurement-annotations';
export const MEASURE_TYPES = ['Show all', 'Minimum', 'Maximum', 'Center', 'Position', 'Length', 'Radius', 'Diameter', 'Angle', 'Surface area', 'Volume'] as const;
export type MeasureType = typeof MEASURE_TYPES[number];
export type MeasureFamily = 'length' | 'area' | 'volume' | 'angle';
export interface MeasureRow {
    id: string;
    label: string;
    value?: number;
    family?: MeasureFamily;
    text?: string;
    annotation?: MeasurementAnnotation;
    approximate?: boolean;
}
export interface MeasureSection {
    id: string;
    label: string;
    rows: MeasureRow[];
}
export interface MeasurePoint {
    selectionId?: string;
    candidateId: string;
    partId: string;
    positionMillimeters: Vec;
}
export interface BodyProperties {
    body_id: string;
    volume_mm3: number;
    area_mm2: number;
    center_mm: Vec;
    bounds_mm: Vec;
    boundsInPartCoordinates?: boolean;
}
export interface ReportInput {
    items: readonly CADSelectionItem[];
    points: MeasurePoint[];
    measurements: SelectedTopologyMeasurement[];
    physical?: BodyProperties[];
    minimum?: MeasuredSpan;
    distanceStatus?: string;
    propertiesStatus?: string;
    mode: MeasurementMode;
    type: MeasureType;
    frame?: MeasurementFrame | null;
}
/** Product-owned readouts in canonical mm/radians; formatting and copying are presentation. */
export function measurementReport(input: ReportInput): MeasureSection[] {
    const { items, type, mode, frame } = input, sections: MeasureSection[] = [];
    const shows = (name: MeasureType) => type === 'Show all' || type === name;
    const pointOf = (id: string) => input.points.find(p => (p.selectionId ?? `vertex:${p.partId}:${p.candidateId}`) === id)?.positionMillimeters;
    const measured = (item: CADSelectionItem) => input.measurements.find(m => m.id === item.id);
    const properties = (item: CADSelectionItem) => ['body', 'component'].includes(item.kind) ? input.physical?.find(p => p.body_id === item.partId) : undefined;
    const entities = items.map(item => ({ ...measured(item), id: item.id, kind: item.kind, label: item.label, point: pointOf(item.id),
        centerMillimeters: measured(item)?.centerMillimeters ?? properties(item)?.center_mm }));
    const row = (id: string, label: string, value: number, family: MeasureFamily = 'length', annotation?: MeasurementAnnotation): MeasureRow => ({ id, label, value, family, annotation });
    const coordinateRows = (point: Vec, prefix = ''): MeasureRow[] => frameCoordinates(point, frame).map((v, i) => row(`position-${i}`, `${prefix}${'XYZ'[i]}`, v));
    const spanSection = (id: string, label: string, value: MeasuredSpan) => {
        const [a, b] = value.points, localA = frameCoordinates(a, frame), localB = frameCoordinates(b, frame);
        const delta = localB.map((n, i) => n - localA[i]);
        sections.push({ id, label, rows: [{ ...row('distance', 'Distance', value.distance_mm, 'length', { points: [a, b] }), approximate: value.approximate },
                ...delta.map((v, i) => { const p = [...localA] as [
                    number,
                    number,
                    number
                ]; p[i] = localB[i]; return { ...row(`delta-${i}`, `Δ${'XYZ'[i]}`, v, 'length', { points: [a, framePoint(p, frame)], axis: i as 0 | 1 | 2 }), approximate: value.approximate }; })] });
    };
    if (mode !== 'Objects') {
        const points = items.map(item => pointOf(item.id)).filter((p): p is Vec => !!p), required = mode === '3-point angle' ? 3 : 2;
        if (points.length !== required || items.length !== required)
            return sections;
        const approximate = input.points.some(point => point.candidateId.startsWith('section-'));
        if (mode === 'Point-to-point')
            spanSection('points', 'Point-to-point distance', { distance_mm: pointDistance(points[0], points[1]), points: [points[0], points[1]], approximate });
        else {
            const angle = threePointAngle(points[0], points[1], points[2]);
            sections.push({ id: 'points', label: '3-point angle', rows: angle === null ? [{ id: 'invalid', label: 'Angle', text: 'Coincident points' }] : [{ ...row('angle', 'Angle', angle, 'angle', { points, angle: true }), approximate }] });
        }
        return sections;
    }
    if (items.length === 2) {
        const [a, b] = entities, derived = analyticSpans(a, b), minimum = input.minimum ?? derived.minimum ?? meshSurfaceDistance(a, b);
        if (shows('Minimum')) {
            if (minimum)
                spanSection('minimum', minimum.approximate ? 'Surface distance (mesh)' : 'Minimum distance', minimum);
            else if (input.distanceStatus)
                sections.push({ id: 'minimum', label: 'Minimum distance', rows: [{ id: 'distance', label: 'Distance', text: input.distanceStatus }] });
        }
        if (shows('Maximum') && derived.maximum)
            spanSection('maximum', 'Maximum distance', derived.maximum);
        const center = centerSpan(a, b);
        if (shows('Center') && center)
            spanSection('center', a.axisOriginMillimeters || b.axisOriginMillimeters ? 'Center axes distance' : 'Center distance', center);
        if (shows('Angle')) {
            const corner = cornerAngle(a, b), angle = selectedTopologyAngle(entities);
            if (corner || angle)
                sections.push({ id: 'angle', label: corner ? 'Angle at shared corner' : angle!.label, rows: [row('angle', 'Angle', corner?.radians ?? angle!.radians, 'angle', corner ? { points: corner.points, angle: true } : undefined)] });
        }
    }
    if (items.length > 1) {
        const rows: MeasureRow[] = [];
        const sum = (property: 'lengthMillimeters' | 'areaSquareMillimeters') => entities.reduce((total, m) => total + (m[property] ?? 0), 0);
        if (shows('Length') && entities.filter(m => m.kind === 'edge' && m.lengthMillimeters !== undefined).length > 1)
            rows.push(row('length', 'Total length', sum('lengthMillimeters')));
        if (shows('Surface area') && entities.filter(m => m.areaSquareMillimeters !== undefined).length > 1)
            rows.push({...row('area', 'Total surface area', sum('areaSquareMillimeters'), 'area'),approximate:entities.some(m=>m.areaApproximate||m.surfaceType==='SECTION')});
        const bodies = [...new Set(items.filter(item => ['body', 'component'].includes(item.kind)).map(item => item.partId))].flatMap(id => input.physical?.find(p => p.body_id === id) ?? []);
        if (shows('Volume') && bodies.length > 1)
            rows.push(row('volume', 'Total volume', bodies.reduce((total, b) => total + b.volume_mm3, 0), 'volume'));
        if (rows.length)
            sections.push({ id: 'totals', label: `Selection totals (${items.length})`, rows });
    }
    for (const item of items) {
        const m = measured(item), point = pointOf(item.id), body = properties(item), rows: MeasureRow[] = [];
        if (shows('Position')) {
            if (point)
                rows.push(...coordinateRows(point));
            else if (m?.centerMillimeters && !body)
                rows.push(...coordinateRows(m.centerMillimeters, 'Center '));
        }
        if (shows('Length') && m?.lengthMillimeters !== undefined)
            rows.push(row('length', 'Length', m.lengthMillimeters, 'length', m.linearDirection && m.endpoints ? {points:m.endpoints} : undefined));
        if (shows('Length') && m?.perimeterMillimeters !== undefined)
            rows.push(row('perimeter', 'Perimeter', m.perimeterMillimeters));
        if (shows('Radius') && m?.radiusMillimeters !== undefined)
            rows.push(row('radius', 'Radius', m.radiusMillimeters, 'length', radiusAnnotation(m)));
        if (shows('Diameter') && m?.radiusMillimeters !== undefined)
            rows.push(row('diameter', 'Diameter', 2 * m.radiusMillimeters, 'length', radiusAnnotation(m,true)));
        if (shows('Angle') && m?.radiusMillimeters && m.lengthMillimeters && !m.fullCircle && item.kind === 'edge')
            rows.push(row('sweep', 'Arc sweep', m.lengthMillimeters / m.radiusMillimeters, 'angle'));
        if (shows('Surface area') && m?.areaSquareMillimeters !== undefined && !body)
            rows.push({...row('area', 'Area', m.areaSquareMillimeters, 'area'),approximate:m.areaApproximate});
        if (body) {
            if (shows('Volume'))
                rows.push(row('volume', 'Volume', body.volume_mm3, 'volume'));
            if (shows('Surface area'))
                rows.push(row('area', 'Surface area', body.area_mm2, 'area'));
            if (shows('Length'))
                rows.push(...body.bounds_mm.map((v, i) => row(`bounds-${i}`, `${body.boundsInPartCoordinates ? 'Local ' : ''}${'XYZ'[i]} size`, v)));
            if (shows('Position'))
                rows.push(...coordinateRows(body.center_mm, 'Center '));
        }
        else if (['body', 'component'].includes(item.kind) && input.propertiesStatus && ['Show all', 'Volume'].includes(type))
            rows.push({ id: 'pending', label: 'Properties', text: input.propertiesStatus });
        if (rows.length)
            sections.push({ id: item.id, label: item.label, rows: rows.map(row => m?.surfaceType === 'SECTION' && row.value !== undefined ? { ...row, approximate: true } : row) });
    }
    return sections;
}
