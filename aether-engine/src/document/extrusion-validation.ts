import type { ExtrudeFeature } from './part-document';
import { profileRegionIdentity } from '../sketch/reference/profile-region-reference';
import { validateExtrusionScopeResolution, type ExtrusionScopeResolution } from './extrusion-scope';
import { validateExtrusionPointReference } from './extrusion-point-reference';
import { validateExtrusionFaceReference } from './extrusion-face-reference';
import { validateExtrusionStartReference } from './extrusion-start-reference';

const requirePositiveFinite = (value: number, label: string) => {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be greater than zero.`);
};

/** One extent/reference grammar for solid, thin and surface extrusion. */
export function validateExtrusionDefinition(feature: ExtrudeFeature, earlier: ReadonlyMap<string, string>, missingReference: (id: string) => boolean, surface = false): void {
  if (
    !missingReference(feature.profileFeatureId) && !["sketch", "profile"].includes(
      earlier.get(feature.profileFeatureId) || "",
    )
  )
    throw new Error("Extrude must reference an earlier Sketch.");
  if (!["new", "add", "cut", "intersect"].includes(feature.operation))
    throw new Error("Unsupported extrude operation.");
  validateMergeScope(feature);
  if (
    feature.profileContourId !== undefined &&
    (typeof feature.profileContourId !== "string" ||
      !feature.profileContourId.trim() ||
      feature.profileContourId.length > 128)
  )
    throw new Error("Invalid extruded region identity.");
  if (feature.profileSelections !== undefined) {
    const picks = feature.profileSelections;
    if (!Array.isArray(picks) || !picks.length || picks.length > 256 || new Set(picks.map(p => JSON.stringify([p?.profileFeatureId, p ? profileRegionIdentity(p) : null]))).size !== picks.length || picks.some(p => !p || (!missingReference(p.profileFeatureId) && !["sketch", "profile"].includes(earlier.get(p.profileFeatureId) || "")) || (p.profileContourId !== undefined && (typeof p.profileContourId !== "string" || !p.profileContourId.trim() || p.profileContourId.length > 128)))) throw Error("Choose distinct faces from earlier sketches.");
    if (surface && feature.separateBodies && picks.some(pick =>
      (!pick.profileContourId && pick.profileRegion) ||
      (!pick.profileContourId && picks.filter(other => other.profileFeatureId === pick.profileFeatureId).length > 1)))
      throw Error('Select either a whole sketch or distinct sketch curves for each surface extrusion source.');
  }
  if (feature.separateBodies !== undefined && typeof feature.separateBodies !== "boolean") throw Error("Invalid separate bodies option.");
  if (feature.outputProfileId !== undefined && (typeof feature.outputProfileId !== 'string' || !feature.outputProfileId.trim() || feature.outputProfileId.length > 128)) throw Error('Invalid extrusion output profile identity.');
  if (feature.bodyOutputs !== undefined && (!feature.separateBodies || feature.operation !== "new" || !Array.isArray(feature.bodyOutputs) || !feature.bodyOutputs.length || feature.bodyOutputs.some(id => typeof id !== "string" || !id.trim()))) throw Error("Invalid extrusion output bodies.");
  if (feature.regionMode !== undefined && feature.regionMode !== "faces") throw Error("Invalid region mode.");
  if (feature.profileContourIds !== undefined && (feature.regionMode !== "faces" || !Array.isArray(feature.profileContourIds) || !feature.profileContourIds.length || new Set(feature.profileContourIds).size !== feature.profileContourIds.length || feature.profileContourIds.some(id => typeof id !== "string" || !id.trim() || id.length > 128))) throw Error("Choose distinct region identities.");
  requirePositiveFinite(feature.distanceMillimeters, "Extrude distance");
  if (feature.thin !== undefined) {
    const wall = feature.thin;
    if (!wall || typeof wall !== "object" || Array.isArray(wall) ||
      [wall.thickness1Millimeters, wall.thickness2Millimeters].some(v => typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1e6) ||
      [wall.midplane, wall.flipped].some(v => v !== undefined && typeof v !== "boolean") ||
      (wall.midplaneThicknessMillimeters !== undefined && (typeof wall.midplaneThicknessMillimeters !== "number" || !Number.isFinite(wall.midplaneThicknessMillimeters) || wall.midplaneThicknessMillimeters <= 0 || wall.midplaneThicknessMillimeters > 1e6)) ||
      (wall.midplane ? wall.midplaneThicknessMillimeters === undefined : wall.thickness1Millimeters + wall.thickness2Millimeters <= 1e-7)) {
      throw Error("Thin extrusion needs valid wall thicknesses and a positive total thickness.");
    }
  }
  if (feature.secondEnd !== undefined) {
    if (!feature.secondEnd || typeof feature.secondEnd !== "object" || Array.isArray(feature.secondEnd)) throw Error("Invalid second-end definition.");
    if (feature.secondDistanceMillimeters !== undefined || ["symmetric", "symmetric-through-all"].includes(feature.endType ?? "")) throw Error("Independent second end cannot combine with Symmetric or legacy opposite depth.");
    if (!["blind", "through-all", "up-to-next", "up-to-face", "up-to-part", "up-to-vertex"].includes(feature.secondEnd.endType)) throw Error("Invalid second-end condition.");
    requirePositiveFinite(feature.secondEnd.distanceMillimeters, "Second-end depth");
  }
  for (const end of [feature, ...(feature.secondEnd ? [feature.secondEnd] : [])]) {
    if (end.draftAngleDegrees !== undefined) {
      if (!Number.isFinite(end.draftAngleDegrees) || Math.abs(end.draftAngleDegrees) >= 90) throw Error("Extrusion draft must be between -90 and 90 degrees.");
    }
    if (end.endType !== undefined && !["blind", "symmetric", "through-all", "symmetric-through-all", "up-to-next", "up-to-face", "up-to-part", "up-to-vertex"].includes(end.endType)) throw Error("Invalid extrusion end type.");
    if (["through-all", "symmetric-through-all"].includes(end.endType ?? "") && !surface && !["cut", "intersect"].includes(feature.operation)) throw Error("Through all requires Remove or Intersect.");
    if (end.endType === "up-to-part" && (typeof end.endPartId !== "string" || !end.endPartId.trim() || end.endPartId.length > 256)) throw Error("Up to part needs a stable stopping part identity.");
    if (end.endPartId !== undefined && end.endType !== "up-to-part") throw Error("A stopping part requires Up to part.");
    if (end.endType === "up-to-vertex") validateExtrusionPointReference(end.endPointReference,earlier,missingReference);
    if (end.endPointReference !== undefined && end.endType !== "up-to-vertex") throw Error("A stopping point requires Up to vertex.");
    if (end.endType === "up-to-face") validateExtrusionFaceReference(end.endReference,earlier,missingReference);
    if (end.endOffsetMillimeters !== undefined && (!Number.isFinite(end.endOffsetMillimeters) || !["up-to-next","up-to-face","up-to-part","up-to-vertex"].includes(end.endType ?? ""))) throw Error("End offset requires a supported stopping limit and a finite distance.");
  }
  if (feature.startingReference !== undefined) validateExtrusionStartReference(feature.startingReference,earlier,missingReference);
  if (feature.startingOffsetMillimeters !== undefined && !Number.isFinite(feature.startingOffsetMillimeters)) throw Error("Invalid starting offset.");
  if (feature.secondDistanceMillimeters !== undefined) {
    requirePositiveFinite(feature.secondDistanceMillimeters, "Opposite depth");
    if (feature.endType && feature.endType !== "blind") throw Error("Opposite depth requires Blind.");
  }

  if (feature.directionVector !== undefined) {
    const vector = feature.directionVector;
    if (!Array.isArray(vector) || vector.length !== 3 || !vector.every(Number.isFinite) || Math.abs(Math.hypot(...vector) - 1) > 1e-6) throw Error("Extrusion direction must be a finite unit vector.");
  }
  if (feature.directionReference !== undefined) {
    const ref = feature.directionReference;
    if (!ref || ref.kind !== "sketch-line" || feature.directionVector !== undefined ||
      ![ref.sourceFeatureId, ref.contourId, ref.segmentId].every(id => typeof id === "string" && !!id.trim() && id.length <= 128) ||
      (!missingReference(ref.sourceFeatureId) && earlier.get(ref.sourceFeatureId) !== "profile")) {
      throw Error("Extrusion direction needs a line in an earlier sketch; it cannot also store a manual vector.");
    }
  }
  if (feature.reversed !== undefined && typeof feature.reversed !== "boolean") throw new Error("Invalid extrude direction.");
}

export function validateMergeScope(feature: { operation: string; scopeMode?: "all"; scopeResolution?: ExtrusionScopeResolution; targetBodyId?: string; targetBodyIds?: string[] }): void {
  if (feature.scopeMode !== undefined && (feature.scopeMode!=="all" || !["add","cut","intersect"].includes(feature.operation) || feature.targetBodyId!==undefined || feature.targetBodyIds!==undefined)) throw Error("Automatic scope cannot also specify target parts.");
  if(feature.scopeResolution!==undefined){
    if(feature.scopeMode!=="all")throw Error("A scope resolution requires automatic scope.");
    validateExtrusionScopeResolution(feature.scopeResolution);
  }
  if (feature.targetBodyIds !== undefined) {
    const scope=feature.targetBodyIds;
    if (!["add","cut","intersect"].includes(feature.operation) || !Array.isArray(scope) || !scope.length || scope.length>256 || scope.some(id=>typeof id!=="string" || !id.trim()) || new Set(scope).size!==scope.length || feature.targetBodyId!==scope[0]) throw Error("Merge scope needs distinct parts and a matching primary target for Add, Remove or Intersect.");
  }
}
