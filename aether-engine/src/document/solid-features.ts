import {validateTransform,type TransformFeature} from './part-transform';
export type {TransformFeature} from './part-transform';
import {validateOffsetFace,type OffsetFaceFeature} from './offset-face';
export type {OffsetFaceFeature} from './offset-face';
import {validateImportCAD, type ImportCADFeature} from "./import-cad";
export {cadImportExtensions,isMeshImportFormat,type CADImportFormat,type MeshImportUnits,type ImportCADFeature} from "./import-cad";
import {validateFaceExtrude, type FaceExtrudeFeature} from "./face-extrude";
import {validatePlanarFaceAnchor, type PlanarFaceAnchor} from './planar-face-anchor';
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
import { localPierceValidation } from '../../../freecad-engine/browser/pierce-context';
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
  profileRegion?: import('../../../freecad-engine/browser/profile-region-reference').ProfileRegionReference;
  axis: "X" | "Y" | "Z";
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
  suppressed: boolean;
} & ({ type: "fillet" } | { type: "chamfer" });
export interface SweepFeature {
  id: string;
  type: "sweep";
  name: string;
  profileFeatureId: string;
  profileContourId?: string;
  profileRegion?: import('../../../freecad-engine/browser/profile-region-reference').ProfileRegionReference;
  pathFeatureId: string;
  pathContourId?: string;
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
  removedFaces?: { plane: SketchPlane; offsetMillimeters: number }[];
  suppressed: boolean;
}
export type SolidFeature = TransformFeature |
  OffsetFaceFeature | FaceExtrudeFeature | BooleanFeature | PatternFeature | DraftFeature | LoftFeature | HoleFeature | ImportCADFeature | ImportSTEPFeature | PlaneFeature | ProfileFeature | RevolveFeature | SweepFeature | MirrorFeature | EdgeFinishFeature | ShellFeature;
export function validateSolidFeature(
  feature: SolidFeature,
  earlier: Map<string, string>,
  missingReference: (id: unknown) => boolean = () => false,
): void {
  if (feature.type === "transform") return validateTransform(feature,earlier,missingReference);
  if (feature.type === "offset-face") return validateOffsetFace(feature, earlier, missingReference);
  if (feature.type === "face-extrude") return validateFaceExtrude(feature, earlier, missingReference);
  if (feature.type === "boolean") return validateBoolean(feature);
  if (feature.type === "pattern") { validatePattern(feature, earlier, missingReference); return; }
  if (feature.type === "draft") { validateDraft(feature); return; }
  if (feature.type === "loft") { validateLoft(feature, earlier, missingReference); return; }
  if (feature.type === "hole") { validateHole(feature, earlier, missingReference); return; }
  if (feature.type === "import-cad") { validateImportCAD(feature); return; }
  if (feature.type === "import-step") { validateImportSTEP(feature); return; }
  const positive = (value: number, label: string) => {
    if (!Number.isFinite(value) || value <= 0)
      throw new Error(`${label} must be positive.`);
  };
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
    if (!missingReference(feature.profileFeatureId) && !["profile", "sketch"].includes(earlier.get(feature.profileFeatureId) || ""))
      throw new Error("Sweep must reference an earlier sketch profile.");
    if (!missingReference(feature.pathFeatureId) && !["profile", "sketch"].includes(earlier.get(feature.pathFeatureId) || ""))
      throw new Error("Sweep must reference an earlier sketch path.");
    if (!["new", "add", "cut"].includes(feature.operation))
      throw new Error("Invalid sweep settings.");
  } else if (feature.type === "shell") {
    positive(feature.thicknessMillimeters, "Shell thickness");
    if (feature.removedFaces) {
      for (const face of feature.removedFaces) {
        if (!["XY", "XZ", "YZ"].includes(face.plane) || !Number.isFinite(face.offsetMillimeters))
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
  } else if (feature.type === "fillet" || feature.type === "chamfer") {
    positive(feature.radiusMillimeters, "Edge finish size");
    if (
      feature.edgePlane &&
      (!["XY", "XZ", "YZ"].includes(feature.edgePlane.plane) ||
        !Number.isFinite(feature.edgePlane.offsetMillimeters))
    )
      throw new Error("Invalid edge selection plane.");
  } else throw new Error("Unsupported solid feature.");
}
