import {transformReferences} from './part-transform';
import {offsetFaceBodies} from './offset-face';
import {scopeConsumedBodies} from './extrusion-scope';
import { featureReferenceErrors } from "./feature-errors";
import { pierceDependencies } from '../../../freecad-engine/browser/pierce-context';
import {
  validatePartDocument,
  type PartDocument,
  type PartFeature,
} from "./part-document";
export const rollbackPosition = (doc: PartDocument) =>
  doc.rollbackIndex ?? doc.features.length;
export function bodyIDForFeature(
  doc: PartDocument,
  feature: PartFeature,
): string {
  if (
    (feature.type === "extrude" || feature.type === "revolve" || feature.type === "sweep" || feature.type === "loft" || feature.type === "import-step" || feature.type === "import-cad") &&
    feature.bodyId
  )
    return feature.bodyId;
  const first = doc.features.find(
    (f) =>
      (f.type === "extrude" || f.type === "revolve" || f.type === "sweep" || f.type === "loft" || f.type === "import-step" || f.type === "import-cad") && f.operation === "new",
  );
  return first?.id === feature.id
    ? `${doc.documentId}:body-1`
    : `${doc.documentId}:body-${feature.id}`;
}
export function bodyIDsForFeature(doc: PartDocument, feature: PartFeature): string[] {
  if(feature.type==="transform")return feature.copyBodyIds?feature.bodyIds.map(id=>feature.copyBodyIds![id]):[];
  return feature.type === "extrude" && feature.separateBodies && feature.bodyOutputs
    ? feature.bodyOutputs : [bodyIDForFeature(doc, feature)];
}
/** Bodies created by this feature, separate from bodies modified in place. */
export function createdBodyIDs(doc:PartDocument,feature:PartFeature):string[] {
 return feature.type==='transform'&&feature.copyBodyIds ? bodyIDsForFeature(doc,feature) :
  'operation' in feature&&feature.operation==='new' ? bodyIDsForFeature(doc,feature) : [];
}
/** Current output identities absorbed by a feature; original producers persist. */
export function consumedBodyIDs(feature: PartFeature): string[] {
  if (feature.suppressed) return [];
  if (feature.type==="extrude" && feature.scopeMode==="all")return scopeConsumedBodies(feature.scopeResolution);
  if (feature.type === "boolean" && !feature.keepTools) return feature.toolBodyIds;
  return feature.type === "extrude" && feature.operation === "add" ? feature.targetBodyIds?.slice(1) ?? [] : [];
}
function stableBodies(doc: PartDocument): PartDocument {
  let targetBody: string | undefined;
  return {
    ...structuredClone(doc),
    features: doc.features.map((f) => {
      const feature = structuredClone(f);
      if(feature.type==="extrude"&&feature.scopeMode==="all"){
        if(!feature.suppressed)targetBody=feature.scopeResolution?.groups.at(-1)?.bodyId??targetBody;
        return feature;
      }
      if(feature.type==="transform"){
        if(!feature.suppressed&&feature.copyBodyIds)targetBody=bodyIDsForFeature(doc,feature).at(-1);
        return feature;
      }
      if (feature.type === "offset-face") return feature;
      if (consumedBodyIDs(feature).length && "targetBodyId" in feature) targetBody = feature.targetBodyId;
      if ((feature.type === "extrude" || feature.type === "revolve" || feature.type === "sweep" || feature.type === "loft" || feature.type === "import-step" || feature.type === "import-cad") && feature.operation === "new") {
        targetBody = bodyIDsForFeature(doc, feature).at(-1);
        return { ...feature, bodyId: bodyIDForFeature(doc, feature) };
      }
      // Pin legacy implicit targets before removing/reordering their producer.
      // Otherwise the same operation could silently switch to another body.
      if (!["profile", "sketch", "plane"].includes(feature.type) && targetBody)
        return { ...feature, targetBodyId: ("targetBodyId" in feature && feature.targetBodyId) || targetBody };
      return feature;
    }),
  };
}
export function featureDependencies(doc: PartDocument, includeSuppressedModifiers = false): Map<string, string[]> {
  const result = new Map<string, string[]>(),
    bodyProducers = new Map<string, string>();
  let lastBody: string | undefined;
  for (const f of doc.features) {
    const refs: string[] = [];
    if (f.type === "plane" && f.definition) {
      const visit = (value: unknown): void => {
        if (!value || typeof value !== "object") return;
        const ref = value as Record<string, unknown>;
        if (ref.kind === "feature") refs.push(String(ref.featureId));
        if (["face", "point", "axis"].includes(String(ref.kind))) refs.push(bodyProducers.get(String(ref.partId)) ?? `body:${ref.partId}`);
        Object.values(ref).forEach(visit);
      };
      visit(f.definition);
    }
    if(f.type==='transform'){
      refs.push(...transformReferences(f.transform).map(ref=>ref.sourceFeatureId));
      refs.push(...f.bodyIds.map(id=>bodyProducers.get(id)??`body:${id}`));
      if(!f.suppressed||includeSuppressedModifiers){
        for(const id of f.copyBodyIds?bodyIDsForFeature(doc,f):f.bodyIds)bodyProducers.set(id,f.id);
        if(f.copyBodyIds)lastBody=bodyIDsForFeature(doc,f).at(-1);
      }
      result.set(f.id,[...new Set(refs)]);continue;
    }
    if (f.type === "offset-face") {refs.push(...f.faces.map(face=>face.sourceFeatureId));if(f.transform)refs.push(...transformReferences(f.transform).map(ref=>ref.sourceFeatureId));}
    if (f.type === "profile" && f.support) refs.push(f.support.sourceFeatureId);
    if(f.type==='profile') {
      const drawing=f.profile.type==='drawing'?f.profile:f.profile.type==='projection'?f.profile.authored:undefined;
      if(drawing)refs.push(...pierceDependencies(drawing));
    }
    if (f.type === "extrude" && f.startingReference && f.startingReference.kind!=="principal") refs.push(f.startingReference.sourceFeatureId);
    if (f.type === "extrude") for(const end of [f,f.secondEnd]) if(end?.endType === "up-to-vertex" && end.endPointReference) refs.push(end.endPointReference.sourceFeatureId);
    if (f.type === "extrude" && f.directionReference) refs.push(f.directionReference.sourceFeatureId);
    if (f.type === "extrude") for(const end of [f,f.secondEnd]) if(end?.endType === "up-to-part" && end.endPartId) refs.push(bodyProducers.get(end.endPartId) ?? `body:${end.endPartId}`);
    if (f.type === "boolean") refs.push(...f.toolBodyIds.map(id => bodyProducers.get(id) ?? `body:${id}`));
    if (f.type === "loft") refs.push(...f.sections.map(section => section.profileFeatureId));
    if ("profileFeatureId" in f) refs.push(f.profileFeatureId);
    if (f.type === "extrude" && f.endType === "up-to-face" && f.endReference) refs.push(f.endReference.sourceFeatureId);
    if (f.type === "extrude" && f.secondEnd?.endType === "up-to-face" && f.secondEnd.endReference) refs.push(f.secondEnd.endReference.sourceFeatureId);
    if (f.type === "extrude" && (f.endType === "up-to-next" || f.secondEnd?.endType === "up-to-next")) refs.push(...bodyProducers.values());
    if (f.type === "extrude" && f.profileSelections) refs.push(...f.profileSelections.map(p => p.profileFeatureId));
    if ("pathFeatureId" in f) refs.push(f.pathFeatureId);
    if ("sourceFeatureId" in f) refs.push(f.sourceFeatureId);
    if (f.type === "profile" && f.profile.type === "projection") refs.push(f.profile.sourceFeatureId);
    if (
      (f.type === "extrude" || f.type === "revolve" || f.type === "sweep" || f.type === "loft" || f.type === "import-step" || f.type === "import-cad") &&
      f.operation === "new"
    ) {
      for (const id of bodyIDsForFeature(doc, f)) { lastBody = id; bodyProducers.set(id, f.id); }
    } else if (f.type==="extrude"&&f.scopeMode==="all") {
      // Automatic scope queries whatever solids exist at this step. It must
      // adapt when an input part is removed/suppressed, not pin cached targets.
      // Later references still depend on this potential modifier and are
      // checked against actual native availability during evaluation.
      if(!f.suppressed||includeSuppressedModifiers)for(const id of bodyProducers.keys())bodyProducers.set(id,f.id);
      if(!f.suppressed)lastBody=f.scopeResolution?.groups.at(-1)?.bodyId??lastBody;
    } else if (!["sketch", "profile", "plane"].includes(f.type)) {
      const body =
        "targetBodyId" in f && f.targetBodyId ? f.targetBodyId : lastBody;
      const targets = f.type === "offset-face" ? offsetFaceBodies(f) : f.type === "extrude" && f.targetBodyIds ? f.targetBodyIds : [body];
      for (const target of targets) {
        refs.push((target && bodyProducers.get(target)) ?? `body:${target ?? "missing"}`);
        // A suppressed modifier leaves the preceding body available to later
        // features (in particular, parts restored by a suppressed merge).
        const mergedIntoPrimary = f.type === "extrude" && f.operation === "add" && f.targetBodyIds && target !== body;
        if (target && !mergedIntoPrimary && (!f.suppressed || includeSuppressedModifiers)) bodyProducers.set(target, f.id);
      }
    }
    const consumed = consumedBodyIDs(f);
    if (consumed.length && !(f.type==="extrude"&&f.scopeMode==="all")) {
      for (const id of consumed) bodyProducers.delete(id);
      lastBody = "targetBodyId" in f ? f.targetBodyId : lastBody;
    }
    result.set(f.id, [...new Set(refs)]);
  }
  return result;
}
export function dependentFeatures(doc: PartDocument, id: string): Set<string> {
  const affected = new Set([id]);
  for (const [key, refs] of featureDependencies(doc))
    if (refs.some((r) => affected.has(r))) affected.add(key);
  return affected;
}
export function setFeatureSuppressed(
  doc: PartDocument,
  id: string,
  suppressed: boolean,
): PartDocument {
  const next = structuredClone(doc),
    affected = suppressed ? dependentFeatures(doc, id) : new Set([id]);
  if (!suppressed) {
    // Restoring a descendant must also recover dormant prerequisites, while
    // ordinary evaluation can build on the bodies left by suppressed modifiers.
    const deps = featureDependencies(doc, true);
    const visit = (key: string) => {
      for (const ref of deps.get(key) ?? [])
        if (!affected.has(ref)) {
          affected.add(ref);
          visit(ref);
        }
    };
    visit(id);
  }
  next.features = next.features.map((f) =>
    affected.has(f.id) ? { ...f, suppressed } : f,
  );
  validatePartDocument(next);
  return next;
}
export function insertFeature(
  doc: PartDocument,
  feature: PartFeature,
): PartDocument {
  const next = stableBodies(doc),
    index = rollbackPosition(doc);
  if (
    (feature.type === "extrude" || feature.type === "revolve" || feature.type === "sweep" || feature.type === "loft" || feature.type === "import-step" || feature.type === "import-cad") &&
    feature.operation === "new"
  )
    feature = {
      ...feature,
      bodyId:
        feature.bodyId ??
        (doc.features.some(
          (f) =>
            (f.type === "extrude" || f.type === "revolve" || f.type === "sweep" || f.type === "loft" || f.type === "import-step" || f.type === "import-cad") &&
            f.operation === "new",
        )
          ? `${doc.documentId}:body-${feature.id}`
          : `${doc.documentId}:body-1`),
    };
  next.features.splice(index, 0, feature);
  if (doc.rollbackIndex !== undefined) next.rollbackIndex = index + 1;
  validatePartDocument(next);
  return next;
}
export function moveFeature(
  doc: PartDocument,
  id: string,
  delta: number,
): PartDocument {
  const next = stableBodies(doc),
    index = next.features.findIndex((f) => f.id === id),
    target = index + delta;
  if (index < 0 || target < 0 || target >= next.features.length)
    throw new Error("Choose a position inside the feature history.");
  const [feature] = next.features.splice(index, 1);
  next.features.splice(target, 0, feature);
  validatePartDocument(next);
  return next;
}
export function removeFeature(doc: PartDocument, id: string): PartDocument {
  const next = stableBodies(doc),
    affected = new Set([id]),
    cutoff = rollbackPosition(doc);
  next.features = next.features.filter((f) => !affected.has(f.id));
  if (doc.rollbackIndex !== undefined)
    next.rollbackIndex = doc.features
      .slice(0, cutoff)
      .filter((f) => !affected.has(f.id)).length;
  validatePartDocument(next);
  return next;
}
export function availableBodies(
  doc: PartDocument,
): { id: string; name: string; visible: boolean }[] {
  const errors = featureReferenceErrors(doc);
  const consumed = new Set(doc.features.slice(0, rollbackPosition(doc))
    .flatMap(f => !errors.has(f.id) ? consumedBodyIDs(f) : []));
  return doc.features
    .slice(0, rollbackPosition(doc))
    .filter(
      (f) =>
        !f.suppressed && !errors.has(f.id) &&
        createdBodyIDs(doc,f).length>0,
    )
    .flatMap(f => bodyIDsForFeature(doc, f))
    .filter(id => !consumed.has(id))
    .map(id => ({
      id,
      name: doc.bodyProperties?.[id]?.name ?? `Body ${doc.features.flatMap(f => createdBodyIDs(doc,f)).indexOf(id) + 1}`,
      visible: doc.bodyProperties?.[id]?.visible ?? true,
    }));
}
