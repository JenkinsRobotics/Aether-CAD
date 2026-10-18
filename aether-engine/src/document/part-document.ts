import { validateProfileRegionSelection, profileRegionIdentity } from '../../../freecad-engine/browser/profile-region-reference';
import {validateExtrusionScopeResolution,type ExtrusionScopeResolution} from './extrusion-scope';
import {validateExtrusionStartReference,type ExtrusionStartReference} from './extrusion-start-reference';
import {validateExtrusionPointReference,type ExtrusionPointReference} from "./extrusion-point-reference";
import partFormat from "./part-format.json";
import {validateImageCanvases,type ImageCanvas} from "./image-canvases";
import { featureReferenceErrors } from "./feature-errors";
import {validateExtrusionFaceReference,type ExtrusionFaceReference} from './extrusion-face-reference';
import { validateDocumentTextExpressions } from "./text-expressions";
import { resolveProfileDrawing } from "./profile-projection";
import {evaluateDocumentVariables,type DocumentVariable} from "./variables";
import { validateSketchPresentation } from "./sketch-presentation";
import { validateSolidFeature, type SolidFeature } from "./solid-features";
export * from "./solid-features";
import {
  createCenterRectangleSketch,
  rectangleSketchRevision,
  reviseCenterRectangleSketch,
  validateSketchFeature,
  type RectangleProfile,
  type SketchConstraint,
  type SketchDimension,
  type SketchFeature,
  type SketchPlane,
} from "../sketch/index";

export const PART_DOCUMENT_FORMAT = "aether-part" as const;
export const LEGACY_PART_DOCUMENT_FORMAT = "open-cad-part" as const;
// Geometry-affecting schema additions must advance this boundary: older readers
// must refuse the document rather than silently rebuild a different solid.
export const PART_DOCUMENT_VERSION = partFormat.current;
export const PART_FILE_EXTENSION = ".acpart" as const;

export interface SketchLineDirectionReference {
  kind: "sketch-line";
  sourceFeatureId: string;
  contourId: string;
  segmentId: string;
}

export type {
  RectangleProfile,
  SketchConstraint,
  SketchDimension,
  SketchFeature,
  SketchPlane,
};

export type ExtrudeOperation = "new" | "add" | "cut" | "intersect";

/** Independent opposite extrusion, measured from the common starting plane. */
export interface ExtrudeSecondEnd {
  endType: "blind" | "through-all" | "up-to-next" | "up-to-face" | "up-to-part" | "up-to-vertex";
  distanceMillimeters: number;
  endReference?: ExtrudeFeature["endReference"];
  endPartId?: string;
  endPointReference?: ExtrusionPointReference;
  endOffsetMillimeters?: number;
  draftAngleDegrees?: number;
}

export interface ExtrudeFeature {
  id: string;
  type: "extrude";
  name: string;
  profileFeatureId: string;
  /** Which closed region of that sketch to extrude. Absent means the sketch's
   *  only region — a sketch holding several needs one named, or the feature is
   *  ambiguous. Identity is the contour's own id, scoped to its source profile,
   *  so editing or reordering coordinates cannot retarget the link. */
  profileContourId?: string;
  profileContourIds?: string[];
  profileRegion?: import('../../../freecad-engine/browser/profile-region-reference').ProfileRegionReference;
  profileSelections?: ({ profileFeatureId: string } & import('../../../freecad-engine/browser/profile-region-reference').ProfileRegionSelection)[];
  regionMode?: "faces";
  /** New extrusions expose each disconnected solid as an independent body. */
  separateBodies?: boolean;
  /** Native output identities, updated only by a successful rebuild. */
  bodyOutputs?: string[];
  scopeMode?: "all";
  scopeResolution?: ExtrusionScopeResolution;
  distanceMillimeters: number;
  endType?: "blind" | "symmetric" | "through-all" | "symmetric-through-all" | "up-to-next" | "up-to-face" | "up-to-part" | "up-to-vertex";
  /** Unit world vector; absent follows the evaluated sketch normal. */
  directionVector?: [number, number, number];
  directionReference?: SketchLineDirectionReference;
  /** Wall offsets around selected curves. Absent retains filled-profile extrusion. */
  thin?: {
    thickness1Millimeters: number;
    thickness2Millimeters: number;
    midplane?: boolean;
    midplaneThicknessMillimeters?: number;
    flipped?: boolean;
  };
  /** Stable stopping part, evaluated at this feature’s history position. */
  endPartId?: string;
  endPointReference?: ExtrusionPointReference;
  endReference?: ExtrusionFaceReference;
  startingReference?: ExtrusionStartReference;
  startingOffsetMillimeters?: number;
  /** Signed distance before the next stopping face; negative extends beyond it. */
  endOffsetMillimeters?: number;
  /** Legacy opposite depth; editing can replace it with an independent secondEnd. */
  secondDistanceMillimeters?: number;
  secondEnd?: ExtrudeSecondEnd;
  /** Signed taper about the source sketch plane: positive narrows, negative widens. */
  draftAngleDegrees?: number;
  reversed?: boolean;
  operation: ExtrudeOperation;
  bodyId?: string;
  targetBodyId?: string;
  /** Explicit parts for Add/Remove/Intersect; Add retains the first target ID. */
  targetBodyIds?: string[];
  suppressed: boolean;
}

export type PartFeature = SketchFeature | ExtrudeFeature | SolidFeature;

import { validateTreeOrganization, type TreeOrganization } from "./tree-organization";

export interface PartDocument {
  format: typeof PART_DOCUMENT_FORMAT;
  formatVersion: typeof PART_DOCUMENT_VERSION;
  documentId: string;
  name: string;
  units: "millimeter";
  features: PartFeature[];
  variables?:DocumentVariable[];
  rollbackIndex?: number;
  imageCanvases?: ImageCanvas[];
  sketchPresentation?: Record<string, import("./sketch-presentation").SketchPresentation>;
  bodyProperties?: Record<string, { name: string; visible: boolean; description?: string; category?: string }>;
  /** Feature tree folders/grouping; organization only — never evaluation order. */
  organization?: TreeOrganization;
}

export interface RectanglePartParameters {
  widthMillimeters: number;
  heightMillimeters: number;
  depthMillimeters: number;
}

export interface PartDocumentIds {
  documentId: string;
  sketchId: string;
  extrudeId: string;
}

export interface RectanglePartCreationOptions {
  plane?: SketchPlane;
  fullyDefinedSketch?: boolean;
}

interface RuntimeCrypto {
  randomUUID?: () => string;
}

function portableId(): string {
  const runtime = globalThis as typeof globalThis & { crypto?: RuntimeCrypto };
  const generated = runtime.crypto?.randomUUID?.();
  if (generated) return generated;
  return `aether-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function createEmptyPartDocument(name: string): PartDocument {
  const doc: PartDocument = {
    format: PART_DOCUMENT_FORMAT,
    formatVersion: PART_DOCUMENT_VERSION,
    documentId: portableId(),
    name: name.trim(),
    units: "millimeter",
    features: [],
  };
  validatePartDocument(doc);
  return doc;
}

function defaultPartDocumentIds(): PartDocumentIds {
  return {
    documentId: portableId(),
    sketchId: portableId(),
    extrudeId: portableId(),
  };
}

function requirePositiveFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be greater than zero.`);
  }
}

export function createRectanglePartDocument(
  name: string,
  parameters: RectanglePartParameters,
  ids: PartDocumentIds = defaultPartDocumentIds(),
  options: RectanglePartCreationOptions = {},
): PartDocument {
  const normalizedName = name.trim();
  if (!normalizedName) throw new Error("Part name is required.");
  requirePositiveFinite(parameters.widthMillimeters, "Sketch width");
  requirePositiveFinite(parameters.heightMillimeters, "Sketch height");
  requirePositiveFinite(parameters.depthMillimeters, "Extrude distance");
  return {
    format: PART_DOCUMENT_FORMAT,
    formatVersion: PART_DOCUMENT_VERSION,
    documentId: ids.documentId,
    name: normalizedName,
    units: "millimeter",
    features: [
      createCenterRectangleSketch(
        ids.sketchId,
        options.plane ?? "XY",
        parameters.widthMillimeters,
        parameters.heightMillimeters,
        options.fullyDefinedSketch ?? true,
      ),
      {
        id: ids.extrudeId,
        type: "extrude",
        name: "Extrude 1",
        profileFeatureId: ids.sketchId,
        distanceMillimeters: parameters.depthMillimeters,
        operation: "new",
        suppressed: false,
      },
    ],
  };
}

export function rectanglePartParameters(
  document: PartDocument,
): RectanglePartParameters {
  validatePartDocument(document);
  const sketch = document.features.find(
    (feature): feature is SketchFeature => feature.type === "sketch",
  );
  const extrude = document.features.find(
    (feature): feature is ExtrudeFeature => feature.type === "extrude",
  );
  if (!sketch || !extrude) throw new Error("Part needs a Sketch and Extrude.");
  const solvedSketch = rectangleSketchRevision(sketch);
  return {
    widthMillimeters: solvedSketch.widthMillimeters,
    heightMillimeters: solvedSketch.heightMillimeters,
    depthMillimeters: extrude.distanceMillimeters,
  };
}

export function reviseRectanglePartDocument(
  document: PartDocument,
  name: string,
  parameters: RectanglePartParameters,
): PartDocument {
  validatePartDocument(document);
  const normalizedName = name.trim();
  if (!normalizedName) throw new Error("Part name is required.");
  requirePositiveFinite(parameters.widthMillimeters, "Sketch width");
  requirePositiveFinite(parameters.heightMillimeters, "Sketch height");
  requirePositiveFinite(parameters.depthMillimeters, "Extrude distance");
  const sketch = document.features.find(
    (feature): feature is SketchFeature => feature.type === "sketch",
  );
  const extrude = document.features.find(
    (feature): feature is ExtrudeFeature => feature.type === "extrude",
  );
  if (!sketch || !extrude) throw new Error("Part needs a Sketch and Extrude.");
  const current = rectangleSketchRevision(sketch);
  return {
    ...document,
    name: normalizedName,
    features: document.features.map((feature) =>
      feature.id === sketch.id
        ? reviseCenterRectangleSketch(sketch, {
            ...current,
            widthMillimeters: parameters.widthMillimeters,
            heightMillimeters: parameters.heightMillimeters,
            widthDimensioned: true,
            heightDimensioned: true,
          })
        : feature.id === extrude.id
          ? { ...extrude, distanceMillimeters: parameters.depthMillimeters }
          : feature,
    ),
  };
}

export function replaceRectangleSketch(
  document: PartDocument,
  sketch: SketchFeature,
): PartDocument {
  validatePartDocument(document);
  validateSketchFeature(sketch);
  const currentSketch = document.features.find(
    (feature): feature is SketchFeature => feature.type === "sketch",
  );
  if (!currentSketch || currentSketch.id !== sketch.id) {
    throw new Error("Edited Sketch does not belong to this Part.");
  }
  return {
    ...document,
    features: document.features.map((feature) =>
      feature.type === "sketch" ? sketch : feature,
    ),
  };
}

export function validatePartDocument(
  value: unknown,
): asserts value is PartDocument {
  if (!value || typeof value !== "object") {
    throw new Error("Part file is not an object.");
  }
  const document = value as Partial<PartDocument>;
  if (document.format !== PART_DOCUMENT_FORMAT) {
    throw new Error(
      `Unsupported Part format: ${String(document.format ?? "missing")}.`,
    );
  }
  if (document.formatVersion !== PART_DOCUMENT_VERSION) {
    throw new Error(
      `Unsupported Part format version: ${String(document.formatVersion ?? "missing")}. Update Aether CAD to open newer Part files.`,
    );
  }
  const expressionVariables = evaluateDocumentVariables(document.variables);
  validateSketchPresentation(document.sketchPresentation);
  validateImageCanvases(document.imageCanvases);
  validateTreeOrganization(document.organization);
  if (!document.documentId || typeof document.documentId !== "string") {
    throw new Error("Part documentId is required.");
  }
  if (!document.name?.trim()) throw new Error("Part name is required.");
  if (document.units !== "millimeter") {
    throw new Error("Part units must be millimeter.");
  }
  if (!Array.isArray(document.features)) {
    throw new Error("Part features must be an array.");
  }

  if (
    document.rollbackIndex !== undefined &&
    (!Number.isInteger(document.rollbackIndex) ||
      document.rollbackIndex < 0 ||
      document.rollbackIndex > document.features.length)
  )
    throw new Error("Rollback position is outside the feature history.");
  if (document.bodyProperties !== undefined) {
    if (!document.bodyProperties || typeof document.bodyProperties !== "object")
      throw new Error("Invalid body properties.");
    for (const value of Object.values(document.bodyProperties))
      if (
        !value ||
        typeof value.name !== "string" ||
        !value.name.trim() ||
        typeof value.visible !== "boolean"
      )
        throw new Error("Bodies need a name and visibility state.");
  }
  const ids = new Set<string>();
  // A deleted reference is a recoverable evaluation error, not a corrupt file.
  // Existing references must still point to an earlier feature of the right type.
  const allIds = new Set(document.features.map(f => f?.id));
  const missingReference = (id: unknown) => typeof id === "string" && !!id.trim() && !allIds.has(id);
  const earlier = new Map<string, string>();
  const bodies = new Set<string>();
  document.features.forEach((feature, index) => {
    if (
      !feature ||
      typeof feature !== "object" ||
      typeof feature.id !== "string" ||
      !feature.id ||
      ids.has(feature.id)
    )
      throw new Error("Feature IDs must be unique.");
    if (typeof feature.name !== "string" || !feature.name.trim())
      throw new Error(`Feature ${index + 1} needs a name.`);
    if (typeof feature.suppressed !== "boolean")
      throw new Error(`${feature.name} has an invalid suppressed state.`);
    ids.add(feature.id);
    if ('profileRegion' in feature && feature.profileRegion !== undefined) {
      if (!['extrude', 'revolve', 'sweep'].includes(feature.type)) throw Error('This feature does not accept a connected sketch region.');
      validateProfileRegionSelection(feature as import('../../../freecad-engine/browser/profile-region-reference').ProfileRegionSelection);
    }
    if (feature.type === 'extrude') {
      if (feature.profileRegion && (feature.thin || feature.profileContourIds)) throw Error('A connected region cannot also reference individual extrusion curves.');
      for (const selection of Array.isArray(feature.profileSelections) ? feature.profileSelections : []) {
        if (!selection) throw Error('Choose valid sketch regions.');
        validateProfileRegionSelection(selection);
        if (feature.thin && selection.profileRegion) throw Error('Thin extrusion references individual curves, not connected faces.');
      }
    }
    if(feature.type==='transform'){
      const outputs=feature.copyBodyIds?Object.values(feature.copyBodyIds):[];
      for(const id of outputs){if(bodies.has(id))throw Error('Copy outputs need new body identities.');bodies.add(id);}
    } else if (
      (feature.type === "extrude" || feature.type === "revolve" || feature.type === "sweep" || feature.type === "loft" || feature.type === "import-step" || feature.type === "import-cad") &&
      feature.operation === "new"
    ) {
      const id =
        feature.bodyId ??
        (bodies.size === 0
          ? `${document.documentId}:body-1`
          : `${document.documentId}:body-${feature.id}`);
      if (typeof id !== "string" || !id || bodies.has(id))
        throw new Error("Body IDs must be unique.");
      const outputs = feature.type === "extrude" && feature.separateBodies && feature.bodyOutputs ? feature.bodyOutputs : [id];
      if (!Array.isArray(outputs) || !outputs.length) throw new Error("Extrusion needs output body identities.");
      for (const output of outputs) {
        if (typeof output !== "string" || !output.trim() || bodies.has(output)) throw new Error("Body IDs must be unique.");
        bodies.add(output);
      }
    } else if (!["profile", "sketch", "plane"].includes(feature.type)) {
      if (!bodies.size && feature.type!=="offset-face" && !("targetBodyId" in feature && feature.targetBodyId))
        throw new Error(
          `${feature.name} needs an earlier body-producing feature.`,
        );
      if (
        "targetBodyId" in feature &&
        feature.targetBodyId &&
        typeof feature.targetBodyId !== "string"
      )
        throw new Error(
          `${feature.name} refers to an unavailable target body.`,
        );
    }
    if (feature.type === "sketch") validateSketchFeature(feature);
    else if (feature.type === "extrude") {
      if (
        !missingReference(feature.profileFeatureId) && !["sketch", "profile"].includes(
          earlier.get(feature.profileFeatureId) || "",
        )
      )
        throw new Error("Extrude must reference an earlier Sketch.");
      if (!["new", "add", "cut", "intersect"].includes(feature.operation))
        throw new Error("Unsupported extrude operation.");
      if (feature.scopeMode !== undefined && (feature.scopeMode!=="all" || !["add","cut","intersect"].includes(feature.operation) || feature.targetBodyId!==undefined || feature.targetBodyIds!==undefined)) throw Error("Automatic extrusion scope cannot also specify target parts.");
      if(feature.scopeResolution!==undefined){
        if(feature.scopeMode!=="all")throw Error("A scope resolution requires automatic scope.");
        validateExtrusionScopeResolution(feature.scopeResolution);
      }
      if (feature.targetBodyIds !== undefined) {
        const scope=feature.targetBodyIds;
        if (!["add","cut","intersect"].includes(feature.operation) || !Array.isArray(scope) || !scope.length || scope.length>256 || scope.some(id=>typeof id!=="string" || !id.trim()) || new Set(scope).size!==scope.length || feature.targetBodyId!==scope[0]) throw Error("Extrusion scope needs distinct parts and a matching primary target for Add, Remove or Intersect.");
      }
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
      }
      if (feature.separateBodies !== undefined && typeof feature.separateBodies !== "boolean") throw Error("Invalid separate bodies option.");
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
        if (["through-all", "symmetric-through-all"].includes(end.endType ?? "") && !["cut", "intersect"].includes(feature.operation)) throw Error("Through all requires Remove or Intersect.");
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
    } else validateSolidFeature(feature, earlier, missingReference);
    earlier.set(feature.id, feature.type);
  });
  validateDocumentTextExpressions(document.features, expressionVariables);
  // Hidden history is still saveable when a valid source reference is lost.
  // Runtime availability remains bounded by the actual rollback position.
  const referenceErrors = featureReferenceErrors({ ...document, rollbackIndex: undefined } as PartDocument);
  for(const feature of document.features) {
    if(!feature.suppressed&&!referenceErrors.has(feature.id)&&feature.type==='profile') {
      const drawing=feature.profile.type==='drawing'?feature.profile:feature.profile.type==='projection'?feature.profile.authored:undefined;
      if(drawing?.constraints?.some(c=>c.kind==='pierce'))resolveProfileDrawing(document.features.map(f=>f.id===feature.id?{...f,suppressed:false}:f),feature.id);
    }
    if(!referenceErrors.has(feature.id) && feature.type==="profile" && feature.profile.type==="projection" && !missingReference(feature.profile.sourceFeatureId) && feature.profile.authored?.constraints?.some(c=>[c.a,c.b,c.axis].some(r=>r?.projectedContourId!==undefined))) {
      // Validate against actual projected geometry, never silently discard external relations.
      resolveProfileDrawing(document.features.map(f=>f.type==="profile"?{...f,suppressed:false}:f),feature.id);
    }
  }
}
