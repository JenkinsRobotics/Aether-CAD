import { validateEdgeFinishEdge, type EdgeFinishEdge } from "./solid-edge-reference";

/** Sheet metal (SolidCraft's `sheet.*`): a plate of a rule's thickness, flanges and
 *  hems bent from its edges by the rule's radius, unfolded with the rule's K factor.
 *
 *  The rule lives on the base feature: thickness, inner bend radius and K factor
 *  (the neutral axis as a fraction of the thickness). Flanges and hems read it
 *  from the base that made their body. Unfold replaces the body with its flat
 *  pattern in place (each bend becomes a flat length of leg + bend allowance,
 *  angle · (radius + K · thickness)); Refold brings the folded body back. */
export interface SheetMetalRule {
  thicknessMillimeters: number;
  bendRadiusMillimeters: number;
  kFactor: number;
}
export interface SheetBaseFeature extends SheetMetalRule {
  id: string; type: "sheet-base"; name: string; suppressed: boolean; operation: "new";
  profileFeatureId: string;
  profileContourId?: string;
  /** Build the plate behind the sketch instead of in front of it. */
  reversed?: boolean;
}
export interface SheetFlangeFeature {
  id: string; type: "sheet-flange"; name: string; suppressed: boolean;
  bodyIds: [string];
  edges: EdgeFinishEdge[];
  /** The straight leg past the bend. */
  distanceMillimeters: number;
  angleDegrees: number;
  /** Fold toward the picked face instead of away from it. */
  inward?: boolean;
  /** Inner bend radius; the rule's when absent. */
  bendRadiusMillimeters?: number;
}
export interface SheetHemFeature {
  id: string; type: "sheet-hem"; name: string; suppressed: boolean;
  bodyIds: [string];
  edges: EdgeFinishEdge[];
  lengthMillimeters: number;
  /** Inner radius of the hem; the rule's bend radius when absent. */
  gapMillimeters?: number;
  inward?: boolean;
}
export interface SheetUnfoldFeature { id: string; type: "sheet-unfold"; name: string; suppressed: boolean; bodyIds: [string] }
export interface SheetRefoldFeature { id: string; type: "sheet-refold"; name: string; suppressed: boolean; bodyIds: [string] }
export type SheetMetalFeature = SheetBaseFeature | SheetFlangeFeature | SheetHemFeature | SheetUnfoldFeature | SheetRefoldFeature;
export const sheetMetalFeatureTypes = ["sheet-base", "sheet-flange", "sheet-hem", "sheet-unfold", "sheet-refold"] as const;
export const defaultSheetMetalRule: SheetMetalRule = { thicknessMillimeters: 1.5, bendRadiusMillimeters: 1.5, kFactor: 0.44 };

/** The unfolded length a bend of this angle takes: the arc at the neutral axis. */
export const bendAllowanceMillimeters = (angleDegrees: number, innerRadius: number, rule: SheetMetalRule) =>
  (angleDegrees * Math.PI / 180) * (innerRadius + rule.kFactor * rule.thicknessMillimeters);

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
export function validateSheetMetalRule(rule: SheetMetalRule, what: string): void {
  if (!finite(rule.thicknessMillimeters) || rule.thicknessMillimeters <= 0) throw new Error(`${what} needs a positive thickness.`);
  if (!finite(rule.bendRadiusMillimeters) || rule.bendRadiusMillimeters <= 0) throw new Error(`${what} needs a positive bend radius.`);
  if (!finite(rule.kFactor) || rule.kFactor <= 0 || rule.kFactor > 1) throw new Error(`${what} needs a K factor between 0 and 1.`);
}
const oneBody = (ids: unknown, what: string) => { if (!Array.isArray(ids) || ids.length !== 1 || typeof ids[0] !== "string") throw new Error(`${what} needs one sheet metal body.`); };
const pickedEdges = (edges: unknown, what: string, earlier: ReadonlyMap<string, string>, missing: (id: string) => boolean) => {
  if (!Array.isArray(edges) || !edges.length) throw new Error(`${what} needs picked edges.`);
  for (const edge of edges) validateEdgeFinishEdge(edge, earlier, missing);
};
export function validateSheetMetalFeature(feature: SheetMetalFeature, earlier: ReadonlyMap<string, string>, missing: (id: unknown) => boolean): void {
  const missingId = missing as (id: string) => boolean;
  switch (feature.type) {
    case "sheet-base":
      if (typeof feature.profileFeatureId !== "string" || !["profile", "sketch"].includes(earlier.get(feature.profileFeatureId) ?? "")) throw new Error("Sheet metal base needs an earlier sketch.");
      validateSheetMetalRule(feature, "Sheet metal base");
      return;
    case "sheet-flange":
      oneBody(feature.bodyIds, "Flange"); pickedEdges(feature.edges, "Flange", earlier, missingId);
      if (!finite(feature.distanceMillimeters) || feature.distanceMillimeters <= 0) throw new Error("Flange needs a positive length.");
      if (!finite(feature.angleDegrees) || feature.angleDegrees <= 0 || feature.angleDegrees > 180) throw new Error("Flange angle must be between 0 and 180 degrees.");
      if (feature.bendRadiusMillimeters !== undefined && !(finite(feature.bendRadiusMillimeters) && feature.bendRadiusMillimeters > 0)) throw new Error("Flange bend radius must be positive.");
      return;
    case "sheet-hem":
      oneBody(feature.bodyIds, "Hem"); pickedEdges(feature.edges, "Hem", earlier, missingId);
      if (!finite(feature.lengthMillimeters) || feature.lengthMillimeters <= 0) throw new Error("Hem needs a positive length.");
      if (feature.gapMillimeters !== undefined && !(finite(feature.gapMillimeters) && feature.gapMillimeters > 0)) throw new Error("Hem gap must be positive.");
      return;
    case "sheet-unfold": oneBody(feature.bodyIds, "Unfold"); return;
    case "sheet-refold": oneBody(feature.bodyIds, "Refold"); return;
  }
}
