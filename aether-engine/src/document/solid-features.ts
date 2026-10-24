import {validateTransform,validateTransformVectorReference,type TransformFeature,type TransformVectorReference} from './part-transform';
export type {TransformFeature} from './part-transform';
import {validateOffsetFace,type OffsetFaceFeature} from './offset-face';
export type {OffsetFaceFeature} from './offset-face';
import {validateImportCAD, type ImportCADFeature} from "./import-cad";
export {cadImportExtensions,isMeshImportFormat,type CADImportFormat,type MeshImportUnits,type ImportCADFeature} from "./import-cad";
import {validateFaceExtrude, type FaceExtrudeFeature} from "./face-extrude";
import {validatePlanarFaceAnchor, type PlanarFaceAnchor} from './planar-face-anchor';
import {validateSolidFaceReference, type SolidFaceReference} from './solid-face-reference';
import {validateEdgeFinishEdge, type EdgeFinishEdge} from './solid-edge-reference';
import {validateMirrorPlane, type MirrorPlaneReference} from './mirror-plane';
import {validateAxisDefinition, type ConstructionAxisFeature} from './construction-axes';
import {validatePointDefinition, type ConstructionPointFeature} from './construction-points';
import {validateSplit, type SplitFeature} from './split';
import {validateDeleteFace, type DeleteFaceFeature} from './delete-face';
import {validatePipe, type PipeFeature} from './pipe';
import {validateBoundingSolid, type BoundingSolidFeature} from './bounding-solid';
import {validateThread, type ThreadFeature} from './thread';
import {validateCoil, type CoilFeature} from './coil';
import {validateCurve3D, type Curve3DFeature} from './curve3d';
import {validateBoundaryFill, type BoundaryFillFeature} from './boundary-fill';
import {validateSplitFace, type SplitFaceFeature} from './split-face';
export type {SplitFaceFeature} from './split-face';
export type {BoundaryFillFeature} from './boundary-fill';
export type {Curve3DFeature} from './curve3d';
import {validateSurfaceFeature, surfaceFeatureTypes, type SurfaceFeature} from './surface';
import {validateSheetMetalFeature, sheetMetalFeatureTypes, type SheetMetalFeature} from './sheet-metal';
import {validateRemoveBody, type RemoveBodyFeature} from './remove-body';
import {validateBoss, validateRest, validateLip, validateSnapFit, type BossFeature, type RestFeature, type LipFeature, type SnapFitFeature} from './plastic';
export type {LipFeature, SnapFitFeature} from './plastic';
export type {FaceExtrudeFeature} from "./face-extrude";
import {validateBoolean, type BooleanFeature} from "./boolean";
export type {BooleanFeature} from "./boolean";
import {validatePattern, type PatternFeature} from "./pattern";
export {patternSourceTypes, type PatternFeature} from "./pattern";
import {validateDraft, type DraftFeature} from "./draft";
export type {DraftFeature} from "./draft";
import {validateLoft, type LoftFeature} from "./loft";
export type {LoftFeature} from "./loft";
import {validateHole, type HoleFeature} from "./hole";
export type {HoleFeature} from "./hole";
import { validateImportSTEP, type ImportSTEPFeature } from "./import-step";
export type { ImportSTEPFeature } from "./import-step";
export interface PlaneFeature {id:string;name:string;type:"plane";plane:SketchPlane;offsetMillimeters:number;suppressed:boolean;definition?:PlaneDefinition;}
import { validateSketchDrawing, type SketchDrawing, type SketchFrame } from "../sketch/drawing";
import { localPierceValidation } from '../sketch/reference/pierce-context';
import type { SketchPlane } from "../sketch/index";
import { resolvePlaneFrame, validatePlaneDefinition, type PlaneDefinition } from "./construction-planes";
export function constructionPlaneFrame(plane:PlaneFeature,earlier:readonly {id:string;type:string}[]=[]):SketchFrame {
 return resolvePlaneFrame(plane,earlier);
}
export interface PlanarSketchSupport {
  sourceFeatureId: string;
  bodyId: string;
  normal: [number, number, number];
  faceAnchor?: PlanarFaceAnchor;
  xDirection: [number, number, number];
  label: string;
}
export interface ProfileFeature {
  id: string;
  type: "profile";
  name: string;
  plane: SketchPlane;
  offsetMillimeters: number;
  suppressed: boolean;
  frame?: SketchFrame;
  support?: PlanarSketchSupport;
  /** A half turn of the sketch plane about its own x or y axis (SolidCraft's
   *  `flip`): the normal reverses, so does the default extrude direction, and
   *  the sketch's other in-plane axis points the other way. */
  flip?: "x" | "y";
  profile:
    | SketchDrawing
    | { type: "projection"; sourceFeatureId: string; sourceContourId?: string; authored?: SketchDrawing }
    | {
        type: "circle";
        radiusMillimeters: number;
        centerMillimeters: [number, number];
      }
    | { type: "polygon"; pointsMillimeters: [number, number][] };
}
export interface RevolveFeature {
  id: string;
  type: "revolve";
  name: string;
  profileFeatureId: string;
  profileContourId?: string;
  profileRegion?: import('../sketch/reference/profile-region-reference').ProfileRegionReference;
  axis: "X" | "Y" | "Z";
  /** Replaces `axis` (through the origin) when present: a line, a picked straight edge, or a sketch line. */
  axisReference?: {kind:'vector';origin:[number,number,number];direction:[number,number,number]} | {kind:'feature';featureId:string} | TransformVectorReference;
  angleDegrees: number;
  symmetric?: boolean;
  reversed?: boolean;
  secondAngleDegrees?: number;
  operation: "new" | "add" | "cut";
  bodyId?: string;
  targetBodyId?: string;
  suppressed: boolean;
}
export interface MirrorFeature {
  id: string;
  type: "mirror";
  name: string;
  sourceFeatureId: string;
  plane: SketchPlane;
  offsetMillimeters: number;
  /** A plane feature or picked face as the mirror plane; when present it replaces plane + offset. */
  mirrorPlane?: MirrorPlaneReference;
  operation: "add" | "cut";
  targetBodyId?: string;
  suppressed: boolean;
}
export type EdgeFinishFeature = {
  id: string;
  name: string;
  radiusMillimeters: number;
  targetBodyId?: string;
  edgePlane?: { plane: SketchPlane; offsetMillimeters: number };
  /** Picked edges; when present they replace the plane pin. */
  edges?: EdgeFinishEdge[];
  /** Also finish every edge tangent-continuous with a picked one (SolidCraft's tangent chain). */
  tangentChain?: boolean;
  suppressed: boolean;
} & (
  | { type: "fillet"; /** A variable fillet runs from the size to this at the edge's far end. */ endRadiusMillimeters?: number }
  | { type: "chamfer";
      /** The second leg, measured on the reference face; blank keeps the chamfer symmetric. */ secondDistanceMillimeters?: number;
      /** Alternative to the second leg: the angle from the reference face. */ angleDegrees?: number;
      /** The face the first leg lies on; default: the adjacent face facing up most. */ referenceFace?: SolidFaceReference }
);
export interface SweepFeature {
  id: string;
  type: "sweep";
  name: string;
  profileFeatureId: string;
  profileContourId?: string;
  profileRegion?: import('../sketch/reference/profile-region-reference').ProfileRegionReference;
  pathFeatureId: string;
  pathContourId?: string;
  /** How the profile turns along the path: square to it (default), kept as drawn, or square to it with a fixed up direction. */
  orientation?: "perpendicular" | "parallel" | { kind: "direction"; direction: [number, number, number] };
  /** The profile's scale at the end of the path, linear along it (1 = unchanged). */
  endScale?: number;
  /** A guide rail: a curve of another sketch the profile's edge follows. */
  rail?: { pathFeatureId: string; pathContourId?: string };
  operation: "new" | "add" | "cut";
  bodyId?: string;
  targetBodyId?: string;
  suppressed: boolean;
}
export interface ShellFeature {
  id: string;
  type: "shell";
  name: string;
  targetBodyId?: string;
  thicknessMillimeters: number;
  /** Faces left open. Prefer a face reference (the face of an earlier solid by
   *  outward normal or surface type), which survives upstream dimension edits;
   *  the plane/offset form matches a fixed coordinate and is kept for older files. */
  removedFaces?: ShellOpenFace[];
  /** Which side of the original surface the wall takes; default inside. */
  direction?: "inside" | "outside" | "both";
  /** Also open every face tangent-continuous with a picked one. */
  tangentChain?: boolean;
  suppressed: boolean;
}
export type ShellOpenFace = { plane: SketchPlane; offsetMillimeters: number } | SolidFaceReference;
export const isShellFaceReference = (face: ShellOpenFace): face is SolidFaceReference => "sourceFeatureId" in face;
export type SolidFeature = SplitFaceFeature | BoundaryFillFeature | Curve3DFeature | LipFeature | SnapFitFeature | SheetMetalFeature | SurfaceFeature | TransformFeature | ConstructionAxisFeature | ConstructionPointFeature | SplitFeature | DeleteFaceFeature | PipeFeature | BoundingSolidFeature | ThreadFeature | CoilFeature | RemoveBodyFeature | BossFeature | RestFeature |
  OffsetFaceFeature | FaceExtrudeFeature | BooleanFeature | PatternFeature | DraftFeature | LoftFeature | HoleFeature | ImportCADFeature | ImportSTEPFeature | PlaneFeature | ProfileFeature | RevolveFeature | SweepFeature | MirrorFeature | EdgeFinishFeature | ShellFeature;
export function validateSolidFeature(
  feature: SolidFeature,
  earlier: Map<string, string>,
  missingReference: (id: unknown) => boolean = () => false,
): void {
  if (feature.type === "transform") return validateTransform(feature,earlier,missingReference);
  if (feature.type === "split") return validateSplit(feature,earlier,missingReference as (id:string)=>boolean);
  if (feature.type === "pipe") return validatePipe(feature,earlier,missingReference);
  if (feature.type === "coil") return validateCoil(feature);
  if (feature.type === "curve3d") return validateCurve3D(feature);
  if (feature.type === "boundary-fill") return validateBoundaryFill(feature);
  if (feature.type === "split-face") return validateSplitFace(feature, earlier, missingReference as (id: string) => boolean);
  if ((surfaceFeatureTypes as readonly string[]).includes(feature.type)) return validateSurfaceFeature(feature as SurfaceFeature, earlier, missingReference);
  if ((sheetMetalFeatureTypes as readonly string[]).includes(feature.type)) return validateSheetMetalFeature(feature as SheetMetalFeature, earlier, missingReference);
  if (feature.type === "boss") return validateBoss(feature,earlier,missingReference as (id:string)=>boolean);
  if (feature.type === "rest") return validateRest(feature,earlier,missingReference as (id:string)=>boolean);
  if (feature.type === "lip") return validateLip(feature,earlier,missingReference as (id:string)=>boolean);
  if (feature.type === "snap-fit") return validateSnapFit(feature,earlier,missingReference as (id:string)=>boolean);
  if (feature.type === "remove-body") return validateRemoveBody(feature);
  if (feature.type === "bounding-solid") return validateBoundingSolid(feature);
  if (feature.type === "thread") return validateThread(feature,earlier,missingReference as (id:string)=>boolean);
  if (feature.type === "delete-face") return validateDeleteFace(feature,earlier,missingReference as (id:string)=>boolean);
  if (feature.type === "offset-face") return validateOffsetFace(feature, earlier, missingReference);
  if (feature.type === "face-extrude") return validateFaceExtrude(feature, earlier, missingReference);
  if (feature.type === "boolean") return validateBoolean(feature);
  if (feature.type === "pattern") { validatePattern(feature, earlier, missingReference); return; }
  if (feature.type === "draft") { validateDraft(feature, earlier, missingReference); return; }
  if (feature.type === "loft") { validateLoft(feature, earlier, missingReference); return; }
  if (feature.type === "hole") { validateHole(feature, earlier, missingReference); return; }
  if (feature.type === "import-cad") { validateImportCAD(feature); return; }
  if (feature.type === "import-step") { validateImportSTEP(feature); return; }
  const positive = (value: number, label: string) => {
    if (!Number.isFinite(value) || value <= 0)
      throw new Error(`${label} must be positive.`);
  };
  if(feature.type==="point"){validatePointDefinition(feature,new Set([...earlier].filter(([,type])=>type==="plane").map(([id])=>id)),missingReference);return;}
  if(feature.type==="axis"){validateAxisDefinition(feature,new Set([...earlier].filter(([,type])=>type==="plane").map(([id])=>id)),missingReference);return;}
  if(feature.type==="plane"){if(!["XY","XZ","YZ"].includes(feature.plane)||!Number.isFinite(feature.offsetMillimeters))throw new Error("Invalid construction plane.");validatePlaneDefinition(feature,new Set([...earlier].filter(([,type])=>type==="plane").map(([id])=>id)), missingReference);return;}
  if (feature.type === "profile") {
    if (
      !["XY", "XZ", "YZ"].includes(feature.plane) ||
      !Number.isFinite(feature.offsetMillimeters)
    )
      throw new Error("Sketch plane or offset is invalid.");
    if (feature.support) {
      const s = feature.support;
      validatePlanarFaceAnchor(s.faceAnchor);
      if ((!missingReference(s.sourceFeatureId) && !earlier.has(s.sourceFeatureId)) || !s.bodyId || typeof s.bodyId !== "string" || typeof s.label !== "string" || ![s.normal, s.xDirection].every(v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite) && Math.abs(Math.hypot(...v) - 1) < 1e-6) || Math.abs(s.normal.reduce((sum, v, i) => sum + v * s.xDirection[i], 0)) > 1e-6) throw new Error("Invalid sketch face support. Reselect a planar face.");
    }
    if (feature.frame) {
      const { originMillimeters: origin, xDirection: x, normal: n } = feature.frame;
      if (![origin,x,n].every(v => Array.isArray(v) && v.length===3 && v.every(Number.isFinite)) || Math.abs(Math.hypot(...x)-1)>1e-6 || Math.abs(Math.hypot(...n)-1)>1e-6 || Math.abs(x.reduce((sum,v,i)=>sum+v*n[i],0))>1e-6) throw new Error("Invalid sketch frame.");
    }
    if (feature.profile?.type === "projection") {
      if (feature.profile.authored !== undefined) {
        // External equations require the document source context, checked after feature validation.
        const authored=feature.profile.authored;
        if(authored.projectionContext!==undefined)throw Error("Resolved projection context must not be saved.");
        const local=localPierceValidation(authored);
        validateSketchDrawing({...local,constraints:local.constraints?.filter(c=>![c.a,c.b,c.axis].some(r=>r?.projectedContourId!==undefined))});
      }
      const contourId=feature.profile.sourceContourId;
      if(contourId!==undefined&&(typeof contourId!=="string"||!contourId.trim()||contourId.length>128))throw Error("Invalid projected contour identity.");
      if (typeof feature.profile.sourceFeatureId !== "string" || (!missingReference(feature.profile.sourceFeatureId) && earlier.get(feature.profile.sourceFeatureId) !== "profile"))
        throw new Error(`${feature.name}: projection must reference an earlier profile (${feature.profile.sourceFeatureId}).`);
    } else if (feature.profile?.type === "drawing") {
      if(feature.profile.projectionContext!==undefined)throw Error("Resolved projection context must not be saved.");
      validateSketchDrawing(localPierceValidation(feature.profile));
    } else if (feature.profile?.type === "circle") {
      positive(feature.profile.radiusMillimeters, "Circle radius");
      if (
        feature.profile.centerMillimeters?.length !== 2 ||
        !feature.profile.centerMillimeters.every(Number.isFinite)
      )
        throw new Error("Circle center is invalid.");
    } else if (feature.profile?.type === "polygon") {
      const points = feature.profile.pointsMillimeters;
      if (
        !Array.isArray(points) ||
        points.length < 3 ||
        points.length > 1000 ||
        !points.every(
          (p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite),
        )
      )
        throw new Error("A closed profile needs at least three finite points.");
      const area = points.reduce(
        (a, p, i) =>
          a +
          p[0] * points[(i + 1) % points.length][1] -
          points[(i + 1) % points.length][0] * p[1],
        0,
      );
      if (Math.abs(area) < 1e-8) throw new Error("Profile has zero area.");
    } else throw new Error("Unsupported sketch profile.");
  } else if (feature.type === "revolve") {
    if (feature.axisReference !== undefined) {
      const a = feature.axisReference;
      if (a.kind === "vector") { if (![a.origin, a.direction].every((v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite)) || Math.hypot(...a.direction) < 1e-9) throw new Error("Revolve axis needs a finite origin and a nonzero direction."); }
      else if (a.kind === "feature") { if (typeof a.featureId !== "string" || (!missingReference(a.featureId) && earlier.get(a.featureId) !== "axis")) throw new Error("Revolve axis must be an earlier axis feature."); }
      else if (a.kind === "two-points") { validateTransformVectorReference(a.from, earlier, missingReference); validateTransformVectorReference(a.to, earlier, missingReference); }
      else validateTransformVectorReference(a, earlier, missingReference);
    }
    if (
      !missingReference(feature.profileFeatureId) && !["profile", "sketch"].includes(
        earlier.get(feature.profileFeatureId) || "",
      )
    )
      throw new Error("Revolve must reference an earlier sketch.");
    positive(feature.angleDegrees, "Revolve angle");
    for (const value of [feature.symmetric, feature.reversed]) {
      if (value !== undefined && typeof value !== "boolean") throw new Error("Invalid revolve direction flag.");
    }
    const second = feature.secondAngleDegrees ?? 0;
    if (!Number.isFinite(second) || second < 0 || feature.angleDegrees + second > 360 || (feature.symmetric && second > 0))
      throw new Error("Revolve angles must total at most 360 degrees; symmetric cannot have a second angle.");
    if (
      feature.angleDegrees > 360 ||
      !["X", "Y", "Z"].includes(feature.axis) ||
      !["new", "add", "cut"].includes(feature.operation)
    )
      throw new Error("Invalid revolve settings.");
  } else if (feature.type === "sweep") {
    if (feature.orientation !== undefined && feature.orientation !== "perpendicular" && feature.orientation !== "parallel" &&
      !(typeof feature.orientation === "object" && feature.orientation.kind === "direction" && Array.isArray(feature.orientation.direction) && feature.orientation.direction.length === 3 && feature.orientation.direction.every(Number.isFinite) && Math.hypot(...feature.orientation.direction) > 1e-9))
      throw new Error("Sweep orientation must be perpendicular, parallel, or a nonzero direction.");
    if (feature.endScale !== undefined && !(Number.isFinite(feature.endScale) && feature.endScale >= 0.01 && feature.endScale <= 100)) throw new Error("Sweep end scale must be between 0.01 and 100.");
    if (feature.rail !== undefined && (typeof feature.rail.pathFeatureId !== "string" || (!missingReference(feature.rail.pathFeatureId) && !["sketch", "profile", "curve3d"].includes(earlier.get(feature.rail.pathFeatureId) ?? "")))) throw new Error("Sweep rail must be a curve of an earlier sketch.");
    if (!missingReference(feature.profileFeatureId) && !["profile", "sketch"].includes(earlier.get(feature.profileFeatureId) || ""))
      throw new Error("Sweep must reference an earlier sketch profile.");
    if (!missingReference(feature.pathFeatureId) && !["profile", "sketch", "curve3d"].includes(earlier.get(feature.pathFeatureId) || ""))
      throw new Error("Sweep must reference an earlier sketch path or 3D sketch.");
    if (!["new", "add", "cut"].includes(feature.operation))
      throw new Error("Invalid sweep settings.");
  } else if (feature.type === "shell") {
    positive(feature.thicknessMillimeters, "Shell thickness");
    if (feature.direction !== undefined && !["inside", "outside", "both"].includes(feature.direction)) throw new Error("Shell direction must be inside, outside or both.");
    if (feature.tangentChain !== undefined && typeof feature.tangentChain !== "boolean") throw new Error("Invalid shell tangent chain flag.");
    if (feature.removedFaces) {
      for (const face of feature.removedFaces) {
        if (face && typeof face === "object" && isShellFaceReference(face)) validateSolidFaceReference(face, earlier, missingReference, "Shell open face");
        else if (!face || !["XY", "XZ", "YZ"].includes(face.plane) || !Number.isFinite(face.offsetMillimeters))
          throw new Error("Invalid shell removed face plane.");
      }
    }
  } else if (feature.type === "mirror") {
    if (
      !missingReference(feature.sourceFeatureId) && !["extrude", "revolve", "sweep", "mirror"].includes(
        earlier.get(feature.sourceFeatureId) || "",
      )
    )
      throw new Error("Mirror must reference an earlier solid feature.");
    if (
      !["XY", "XZ", "YZ"].includes(feature.plane) ||
      !Number.isFinite(feature.offsetMillimeters) ||
      !["add", "cut"].includes(feature.operation)
    )
      throw new Error("Invalid mirror settings.");
    if (feature.mirrorPlane !== undefined) validateMirrorPlane(feature.mirrorPlane, earlier, missingReference);
  } else if (feature.type === "fillet" || feature.type === "chamfer") {
    positive(feature.radiusMillimeters, "Edge finish size");
    if (
      feature.edgePlane &&
      (!["XY", "XZ", "YZ"].includes(feature.edgePlane.plane) ||
        !Number.isFinite(feature.edgePlane.offsetMillimeters))
    )
      throw new Error("Invalid edge selection plane.");
    if (feature.tangentChain !== undefined && (typeof feature.tangentChain !== "boolean" || (feature.tangentChain && !feature.edges))) throw new Error("A tangent chain needs picked edges.");
    if (feature.edges !== undefined) {
      if (!Array.isArray(feature.edges) || !feature.edges.length) throw new Error("Select at least one edge to finish.");
      for (const edge of feature.edges) validateEdgeFinishEdge(edge, earlier, missingReference);
    }
    if (feature.type === "fillet") {
      if (feature.endRadiusMillimeters !== undefined) positive(feature.endRadiusMillimeters, "Fillet end size");
    } else {
      if (feature.secondDistanceMillimeters !== undefined) positive(feature.secondDistanceMillimeters, "Chamfer second distance");
      if (feature.angleDegrees !== undefined && !(feature.angleDegrees > 0 && feature.angleDegrees < 90)) throw new Error("Chamfer angle must be between 0 and 90 degrees.");
      if (feature.secondDistanceMillimeters !== undefined && feature.angleDegrees !== undefined) throw new Error("Give a chamfer a second distance or an angle, not both.");
      if (feature.referenceFace !== undefined) validateSolidFaceReference(feature.referenceFace, earlier, missingReference, "Chamfer reference face");
    }
  } else throw new Error("Unsupported solid feature.");
}
