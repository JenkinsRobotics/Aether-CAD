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
export interface SurfaceExtrudeFeature {
  id: string; type: "surface-extrude"; name: string; suppressed: boolean; operation: "new";
  profileFeatureId: string;
  /** The sketch curves to extrude (open or closed chains); every curve when absent. */
  contourIds?: string[];
  distanceMillimeters: number;
  reversed?: boolean;
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
  symmetric?: boolean;
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
/** Blend Surface: a face between two edge chains (position continuity), each chain on one body. */
export interface SurfaceBlendFeature {
  id: string; type: "surface-blend"; name: string; suppressed: boolean; operation: "new";
  from: { bodyId: string; edges: EdgeFinishEdge[] };
  to: { bodyId: string; edges: EdgeFinishEdge[] };
}
/** Trim (SolidCraft's surface.trim): the sheet cut at a plane, the side holding the keep point kept. */
export interface SurfaceTrimFeature {
  id: string; type: "surface-trim"; name: string; suppressed: boolean;
  bodyIds: [string];
  plane: import("./mirror-plane").MirrorPlaneReference;
  keepPointMillimeters: [number, number, number];
}
/** Untrim: a picked face rebuilt from its outer boundary alone, its holes gone, in place. */
export interface SurfaceUntrimFeature {
  id: string; type: "surface-untrim"; name: string; suppressed: boolean;
  bodyIds: [string];
  face: SolidFaceReference;
}
export type SurfaceFeature = SurfaceTrimFeature | SurfaceBoundaryFeature | SurfaceBlendFeature | SurfaceUntrimFeature | SurfaceRuledFeature | SurfaceExtendFeature
  | SurfaceExtrudeFeature | SurfaceRevolveFeature | SurfaceLoftFeature | SurfacePatchFeature | SurfaceSweepFeature
  | SurfaceOffsetFeature | SurfaceThickenFeature | SurfaceStitchFeature | SurfaceUnstitchFeature | SurfaceReverseNormalFeature;

export const surfaceFeatureTypes = ["surface-trim", "surface-boundary", "surface-blend", "surface-untrim", "surface-ruled", "surface-extend", "surface-extrude", "surface-revolve", "surface-loft", "surface-patch", "surface-sweep", "surface-offset", "surface-thicken", "surface-stitch", "surface-unstitch", "surface-reverse-normal"] as const;
/** The surface features that make a new sheet (or, for Thicken with "new", a solid). */
export const surfaceCreatorTypes = ["surface-boundary", "surface-blend", "surface-ruled", "surface-extrude", "surface-revolve", "surface-loft", "surface-patch", "surface-sweep", "surface-offset", "surface-unstitch"] as const;

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
      return;
    case "surface-trim":
      ids(feature.bodyIds, "Trim", 1);
      validateMirrorPlane(feature.plane, earlier, missing as (id: string) => boolean, "Trim plane");
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
    case "surface-extrude":
      sketchRef(feature.profileFeatureId, earlier, "Surface extrude");
      if (!finite(feature.distanceMillimeters) || feature.distanceMillimeters <= 0) throw new Error("Surface extrude needs a positive distance.");
      return;
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
