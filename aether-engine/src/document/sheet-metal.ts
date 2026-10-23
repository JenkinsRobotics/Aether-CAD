import { validateEdgeFinishEdge, type EdgeFinishEdge } from "./solid-edge-reference";
import type { SketchLineDirectionReference } from "./part-document";

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
/** Fold: the plate bent along a sketch line on its base face. The side the line's
 *  direction points left of (its normal side) moves unless `otherSide`; the strip of
 *  bend allowance past the line becomes the bend, the rest rotates about it. */
export interface SheetFoldFeature {
  id: string; type: "sheet-fold"; name: string; suppressed: boolean;
  bodyIds: [string];
  line: SketchLineDirectionReference;
  angleDegrees: number;
  bendRadiusMillimeters?: number;
  inward?: boolean;
  otherSide?: boolean;
}
export interface SheetUnfoldFeature { id: string; type: "sheet-unfold"; name: string; suppressed: boolean; bodyIds: [string] }
export interface SheetRefoldFeature { id: string; type: "sheet-refold"; name: string; suppressed: boolean; bodyIds: [string] }
export type SheetMetalFeature = SheetBaseFeature | SheetFlangeFeature | SheetHemFeature | SheetFoldFeature | SheetUnfoldFeature | SheetRefoldFeature | SheetPerforateFeature;
export const sheetMetalFeatureTypes = ["sheet-base", "sheet-flange", "sheet-hem", "sheet-fold", "sheet-unfold", "sheet-refold", "sheet-perforate"] as const;
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
    case "sheet-fold":
      oneBody(feature.bodyIds, "Fold");
      if (!feature.line || feature.line.kind !== "sketch-line" || typeof feature.line.sourceFeatureId !== "string" || (!missing(feature.line.sourceFeatureId) && !["profile", "sketch"].includes(earlier.get(feature.line.sourceFeatureId) ?? ""))) throw new Error("Fold needs a sketch line on the sheet.");
      if (!finite(feature.angleDegrees) || feature.angleDegrees <= 0 || feature.angleDegrees > 180) throw new Error("Fold angle must be between 0 and 180 degrees.");
      if (feature.bendRadiusMillimeters !== undefined && !(finite(feature.bendRadiusMillimeters) && feature.bendRadiusMillimeters > 0)) throw new Error("Fold bend radius must be positive.");
      return;
    case "sheet-unfold": oneBody(feature.bodyIds, "Unfold"); return;
    case "sheet-refold": oneBody(feature.bodyIds, "Refold"); return;
    case "sheet-perforate": validateSheetPerforate(feature); return;
  }
}

/** Perforate (SolidCraft's sheet.perforate): a grid of round holes through a planar face of
 *  the sheet, kept clear of its edges and cut-outs by the margin. Staggered rows sit at 60°. */
export interface SheetPerforateFeature {
  id: string; type: "sheet-perforate"; name: string; suppressed: boolean;
  bodyIds: [string];
  face: import("./solid-face-reference").SolidFaceReference;
  diameterMillimeters: number;
  /** Centre-to-centre distance between neighbouring holes. */
  pitchMillimeters: number;
  /** Clearance from edges and cut-outs to the hole's rim; default: the diameter. */
  marginMillimeters?: number;
  pattern?: "staggered" | "square";
}
export function validateSheetPerforate(feature: SheetPerforateFeature): void {
  oneBody(feature.bodyIds, "Perforate");
  if (!feature.face || typeof feature.face.sourceFeatureId !== "string") throw new Error("Perforate needs a picked face.");
  if (feature.face.surfaceType) throw new Error("Perforate goes on a planar face.");
  if (!finite(feature.diameterMillimeters) || feature.diameterMillimeters <= 0) throw new Error("Perforate needs a positive hole diameter.");
  if (!finite(feature.pitchMillimeters) || feature.pitchMillimeters <= feature.diameterMillimeters) throw new Error("The pitch must be larger than the hole diameter.");
  if (feature.marginMillimeters !== undefined && !(finite(feature.marginMillimeters) && feature.marginMillimeters >= 0)) throw new Error("The margin must be zero or more.");
  if (feature.pattern !== undefined && feature.pattern !== "staggered" && feature.pattern !== "square") throw new Error("Perforate pattern is staggered or square.");
}

/** One bend of a sheet body, as the bend table lists it. */
export interface BendTableRow {
  feature_id: string; name: string; kind: "flange" | "hem" | "fold"; edges: string;
  angle_deg: number; inner_radius_mm: number; thickness_mm: number; k_factor: number;
  /** Arc length at the neutral axis: the flat length the bend takes. */
  bend_allowance_mm: number;
  /** 2·(R + T)·tan(θ/2) − allowance: what to take off the outside dimensions; none at 180°. */
  bend_deduction_mm: number | null;
  /** The straight leg past the bend (flanges and hems). */
  leg_mm: number | null;
  direction: "up" | "down";
}
/** sheet.export_bend_table: every bend of a sheet body in history order, with its rule. */
export function sheetBendTable(doc: { features: { id: string; type: string; suppressed?: boolean }[] }, bodyId: string, base: SheetBaseFeature): BendTableRow[] {
  const rows: BendTableRow[] = [];
  for (const f of doc.features as SheetMetalFeature[]) {
    if (f.suppressed || (f.type !== "sheet-flange" && f.type !== "sheet-hem" && f.type !== "sheet-fold") || f.bodyIds[0] !== bodyId) continue;
    const angle = f.type === "sheet-hem" ? 180 : f.angleDegrees;
    const radius = f.type === "sheet-hem" ? f.gapMillimeters ?? base.bendRadiusMillimeters : f.bendRadiusMillimeters ?? base.bendRadiusMillimeters;
    const allowance = bendAllowanceMillimeters(angle, radius, base);
    rows.push({
      feature_id: f.id, name: f.name, kind: f.type === "sheet-flange" ? "flange" : f.type === "sheet-hem" ? "hem" : "fold",
      edges: f.type === "sheet-fold" ? "sketch line" : f.edges.map((e) => e.label).join("; "),
      angle_deg: angle, inner_radius_mm: radius, thickness_mm: base.thicknessMillimeters, k_factor: base.kFactor,
      bend_allowance_mm: allowance,
      bend_deduction_mm: angle >= 180 - 1e-9 ? null : 2 * (radius + base.thicknessMillimeters) * Math.tan(angle * Math.PI / 360) - allowance,
      leg_mm: f.type === "sheet-flange" ? f.distanceMillimeters : f.type === "sheet-hem" ? f.lengthMillimeters : null,
      direction: f.inward ? "up" : "down",
    });
  }
  return rows;
}
export function bendTableCSV(rows: BendTableRow[]): string {
  const keys: (keyof BendTableRow)[] = ["feature_id", "name", "kind", "edges", "angle_deg", "inner_radius_mm", "thickness_mm", "k_factor", "bend_allowance_mm", "bend_deduction_mm", "leg_mm", "direction"];
  const cell = (v: unknown) => v === null ? "" : typeof v === "number" ? String(Math.round(v * 1e6) / 1e6) : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  return [keys.join(","), ...rows.map((r) => keys.map((k) => cell(r[k])).join(","))].join("\n");
}
