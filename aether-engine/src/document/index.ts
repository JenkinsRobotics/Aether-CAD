export { resolvePlaneFrame, principalFrame, flipSketchFrame, profileFrame, canonicalPlaneXDirection, validatePlaneDefinition, type PlaneDefinition, type PlaneReference, type PointReference, type AxisReference, type SurfacePointReference } from "./construction-planes";
export * from "./part-document";
export * from "./planar-face-anchor";
// Solid feature types + construction-plane frames are engine truth every feature
// editor needs. They were reachable only by deep relative path, which pushed
// consumers past the package boundary (or into redeclaring them).
export * from "./solid-features";
export * from "./tree-organization";
export {evaluateDocumentVariables,type DocumentVariable} from "./variables";
export * from "./part-serialization";

export * from "./file-types";

export * from "./feature-history";

export { resolveProfileDrawing, profileSketchFrame } from "./profile-projection";
export { projectSketchDrawing } from "../sketch/projection/drawing";

export { referenceProfileContour } from "./profile-contour-reference";
// Feature editors stamp a contour id when the user picks a region to build
// on; without it the pick can only be an index, which reordering breaks.
export { identifySketchContour } from "./identify-sketch-contour";
export { identifyProfileContours } from "./profile-contour-identities";

export { updatePartDocumentVariables } from "./update-variables";

export { createSketchClipboard, serializeSketchClipboard, parseSketchClipboard, pasteSketchClipboard, type SketchClipboard } from "./sketch-clipboard";

export { featureReferenceErrors } from "./feature-errors";
export {validateImageCanvases,type ImageCanvas} from './image-canvases';

export * from "./extrusion-point-reference";

export type {ExtrusionStartReference} from './extrusion-start-reference';

export {validateExtrusionScopeResolution,scopeConsumedBodies,type ExtrusionScopeResolution} from './extrusion-scope';

export * from './extrusion-face-reference';

export {type SolidFaceReference,validateSolidFaceReference} from './solid-face-reference';
export {offsetFaceBodies,type OffsetFaceFeature,type FaceTransform} from './offset-face';

export {validateTransform,transformReferences,type PartTransform,type NumericPartTransform,type TransformVectorReference,type TransformFeature} from './part-transform';
export {createdBodyIDs} from './feature-history';

export {validateMirrorPlane,type MirrorPlaneReference} from './mirror-plane';
export {validateSplit,type SplitFeature} from './split';
export {validateDeleteFace,type DeleteFaceFeature} from './delete-face';
export {validatePipe,type PipeFeature} from './pipe';
export {validateBoundingSolid,type BoundingSolidFeature} from './bounding-solid';
export {validateThread,type ThreadFeature} from './thread';
export {validateCoil,type CoilFeature} from './coil';
export {validateRemoveBody,type RemoveBodyFeature} from './remove-body';
export {validateBoss,validateRest,type BossFeature,type RestFeature} from './plastic';
export {resolvePointPosition,validatePointDefinition,type PointDefinition,type ConstructionPointFeature} from './construction-points';
export {resolveAxisLine,validateAxisDefinition,type AxisDefinition,type ConstructionAxisFeature,type AxisLine} from './construction-axes';
export {validateSolidEdgeReference,validateEdgeFinishEdge,type SolidEdgeReference,type SolidEdgeAnchor,type CurvedEdgeReference,type EdgeFinishEdge} from './solid-edge-reference';
export * from "./sketch-regions";
export { patternCopyIds } from "./pattern";
export { surfaceFeatureTypes, surfaceCreatorTypes, validateSurfaceFeature, type SurfaceFeature, type SurfaceExtrudeFeature, type SurfaceRuledFeature, type SurfaceExtendFeature, type SurfaceBoundaryFeature, type SurfaceBlendFeature, type SurfaceUntrimFeature, type SurfaceRevolveFeature, type SurfaceLoftFeature, type SurfacePatchFeature, type SurfaceSweepFeature, type SurfaceOffsetFeature, type SurfaceThickenFeature, type SurfaceStitchFeature, type SurfaceUnstitchFeature, type SurfaceReverseNormalFeature } from "./surface";
export { sheetMetalFeatureTypes, defaultSheetMetalRule, bendAllowanceMillimeters, validateSheetMetalFeature, validateSheetMetalRule, type SheetMetalRule, type SheetMetalFeature, type SheetBaseFeature, type SheetFlangeFeature, type SheetHemFeature, type SheetFoldFeature, type SheetUnfoldFeature, type SheetRefoldFeature } from "./sheet-metal";
export { addConfigurationColumn, removeConfigurationColumn, addConfigurationRow, removeConfigurationRow, setConfigurationValue, applyConfigurationRow, configurationMatches, configurationColumnKey, currentConfigurationValue, validateConfigurations, type ConfigurationColumn, type ConfigurationRow, type ConfigurationTable } from "./configurations";
