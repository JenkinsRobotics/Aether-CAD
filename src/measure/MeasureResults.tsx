import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { PropertyGrid } from "@aether/ui";
import { unitChoice, type UnitPreferences } from "@aether/core/units";
import type { PartDocument } from "@aether/core/document";
import { cadSelection, type CADSelectionStore } from "../cad-selection-store";
import { documentUnits } from "../document-preferences";
import { measurementSource, sourceDistance, sourceProperties } from './measurement-source';
import { type SelectedTopologyMeasurement } from "../viewport/topology-measurement";
import { measureReference } from "./measure-reference";
import { type MeasurePoint as Vec, type MeasurementMode } from "./measurement-geometry";
import type { MeasurementAnnotation } from "./measurement-overlay";
type Point = {
    selectionId?: string;
    candidateId: string;
    partId: string;
    positionMillimeters: Vec;
};
type Distance = {
    distance_mm: number;
    points: [
        Vec,
        Vec
    ];
};
export type { MeasureType } from './measurement-report';
import { measurementReport, type MeasureType, type MeasureFamily } from './measurement-report';
import { MeasurementValue } from './MeasurementValue';
import type { MeasurementFrame } from './measurement-frame';
import type { CADSelectionItem } from '../cad-selection-store';
export function MeasureResults({ currentPart, entities, type, lengthUnit, angleUnit, mode, annotate, selection = cadSelection, precision, referenceItem }: {
    precision?: number | "full";
    referenceItem?: CADSelectionItem | null;
    selection?: Pick<CADSelectionStore, "snapshot" | "subscribe" | "dispatch">;
    currentPart: () => PartDocument | null;
    entities: {
        render: (rows: {
            label: string;
            onRemove: () => void;
        }[]) => void;
    };
    type: MeasureType;
    lengthUnit: string;
    angleUnit: string;
    mode: MeasurementMode;
    annotate: (annotation: readonly MeasurementAnnotation[] | null) => void;
}) {
    const { items } = useSyncExternalStore(selection.subscribe, selection.snapshot, selection.snapshot);
    useEffect(() => entities.render(items.map(item => ({ label: item.label, onRemove: () => selection.dispatch({ type: "toggle", items: [item] }) }))), [entities, items]);
    // The part rebuilds after edits: re-read geometry and re-measure.
    const [revision, setRevision] = useState(0);
    const [geometryRevision, setGeometryRevision] = useState(0);
    useEffect(() => { const refresh = () => setGeometryRevision(value => value + 1); window.addEventListener('aether-inspection-geometry-updated', refresh); return () => window.removeEventListener('aether-inspection-geometry-updated', refresh); }, []);
    useEffect(() => {
        const bump = () => setRevision(value => value + 1);
        const events = ['aether-part-updated', 'aether-assembly-geometry-updated'];
        events.forEach(event => window.addEventListener(event, bump));
        return () => events.forEach(event => window.removeEventListener(event, bump));
    }, []);
    const [geometry, setGeometry] = useState<{
        points: Point[];
        measurements: SelectedTopologyMeasurement[];
    }>({ points: [], measurements: [] });
    useEffect(() => {
        window.dispatchEvent(new CustomEvent("aether-plane-geometry-request", { detail: { items,
                respond: (detail: {
                    points?: Point[];
                    measurements?: SelectedTopologyMeasurement[];
                }) => setGeometry({ points: detail.points ?? [], measurements: detail.measurements ?? [] }),
            } }));
    }, [items, revision, geometryRevision]);
    const references = mode === "Objects" && items.length === 2 ? items.map(measureReference) : [];
    const sources = items.map(item => measurementSource(item.partId, currentPart()));
    const key = JSON.stringify([references, revision, currentPart()?.documentId]);
    const [distance, setDistance] = useState<{
        key: string;
        value?: Distance;
        error?: string;
    } | null>(null);
    useEffect(() => {
        if (references.length !== 2 || references.some(reference => !reference) || sources.some(source => !source)) {
            setDistance(null);
            return;
        }
        const controller = new AbortController();
        setDistance({ key });
        sourceDistance(items, sources, controller.signal)
            .then(result => { if (!controller.signal.aborted)
            setDistance(result ? { key, value: result } : { key, error: 'Exact solid distance unavailable' }); })
            .catch(error => { if (!controller.signal.aborted)
            setDistance({ key, error: error instanceof Error ? error.message : String(error) }); });
        return () => controller.abort();
    }, [key]);
    const bodyIds = mode === "Objects" ? [...new Set(items.filter(item => ['body', 'component'].includes(item.kind)).map(item => item.partId))] : [];
    const propertiesKey = JSON.stringify([bodyIds, revision, currentPart()?.documentId]);
    type BodyProperties = {
        body_id: string;
        volume_mm3: number;
        area_mm2: number;
        center_mm: Vec;
        bounds_mm: Vec;
    };
    const [physical, setPhysical] = useState<{
        key: string;
        values?: BodyProperties[];
        error?: string;
    } | null>(null);
    useEffect(() => {
        if (!bodyIds.length || !sources.some(source => source)) {
            setPhysical(null);
            return;
        }
        const controller = new AbortController();
        setPhysical({ key: propertiesKey });
        sourceProperties(items, sources, controller.signal)
            .then(values => { if (!controller.signal.aborted)
            setPhysical({ key: propertiesKey, values }); })
            .catch(error => { if (!controller.signal.aborted)
            setPhysical({ key: propertiesKey, error: error instanceof Error ? error.message : String(error) }); });
        return () => controller.abort();
    }, [propertiesKey]);
    const [reference, setReference] = useState<MeasurementFrame | null>(null);
    useEffect(() => {
        if (!referenceItem) {
            setReference(null);
            return;
        }
        window.dispatchEvent(new CustomEvent('aether-measure-frame', { detail: { item: referenceItem, respond: setReference } }));
    }, [referenceItem, revision, geometryRevision]);
    const base = documentUnits();
    const preferences: UnitPreferences = { ...base,
        length: { unit: lengthUnit, decimals: typeof precision === 'number' ? precision : unitChoice(base, "length").decimals },
        angle: { unit: angleUnit, decimals: typeof precision === 'number' ? precision : unitChoice(base, "angle").decimals } };
    const factor = unitChoice(preferences, "length").factor * 1000;
    const angleFactor = unitChoice(preferences, 'angle').factor;
    const convert = (value: number, family: MeasureFamily) => family === 'angle' ? value / angleFactor : value / factor ** ({ length: 1, area: 2, volume: 3 }[family]);
    const unit = (family: MeasureFamily) => family === 'angle' ? angleUnit : lengthUnit + (family === 'area' ? '²' : family === 'volume' ? '³' : '');
    const format = (value: number, family: MeasureFamily, full = false) => {
        const converted = convert(value, family);
        const digits = family === 'angle' ? unitChoice(preferences, 'angle').decimals : unitChoice(preferences, 'length').decimals;
        const text = full || precision === 'full' ? Number(converted.toPrecision(15)).toString() : converted.toFixed(digits).replace(/^-0(?=\.0+$|$)/, '0');
        return `${text} ${unit(family)}`;
    };
    const report = useMemo(() => measurementReport({ items, ...geometry,
        minimum: distance?.key === key ? distance.value : undefined,
        physical: physical?.key === propertiesKey ? physical.values : undefined,
        distanceStatus: references.length !== 2 || references.some(ref => !ref) || sources.some(source => !source) ? 'Exact solid distance unavailable' : distance?.key === key ? distance.error ?? 'Measuring…' : 'Measuring…',
        propertiesStatus: !sources.some(source => source) ? 'Exact solid properties unavailable' : physical?.key === propertiesKey ? physical.error ?? 'Measuring…' : 'Measuring…',
        type, mode, frame: reference }), [items, geometry, distance, physical, key, propertiesKey, type, mode, reference]);
    const context = JSON.stringify([items.map(item => item.id), mode]);
    const [pins, setPins] = useState<{
        context: string;
        ids: string[];
    }>({ context: '', ids: [] });
    const [hover, setHover] = useState<string | null>(null);
    const annotations = new Map<string, MeasurementAnnotation>();
    const sections = report.map(section => ({ id: section.id, label: section.label, properties: section.rows.map(row => {
            const id = `${section.id}/${row.id}`, text = row.value === undefined ? row.text ?? '—' : `${row.approximate ? '≈ ' : ''}${format(row.value, row.family!)}`;
            const annotation = row.annotation ? { ...row.annotation, label: text } : undefined;
            if (annotation)
                annotations.set(id, annotation);
            const pinned = pins.context === context && pins.ids.includes(id);
            return { id: row.id, label: row.label, readOnly: true, editor: <MeasurementValue text={text} fullText={row.value === undefined ? undefined : `${row.approximate ? '≈ ' : ''}${format(row.value, row.family!, true)}`} label={`${section.label}: ${row.label}`} annotation={annotation} pinned={pinned} onPreview={value => setHover(value ? id : null)} onPin={() => setPins(current => { const ids = current.context === context ? current.ids : []; return { context, ids: ids.includes(id) ? ids.filter(key => key !== id) : [...ids, id] }; })}/> };
        }) }));
    const defaultId = mode !== 'Objects' ? 'points/' + (mode === '3-point angle' ? 'angle' : 'distance') : type === 'Center' ? 'center/distance' : type === 'Maximum' ? 'maximum/distance' : 'minimum/distance';
    const visibleIds = [...new Set([...(pins.context === context ? pins.ids : []), hover ?? defaultId])];
    const overlays = visibleIds.flatMap(id => annotations.get(id) ?? []);
    const annotationKey = JSON.stringify(overlays);
    useEffect(() => { annotate(overlays); return () => annotate(null); }, [annotationKey, annotate]);
    const pointCount = items.filter(item => geometry.points.some(point => (point.selectionId ?? `vertex:${point.partId}:${point.candidateId}`) === item.id)).length;
    const required = mode === '3-point angle' ? 3 : 2;
    const pending = mode !== 'Objects' && (items.length !== required || pointCount !== required) ? `${pointCount} / ${required} points selected` : null;
    return <>{referenceItem && !reference && <p role="status" className="cad-measure-hint">Reference unavailable</p>}{pending && <p className="cad-measure-hint" role="status">{pending}</p>}{sections.length ? <PropertyGrid ariaLabel="Measurements" sections={sections}/> : null}</>;
}
