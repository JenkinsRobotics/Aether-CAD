import { createEmptyPartDocument, insertFeature, parsePartDocument, serializePartDocument, validatePartDocument, type PartDocument, type PartFeature } from "@aether/core/document";

export interface SprocketParameters {
  teeth: number;
  boreDiameterMillimeters: number;
  keywayWidthMillimeters: number;
  heightMillimeters: number;
  toothSpaceRadiusMillimeters: number;
  chamferMillimeters: number;
}
export const defaultSprocketParameters: SprocketParameters = {
  teeth: 13, boreDiameterMillimeters: 15.875, keywayWidthMillimeters: 4.7625,
  heightMillimeters: 32, toothSpaceRadiusMillimeters: 4.4, chamferMillimeters: .35,
};
export const sprocketParameterFields = [
  { key: "teeth", label: "Tooth spaces", min: 8, max: 16, step: 1, unit: "" },
  { key: "boreDiameterMillimeters", label: "Bore diameter", min: 8, max: 20, step: .5, unit: "mm" },
  { key: "keywayWidthMillimeters", label: "Keyway width", min: 2, max: 6, step: .25, unit: "mm" },
  { key: "heightMillimeters", label: "Hub height", min: 30, max: 42, step: 1, unit: "mm" },
  { key: "toothSpaceRadiusMillimeters", label: "Tooth-space radius", min: 3, max: 5, step: .1, unit: "mm" },
  { key: "chamferMillimeters", label: "Top chamfer", min: .1, max: .6, step: .05, unit: "mm" },
] as const;
export interface HistoryStage { id: string; name: string; detail: string; endIndex: number }
export function sprocketParameterProblem(parameters: SprocketParameters): string | null {
  for (const field of sprocketParameterFields) {
    const value = parameters[field.key];
    if (!Number.isFinite(value) || value < field.min || value > field.max) return `${field.label} must be ${field.min}–${field.max}${field.unit ? ` ${field.unit}` : ""}.`;
  }
  if (!Number.isInteger(parameters.teeth)) return "Tooth spaces must be a whole number.";
  return null;
}

/** A real, editable Part history. Every visible stage groups its supporting
 * sketches and operations; geometry is produced exclusively by native rebuild.
 * This is a modeling test part, not a qualified chain/sprocket standard. */
export function createSprocketDocument(parameters = defaultSprocketParameters, documentId?: string): { document: PartDocument; stages: HistoryStage[] } {
  const problem = sprocketParameterProblem(parameters); if (problem) throw new Error(problem);
  const p = parameters, bodyId = "test-sprocket-body";
  let document = createEmptyPartDocument("Sprocket · CAD test");
  if (documentId) document = { ...document, documentId };
  const stages: HistoryStage[] = [];
  const add = (feature: PartFeature) => { document = insertFeature(document, feature); };
  const profile = (id: string, name: string, plane: "XY" | "XZ", offsetMillimeters: number, shape: Extract<PartFeature, { type: "profile" }>["profile"]) => add({ id, name, type: "profile", plane, offsetMillimeters, profile: shape, suppressed: false });
  const cut = (id: string, name: string, profileFeatureId: string, distanceMillimeters: number, throughAll = false) => add({ id, name, type: "extrude", profileFeatureId, targetBodyId: bodyId, operation: "cut", distanceMillimeters, ...(throughAll ? { endType: "through-all" as const } : {}), suppressed: false });
  const stage = (id: string, name: string, detail: string) => stages.push({ id, name, detail, endIndex: document.features.length });

  profile("blank-profile", "Lathe profile", "XZ", 0, { type: "polygon", pointsMillimeters: [[0, 0], [14, 0], [14, 6], [23, 6], [23, 10], [14, 10], [14, 18], [23, 18], [23, 22], [14, 22], [14, p.heightMillimeters], [0, p.heightMillimeters]] });
  add({ id: "blank", name: "Revolve blank", type: "revolve", profileFeatureId: "blank-profile", axis: "Z", angleDegrees: 360, operation: "new", bodyId, suppressed: false });
  stage("blank", "Revolve blank", "360° revolve of the stepped hub profile");

  profile("tooth-profile", "Tooth-space profile", "XY", p.heightMillimeters, { type: "circle", centerMillimeters: [24.2, 0], radiusMillimeters: p.toothSpaceRadiusMillimeters });
  add({ id: "tooth-cut", name: "Cut first tooth space", type: "hole", profileFeatureId: "tooth-profile", targetBodyId: bodyId, diameterMillimeters: p.toothSpaceRadiusMillimeters * 2, depthMillimeters: p.heightMillimeters, depthType: "through-all", cutType: "plain", suppressed: false });
  add({ id: "teeth", name: `Pattern ${p.teeth} tooth spaces`, type: "pattern", sourceFeatureId: "tooth-cut", targetBodyId: bodyId, patternType: "polar", axis: "Z", count: p.teeth, angleDegrees: 360, reversed: false, suppressed: false });
  stage("teeth", `Cut ${p.teeth} tooth spaces`, "Native hole cut and circular feature pattern");

  profile("bore-profile", "Bore profile", "XY", p.heightMillimeters, { type: "circle", centerMillimeters: [0, 0], radiusMillimeters: p.boreDiameterMillimeters / 2 });
  cut("bore", "Cut bore", "bore-profile", p.heightMillimeters, true);
  stage("bore", `Cut bore Ø ${p.boreDiameterMillimeters.toFixed(2)}`, "Through-all axial bore");

  const halfKey = p.keywayWidthMillimeters / 2, keyEnd = p.boreDiameterMillimeters / 2 + 2;
  profile("keyway-profile", "Keyway profile", "XY", p.heightMillimeters, { type: "polygon", pointsMillimeters: [[-halfKey, 0], [halfKey, 0], [halfKey, keyEnd], [-halfKey, keyEnd]] });
  cut("keyway", "Cut keyway", "keyway-profile", p.heightMillimeters, true);
  stage("keyway", `Cut keyway ${p.keywayWidthMillimeters.toFixed(2)}`, "Rectangular through-all pocket connected to the bore");

  profile("screw-profile", "Set-screw profile", "XZ", 14, { type: "circle", centerMillimeters: [0, (22 + p.heightMillimeters) / 2], radiusMillimeters: 3.175 });
  cut("screw", "Cut set screw", "screw-profile", 14);
  stage("screw", "Cut set screw Ø 6.35", "Radial pocket into the central bore");

  for (const [i, z, direction] of [[0, 6, 1], [1, 10, -1], [2, 18, 1], [3, 22, -1]]) {
    const id = `tip-taper-${i}`;
    profile(`${id}-profile`, `Tip taper profile ${i + 1}`, "XZ", 0, { type: "polygon", pointsMillimeters: [[22.35, z], [24, z], [24, z + direction * 1.65]] });
    add({ id, name: `Cut tip taper ${i + 1}`, type: "revolve", profileFeatureId: `${id}-profile`, axis: "Z", angleDegrees: 360, operation: "cut", targetBodyId: bodyId, suppressed: false });
  }
  stage("tapers", "Cut tip tapers × 4", "Four revolved cuts at the two tooth rims");
  add({ id: "chamfer", name: "Chamfer top edges", type: "chamfer", radiusMillimeters: p.chamferMillimeters, edgePlane: { plane: "XY", offsetMillimeters: p.heightMillimeters }, targetBodyId: bodyId, suppressed: false });
  stage("chamfer", "Chamfer top edges", "Native chamfer on the hub and bore rim");
  validatePartDocument(document);
  return { document, stages };
}

export function stageDocument(document: PartDocument, stages: readonly HistoryStage[], stage: number): PartDocument {
  if (!Number.isInteger(stage) || stage < 0 || stage > stages.length) throw new Error("Invalid rollback stage.");
  const rolled = { ...document, rollbackIndex: stage ? stages[stage - 1].endIndex : 0 };
  validatePartDocument(rolled);
  return rolled;
}

export function reopenTestDocument(document: PartDocument): PartDocument {
  return parsePartDocument(serializePartDocument(document));
}
