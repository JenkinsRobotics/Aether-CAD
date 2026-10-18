import { bodyIDsForFeature, consumedBodyIDs, rollbackPosition, validatePartDocument, type PartDocument, type PlanarSketchSupport, type PlanarFaceAnchor } from "@aether/core/document";
import type { SketchFrame } from "@aether/core/sketch";

export function supportForFace(doc: PartDocument, bodyId: string, frame: SketchFrame, label: string, beforeFeatureId?: string, faceAnchor?:PlanarFaceAnchor): PlanarSketchSupport | undefined {
  const sourceFeatureId=sourceFeatureForBody(doc,bodyId,beforeFeatureId);
  if (!sourceFeatureId) return undefined;
  // Name the feature that made the face, the way Onshape does — "Face of
  // Extrude 1" rather than "Body 1 · planar face". The face id is a hash: it
  // is what the engine matches on, and it means nothing to a reader.
  const source = doc.features.find((feature) => feature.id === sourceFeatureId);
  return {
    sourceFeatureId,
    bodyId,
    normal: [...frame.normal],
    ...(faceAnchor?{faceAnchor}:{}),
    xDirection: [...frame.xDirection],
    label: source ? `Face of ${source.name}` : label.replace(/ · Face -?\d+$/, ""),
  };
}

export function resolveSketchFrames(doc: PartDocument, frames: Record<string, SketchFrame> = {}): PartDocument {
  const active = new Set(doc.features.slice(0, rollbackPosition(doc)).filter(f => f.type === "profile" && f.support && !f.suppressed).map(f => f.id));
  if (Object.keys(frames).some(id => !active.has(id))) throw new Error("Rebuild returned an unknown sketch support.");
  const next = {...doc, features: doc.features.map(f => {
    if (!active.has(f.id)) return f;
    if (!frames[f.id]) throw new Error(`${f.name}: support plane was not resolved. Reselect a planar face.`);
    return {...f, frame: frames[f.id]};
  })};
  validatePartDocument(next);
  return next;
}

export function sourceFeatureForBody(doc:PartDocument,bodyId:string,beforeFeatureId?:string):string|undefined {
  let sourceFeatureId: string | undefined;
  let lastBody: string | undefined;
  const index = beforeFeatureId ? doc.features.findIndex(f => f.id === beforeFeatureId) : -1;
  for (const feature of doc.features.slice(0, index < 0 ? rollbackPosition(doc) : Math.min(index, rollbackPosition(doc)))) {
    if (feature.suppressed) continue;
    if(feature.type==='transform'){
      const outputs=feature.copyBodyIds?feature.bodyIds.map(id=>feature.copyBodyIds![id]):feature.bodyIds;
      if(outputs.includes(bodyId))sourceFeatureId=feature.id;
      if(feature.copyBodyIds)lastBody=outputs.at(-1);
      continue;
    }
    if(feature.type==="offset-face"){
      if(feature.faces.some(face=>face.bodyId===bodyId))sourceFeatureId=feature.id;
      continue;
    }
    if(feature.type==="extrude"&&feature.scopeMode==="all"){
      if(feature.scopeResolution?.groups.some(group=>group.bodyId===bodyId))sourceFeatureId=feature.id;
      if(consumedBodyIDs(feature).includes(bodyId))sourceFeatureId=undefined;
      lastBody=feature.scopeResolution?.groups.at(-1)?.bodyId??lastBody;continue;
    }
    if ("operation" in feature && feature.operation === "new") {
      const ids = bodyIDsForFeature(doc, feature); lastBody = ids.at(-1);
      if (ids.includes(bodyId)) sourceFeatureId = feature.id;
    } else if (!["profile", "sketch", "plane"].includes(feature.type)) {
      const target = "targetBodyId" in feature && feature.targetBodyId ? feature.targetBodyId : lastBody;
      if (target === bodyId || (feature.type === "extrude" && feature.targetBodyIds?.includes(bodyId))) sourceFeatureId = feature.id;
    }
    const consumed = consumedBodyIDs(feature);
    if (consumed.length) {
      if (consumed.includes(bodyId)) sourceFeatureId = undefined;
      if ("targetBodyId" in feature) lastBody = feature.targetBodyId;
    }
  }
  return sourceFeatureId;
}
