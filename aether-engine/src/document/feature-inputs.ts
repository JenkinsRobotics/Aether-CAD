import type { PartFeature } from './part-document';
import { pierceDependencies } from '../sketch/reference/pierce-context';

/** Explicit inputs only. Body ownership, implicit legacy targets and consumed
 * bodies belong to the ordered history evaluator, not this reference reader.
 * Never scan an entire feature: output IDs, imported payloads and cached
 * geometry are not dependencies. */
export function featureInputDependencies(
  feature: PartFeature,
  bodyProducers: ReadonlyMap<string, string>,
): string[] {
  const inputs = new Set<string>();
  const body = (id: string) => inputs.add(bodyProducers.get(id) ?? `body:${id}`);

  // These subtrees are typed reference contracts. Keep source feature identity
  // even when its body has since been modified; only legacy picked references
  // (partId) resolve through the body state at this point in the history.
  const reference = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(reference); return; }
    const record = value as Record<string, unknown>;
    for (const key of ['sourceFeatureId', 'featureId', 'profileFeatureId', 'pathFeatureId']) {
      if (typeof record[key] === 'string') inputs.add(record[key]);
    }
    if (['face', 'point', 'axis', 'surface-point'].includes(String(record.kind)) && typeof record.partId === 'string') body(record.partId);
    Object.values(record).forEach(reference);
  };

  if ('profileFeatureId' in feature && feature.profileFeatureId) inputs.add(feature.profileFeatureId);
  if ('sourceFeatureId' in feature && feature.sourceFeatureId) inputs.add(feature.sourceFeatureId);
  if ('pathFeatureId' in feature) inputs.add(feature.pathFeatureId);
  if ('bodyIds' in feature) feature.bodyIds?.forEach(body);
  if ('toolBodyIds' in feature) feature.toolBodyIds.forEach(body);
  if ('definition' in feature) reference(feature.definition);
  if ('transform' in feature) reference(feature.transform);
  if ('axisReference' in feature) reference(feature.axisReference);
  if ('faces' in feature) reference(feature.faces);
  if ('face' in feature) reference(feature.face);
  if ('edges' in feature) reference(feature.edges);
  if ('sections' in feature) reference(feature.sections);

  switch (feature.type) {
    case 'profile': {
      reference(feature.support);
      if (feature.profile.type === 'projection') inputs.add(feature.profile.sourceFeatureId);
      const drawing = feature.profile.type === 'drawing' ? feature.profile
        : feature.profile.type === 'projection' ? feature.profile.authored : undefined;
      if (drawing) pierceDependencies(drawing).forEach(id => inputs.add(id));
      break;
    }
    case 'extrude':
      reference(feature.profileSelections);
      reference(feature.startingReference);
      reference(feature.directionReference);
      for (const end of [feature, feature.secondEnd]) {
        if (end?.endType === 'up-to-face') reference(end.endReference);
        if (end?.endType === 'up-to-vertex') reference(end.endPointReference);
        if (end?.endType === 'up-to-part' && end.endPartId) body(end.endPartId);
        if (end?.endType === 'up-to-next') bodyProducers.forEach(id => inputs.add(id));
      }
      break;
    case 'pattern':
      if (feature.patternType === 'linear') {
        reference(feature.direction);
        reference(feature.second?.direction);
      }
      if (feature.patternType === 'polar') reference(feature.axisReference);
      break;
    case 'split': reference(feature.plane); reference(feature.tool); break;
    case 'split-face': case 'surface-trim': reference(feature.plane); break;
    case 'mirror': reference(feature.mirrorPlane); break;
    case 'offset-face': reference(feature.replaceWith); break;
    case 'chamfer': reference(feature.referenceFace); break;
    case 'shell': reference(feature.removedFaces); break;
    case 'draft': reference(feature.neutralFace); reference(feature.pullPlane); reference(feature.partingEdges); break;
    case 'loft': reference(feature.startPoint); reference(feature.endPoint); reference(feature.path); reference(feature.connections); break;
    case 'sweep': reference(feature.rail); reference(feature.orientation); break;
    case 'hole': reference(feature.placement); reference(feature.endReference); if (typeof feature.startFrom === 'object') reference(feature.startFrom.plane); break;
    case 'sheet-fold': reference(feature.line); break;
    case 'surface-blend':
      for (const side of [feature.from, feature.to]) { body(side.bodyId); reference(side.edges); }
      break;
  }
  return [...inputs];
}
