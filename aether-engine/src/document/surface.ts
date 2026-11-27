import type { ExtrudeFeature } from './part-document';
import { validateExtrusionDefinition } from './extrusion-validation';
import { validateMirrorPlane } from "./mirror-plane";
import { validateTransformVectorReference, type TransformVectorReference } from "./part-transform";
import { validateEdgeFinishEdge, type EdgeFinishEdge } from "./solid-edge-reference";
import { validateSolidFaceReference, type SolidFaceReference } from "./solid-face-reference";

/** The same axis choices Revolve offers: a given line, an axis feature, or a picked line, edge or two points. */
export type SurfaceRevolveAxis = { kind: "vector"; origin: [number, number, number]; direction: [number, number, number] } | { kind: "feature"; featureId: string } | TransformVectorReference;

/** Surface features (SolidCraft's `surface.*`): open, zero-thickness sheet bodies.
 *  A sheet is a body like any other — it has an identity, sits in the body list
 *  and the tree — but it has faces and no volume. Thicken turns one into a solid.
 *
 *  Creators carry `operation: "new"` so body history treats them as any
 *  new-body feature; Stitch keeps the first body's identity and consumes the
 *  rest; Unstitch publishes one body per face; Reverse and Offset change a
 *  sheet in place. */
export interface SurfaceExtrudeFeature extends Omit<ExtrudeFeature, 'type' | 'operation' | 'thin' | 'draftAngleDegrees'> {
  type: "surface-extrude";
  operation: "new" | "add";
  /** Part26 Add retains a target identity per connected group; absent preserves
   * the legacy single-compound result. Native scopeResolution is output only. */
  connectedMerge?: boolean;
  /** Legacy selected sketch curves, retained on read. New records use profileSelections. */
  contourIds?: string[];
  /** Legacy symmetric flag; new records use endType. */
  symmetric?: boolean;
}
export interface SurfaceRevolveFeature {
  id: string; type: "surface-revolve"; name: string; suppressed: boolean; operation: "new";
  profileFeatureId: string;
  contourIds?: string[];
  angleDegrees: number;
  reversed?: boolean;
  axis: "X" | "Y" | "Z";
  axisReference?: SurfaceRevolveAxis;
}
export interface SurfaceLoftFeature {
  id: string; type: "surface-loft"; name: string; suppressed: boolean; operation: "new";
  sections: { profileFeatureId: string; contourId?: string }[];
  ruled?: boolean;
}
export interface SurfacePatchFeature {
  id: string; type: "surface-patch"; name: string; suppressed: boolean; operation: "new";
  profileFeatureId: string;
  /** The closed curves to fill; every closed curve when absent. */
  contourIds?: string[];
}
export interface SurfaceSweepFeature {
  id: string; type: "surface-sweep"; name: string; suppressed: boolean; operation: "new";
  profileFeatureId: string;
  contourIds?: string[];
  pathFeatureId: string;
  pathContourId?: string;
}
export interface SurfaceOffsetFeature {
  id: string; type: "surface-offset"; name: string; suppressed: boolean; operation: "new";
  bodyIds: [string];
  distanceMillimeters: number;
}
export interface SurfaceThickenFeature {
  id: string; type: "surface-thicken"; name: string; suppressed: boolean;
  bodyIds: string[];
  thicknessMillimeters: number;
  /** Onshape's Thickness 2: the other side's own amount (not with Mid plane). */
  secondThicknessMillimeters?: number;
  symmetric?: boolean;
  /** Onshape's Keep tools: false consumes the sheets; absent (older records) keeps them. */
  keepTools?: boolean;
  operation: "new" | "add" | "cut";
  targetBodyId?: string;
}
export interface SurfaceStitchFeature {
  id: string; type: "surface-stitch"; name: string; suppressed: boolean;
  /** Sewn into the first; a solid when they close. */
  bodyIds: string[];
  toleranceMillimeters?: number;
}
export interface SurfaceUnstitchFeature {
  id: string; type: "surface-unstitch"; name: string; suppressed: boolean; operation: "new";
  bodyIds: [string];
  /** Published by the rebuild: one body per face. */
  bodyOutputs?: string[];
}
export interface SurfaceReverseNormalFeature {
  id: string; type: "surface-reverse-normal"; name: string; suppressed: boolean;
  bodyIds: [string];
}
/** Ruled Surface: a strip from picked body edges, reaching `distance` square to the
 *  surface (normal), continuing it (tangent) or along a given direction. */
export interface SurfaceRuledFeature {
  id: string; type: "surface-ruled"; name: string; suppressed: boolean; operation: "new";
  bodyIds: [string];
  edges: EdgeFinishEdge[];
  distanceMillimeters: number;
  mode: "normal" | "tangent" | "direction";
  direction?: [number, number, number];
}
/** Extend: a sheet grown past its picked boundary edges by a tangent strip, sewn on in place. */
export interface SurfaceExtendFeature {
  id: string; type: "surface-extend"; name: string; suppressed: boolean;
  bodyIds: [string];
  edges: EdgeFinishEdge[];
  distanceMillimeters: number;
}
/** Boundary Surface: one face filled across a loop of picked body edges (2 to 4, meeting end to end). */
export interface SurfaceBoundaryFeature {
  id: string; type: "surface-boundary"; name: string; suppressed: boolean; operation: "new";
  bodyIds: [string];
  edges: EdgeFinishEdge[];
}
/** Blend Surface: a face between two edge chains (G0, G1, or G2 continuity), each chain on one body. */
export interface SurfaceBlendFeature {
  id: string; type: "surface-blend"; name: string; suppressed: boolean; operation: "new";
  from: { bodyId: string; edges: EdgeFinishEdge[] };
  to: { bodyId: string; edges: EdgeFinishEdge[] };
  continuity?: "g0" | "g1" | "g2";
  tangentWeight?: number;
}
/** Match Surface (SolidCraft's surface.match): deforms a source sheet boundary to meet a
 *  target surface edge with G0, G1, or G2 continuity. */
export interface SurfaceMatchFeature {
  id: string; type: "surface-match"; name: string; suppressed: boolean;
  bodyIds: [string];
  sourceEdges: EdgeFinishEdge[];
  targetBodyId: string;
  targetEdges: EdgeFinishEdge[];
  continuity: "g0" | "g1" | "g2";
}
/** Surface Fillet (SolidCraft's surface.fillet): constant-radius rolling-ball fillet across
 *  a shared or intersecting seam between one or two surface sheets. */
export interface SurfaceFilletFeature {
  id: string; type: "surface-fillet"; name: string; suppressed: boolean; operation: "new";
  bodyIds: string[];
  edges?: EdgeFinishEdge[];
  radiusMillimeters: number;
}
/** Fair (SolidCraft's surface.fair): a sheet's untrimmed faces with their interior control
 *  points relaxed, border rows held; strength scales the step, the tolerance caps any move. */
export interface SurfaceFairFeature {
  id: string; type: "surface-fair"; name: string; suppressed: boolean;
  bodyIds: [string];
  faces?: SolidFaceReference[];
  strength?: number;
  toleranceMillimeters?: number;
}
/** Trim (SolidCraft's surface.trim): the sheet cut at a plane or another surface/solid body,
 *  the side holding the keep point kept. */
export interface SurfaceTrimFeature {
  id: string; type: "surface-trim"; name: string; suppressed: boolean;
  bodyIds: [string];
  plane?: import("./mirror-plane").MirrorPlaneReference;
  toolBodyId?: string;
  keepPointMillimeters: [number, number, number];
}
/** Untrim: a picked face rebuilt from its outer boundary alone, its holes gone, in place. */
export interface SurfaceUntrimFeature {
  id: string; type: "surface-untrim"; name: string; suppressed: boolean;
  bodyIds: [string];
  face: SolidFaceReference;
}
export type SurfaceFeature = SurfaceFairFeature | SurfaceTrimFeature | SurfaceBoundaryFeature | SurfaceBlendFeature | SurfaceMatchFeature | SurfaceFilletFeature | SurfaceUntrimFeature | SurfaceRuledFeature | SurfaceExtendFeature
  | SurfaceExtrudeFeature | SurfaceRevolveFeature | SurfaceLoftFeature | SurfacePatchFeature | SurfaceSweepFeature
  | SurfaceOffsetFeature | SurfaceThickenFeature | SurfaceStitchFeature | SurfaceUnstitchFeature | SurfaceReverseNormalFeature;

export const surfaceFeatureTypes = ["surface-fair", "surface-trim", "surface-boundary", "surface-blend", "surface-match", "surface-fillet", "surface-untrim", "surface-ruled", "surface-extend", "surface-extrude", "surface-revolve", "surface-loft", "surface-patch", "surface-sweep", "surface-offset", "surface-thicken", "surface-stitch", "surface-unstitch", "surface-reverse-normal"] as const;
/** The surface features that make a new sheet (or, for Thicken with "new", a solid). */
export const surfaceCreatorTypes = ["surface-boundary", "surface-blend", "surface-fillet", "surface-ruled", "surface-extrude", "surface-revolve", "surface-loft", "surface-patch", "surface-sweep", "surface-offset", "surface-unstitch"] as const;

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const sketchRef = (id: unknown, earlier: ReadonlyMap<string, string>, what: string) => {
  if (typeof id !== "string" || !["profile", "sketch"].includes(earlier.get(id) ?? "")) throw new Error(`${what} needs an earlier sketch.`);
};
const ids = (list: unknown, what: string, exact?: number) => {
  if (!Array.isArray(list) || !list.length || list.some((id) => typeof id !== "string") || (exact !== undefined && list.length !== exact)) throw new Error(`${what} needs ${exact === 1 ? "one surface body" : "surface bodies"}.`);
};
export function validateSurfaceFeature(feature: SurfaceFeature, earlier: ReadonlyMap<string, string>, missing: (id: unknown) => boolean): void {
  switch (feature.type) {
    case "surface-boundary":
      ids(feature.bodyIds, "Boundary surface", 1);
      if (!Array.isArray(feature.edges) || feature.edges.length < 2 || feature.edges.length > 4) throw new Error("Boundary surface needs two to four picked edges meeting end to end.");
      for (const edge of feature.edges) validateEdgeFinishEdge(edge, earlier, missing as (id: string) => boolean);
      return;
    case "surface-blend":
      for (const side of [feature.from, feature.to]) {
        if (!side || typeof side.bodyId !== "string" || !Array.isArray(side.edges) || !side.edges.length) throw new Error("Blend surface needs picked edges on each of its two bodies.");
        for (const edge of side.edges) validateEdgeFinishEdge(edge, earlier, missing as (id: string) => boolean);
      }
      if (feature.continuity !== undefined && !["g0", "g1", "g2"].includes(feature.continuity)) throw new Error("Blend continuity must be g0, g1, or g2.");
      if (feature.tangentWeight !== undefined && !(finite(feature.tangentWeight) && feature.tangentWeight > 0)) throw new Error("Blend tangent weight must be positive.");
      return;
    case "surface-match":
      ids(feature.bodyIds, "Match surface", 1);
      if (typeof feature.targetBodyId !== "string" || !feature.targetBodyId) throw new Error("Match surface needs a target surface body.");
      if (!Array.isArray(feature.sourceEdges) || !feature.sourceEdges.length || !Array.isArray(feature.targetEdges) || !feature.targetEdges.length) throw new Error("Match surface needs source and target edges.");
      for (const edge of [...feature.sourceEdges, ...feature.targetEdges]) validateEdgeFinishEdge(edge, earlier, missing as (id: string) => boolean);
      if (!["g0", "g1", "g2"].includes(feature.continuity)) throw new Error("Match continuity must be g0, g1, or g2.");
      return;
    case "surface-fillet":
      ids(feature.bodyIds, "Surface fillet");
      if (feature.bodyIds.length > 2) throw new Error("Surface fillet takes one or two surface bodies.");
      for (const edge of feature.edges ?? []) validateEdgeFinishEdge(edge, earlier, missing as (id: string) => boolean);
      if (!finite(feature.radiusMillimeters) || feature.radiusMillimeters <= 0) throw new Error("Surface fillet needs a positive radius.");
      return;
    case "surface-fair":
      ids(feature.bodyIds, "Fair", 1);
      for (const face of feature.faces ?? []) validateSolidFaceReference(face, earlier, missing as (id: string) => boolean);
      if (feature.strength !== undefined && !(finite(feature.strength) && feature.strength > 0 && feature.strength <= 1)) throw new Error("Fair strength is more than 0 and at most 1.");
      if (feature.toleranceMillimeters !== undefined && !(finite(feature.toleranceMillimeters) && feature.toleranceMillimeters > 0)) throw new Error("Fair's largest move must be positive.");
      return;
    case "surface-trim":
      ids(feature.bodyIds, "Trim", 1);
      if (!feature.plane && !feature.toolBodyId) throw new Error("Trim needs a trimming plane or a trimming body.");
      if (feature.plane) validateMirrorPlane(feature.plane, earlier, missing as (id: string) => boolean, "Trim plane");
      if (feature.toolBodyId !== undefined && (typeof feature.toolBodyId !== "string" || !feature.toolBodyId.trim())) throw new Error("Trim tool body must be a valid body ID.");
      if (!Array.isArray(feature.keepPointMillimeters) || feature.keepPointMillimeters.length !== 3 || !feature.keepPointMillimeters.every(finite)) throw new Error("Trim needs a keep point on the side to keep.");
      return;
    case "surface-untrim":
      ids(feature.bodyIds, "Untrim", 1);
      validateSolidFaceReference(feature.face, earlier, missing as (id: string) => boolean);
      return;
    case "surface-ruled":
    case "surface-extend": {
      ids(feature.bodyIds, feature.type === "surface-ruled" ? "Ruled surface" : "Extend", 1);
      if (!Array.isArray(feature.edges) || !feature.edges.length) throw new Error(`${feature.type === "surface-ruled" ? "Ruled surface" : "Extend"} needs picked edges.`);
      for (const edge of feature.edges) validateEdgeFinishEdge(edge, earlier, missing as (id: string) => boolean);
      if (!finite(feature.distanceMillimeters) || feature.distanceMillimeters <= 0) throw new Error("Enter a positive distance.");
      if (feature.type === "surface-ruled") {
        if (!["normal", "tangent", "direction"].includes(feature.mode)) throw new Error("Ruled surface reaches square to the surface, along it, or in a direction.");
        if (feature.mode === "direction" && !(Array.isArray(feature.direction) && feature.direction.length === 3 && feature.direction.every(Number.isFinite) && Math.hypot(...feature.direction) > 1e-9)) throw new Error("Ruled surface direction needs a nonzero vector.");
      }
      return;
    }
    case "surface-extrude": {
      if (!['new', 'add'].includes(feature.operation)) throw new Error('Surface extrusion supports New or Add.');
      if (feature.symmetric && (feature.endType || feature.secondEnd || feature.secondDistanceMillimeters)) throw new Error('Choose one symmetric surface extent definition.');
      if (feature.contourIds !== undefined && (!Array.isArray(feature.contourIds) || !feature.contourIds.length || new Set(feature.contourIds).size !== feature.contourIds.length || feature.contourIds.some(id => typeof id !== 'string' || !id.trim()))) throw new Error('Select distinct sketch curve identities.');
      if ('thin' in feature || 'draftAngleDegrees' in feature || feature.secondEnd?.draftAngleDegrees !== undefined) throw new Error('Surface extrusion does not support solid wall or draft parameters.');
      validateExtrusionDefinition({ ...feature, type: 'extrude' }, earlier, missing as (id: string) => boolean, true);
      return;
    }
    case "surface-revolve":
      sketchRef(feature.profileFeatureId, earlier, "Surface revolve");
      if (!finite(feature.angleDegrees) || feature.angleDegrees <= 0 || feature.angleDegrees > 360) throw new Error("Surface revolve angle must be between 0 and 360 degrees.");
      if (!["X", "Y", "Z"].includes(feature.axis)) throw new Error("Surface revolve axis must be X, Y or Z.");
      if (feature.axisReference) {
        const a = feature.axisReference, missingId = missing as (id: string) => boolean;
        if (a.kind === "vector") { if (![a.origin, a.direction].every((v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite)) || Math.hypot(...a.direction) < 1e-9) throw new Error("Surface revolve axis needs a finite origin and a nonzero direction."); }
        else if (a.kind === "feature") { if (typeof a.featureId !== "string" || (!missing(a.featureId) && earlier.get(a.featureId) !== "axis")) throw new Error("Surface revolve axis must be an earlier axis feature."); }
        else if (a.kind === "two-points") { validateTransformVectorReference(a.from, earlier, missingId); validateTransformVectorReference(a.to, earlier, missingId); }
        else validateTransformVectorReference(a, earlier, missingId);
      }
      return;
    case "surface-loft":
      if (!Array.isArray(feature.sections) || feature.sections.length < 2) throw new Error("Surface loft needs at least two sections.");
      for (const section of feature.sections) sketchRef(section.profileFeatureId, earlier, "Surface loft section");
      return;
    case "surface-patch":
      sketchRef(feature.profileFeatureId, earlier, "Patch");
      return;
    case "surface-sweep":
      sketchRef(feature.profileFeatureId, earlier, "Surface sweep profile");
      sketchRef(feature.pathFeatureId, earlier, "Surface sweep path");
      return;
    case "surface-offset":
      ids(feature.bodyIds, "Offset surface", 1);
      if (!finite(feature.distanceMillimeters)) throw new Error("Offset surface needs a finite distance.");
      return;
    case "surface-thicken":
      ids(feature.bodyIds, "Thicken");
      if (!finite(feature.thicknessMillimeters) || feature.thicknessMillimeters === 0) throw new Error("Thicken needs a nonzero thickness.");
      if (feature.secondThicknessMillimeters !== undefined && (!finite(feature.secondThicknessMillimeters) || feature.secondThicknessMillimeters <= 0 || feature.symmetric)) throw new Error("Thickness 2 must be positive, and not with Mid plane.");
      if (feature.keepTools !== undefined && typeof feature.keepTools !== "boolean") throw new Error("Keep tools must be true or false.");
      if (!["new", "add", "cut"].includes(feature.operation)) throw new Error("Thicken makes a new body, adds or cuts.");
      return;
    case "surface-stitch":
      ids(feature.bodyIds, "Stitch");
      if (feature.bodyIds.length < 2) throw new Error("Stitch needs two or more surface bodies.");
      if (feature.toleranceMillimeters !== undefined && !(finite(feature.toleranceMillimeters) && feature.toleranceMillimeters > 0)) throw new Error("Stitch tolerance must be positive.");
      return;
    case "surface-unstitch":
      ids(feature.bodyIds, "Unstitch", 1);
      return;
    case "surface-reverse-normal":
      ids(feature.bodyIds, "Reverse normal", 1);
      return;
  }
}
