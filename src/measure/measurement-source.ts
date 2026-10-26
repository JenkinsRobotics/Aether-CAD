import { Matrix4, Vector3 } from 'three';
import { parsePartDocument, type PartDocument } from '@aether/core/document';
import type { AssemblyProjectionV1 } from '../cad-assembly-bridge';
import type { CADSelectionItem } from '../cad-selection-store';
import type { BodyProperties } from './measurement-report';
import type { MeasuredSpan } from './measurement-relations';
import { measureReference } from './measure-reference';
import { analyzePart } from '../modeling/part-analysis';
export interface MeasurementSource {
    document: PartDocument;
    bodyId: string;
    placement: Matrix4;
    instanceId?: string;
}
let resolveAssembly: (id: string) => MeasurementSource | null = () => null;
export function configureMeasurementSources(resolve: typeof resolveAssembly) { resolveAssembly = resolve; }
export function measurementSource(partId: string, document: PartDocument | null): MeasurementSource | null {
    return document ? { document, bodyId: partId, placement: new Matrix4() } : resolveAssembly(partId);
}
/** Keep source topology references while measuring the instance in its displayed placement. */
export function assemblyMeasurementSource(projection: AssemblyProjectionV1 | null, partId: string, placement: readonly number[] | null): MeasurementSource | null {
    if (!projection || !placement)
        return null;
    const instance = projection.instances.find(instance => partId.startsWith(`assembly:${instance.id}:`));
    const definition = instance && projection.part_definitions.find(definition => definition.id === instance.definition_id);
    if (!instance || !definition?.feature_document)
        return null;
    return { document: parsePartDocument(JSON.stringify(definition.feature_document)), bodyId: partId.slice(`assembly:${instance.id}:`.length),
        instanceId: instance.id, placement: new Matrix4().fromArray(placement) };
}
export async function sourceDistance(items: readonly CADSelectionItem[], sources: readonly (MeasurementSource | null)[], signal: AbortSignal): Promise<MeasuredSpan | null> {
    const [a, b] = sources;
    if (items.length !== 2 || !a || !b || a.document.documentId !== b.document.documentId || a.instanceId !== b.instanceId)
        return null;
    const references = items.map((item, index) => { const ref = measureReference(item); return ref ? { ...ref, body_id: sources[index]!.bodyId } : null; });
    if (references.some(ref => !ref))
        return null;
    const result = await analyzePart(a.document, { kind: 'distance', entities: references as object[] }, signal);
    const span = result.measurements[0] as unknown as MeasuredSpan | undefined;
    if (!span)
        return null;
    const world = (point: MeasuredSpan['points'][number]) => new Vector3(...point).applyMatrix4(a.placement).toArray();
    return { ...span, points: [world(span.points[0]), world(span.points[1])] };
}
export async function sourceProperties(items: readonly CADSelectionItem[], sources: readonly (MeasurementSource | null)[], signal: AbortSignal): Promise<BodyProperties[]> {
    const cache = new Map<PartDocument, Promise<BodyProperties[]>>();
    return (await Promise.all(items.map(async (item, index) => {
        const source = sources[index];
        if (!source || !['body', 'component'].includes(item.kind))
            return [];
        let pending = cache.get(source.document);
        if (!pending) {
            pending = analyzePart(source.document, { kind: 'properties', bodyIds: [source.bodyId] }, signal).then(result => result.measurements as unknown as BodyProperties[]);
            cache.set(source.document, pending);
        }
        const body = (await pending).find(body => body.body_id === source.bodyId);
        if (!body)
            return [];
        return [{ ...body, body_id: item.partId, boundsInPartCoordinates: !!source.instanceId, center_mm: new Vector3(...body.center_mm).applyMatrix4(source.placement).toArray() }];
    }))).flat();
}
