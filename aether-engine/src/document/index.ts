export { resolvePlaneFrame, principalFrame, flipSketchFrame, profileFrame, canonicalPlaneXDirection, validatePlaneDefinition, type PlaneDefinition, type PlaneReference, type PointReference, type AxisReference, type SurfacePointReference } from "./construction-planes";
export { validateExtrusionDirectionReference, type ExtrusionDirectionReference } from './extrusion-direction-reference';
export * from "./part-document";
export * from "./planar-face-anchor";
// Solid feature types + construction-plane frames are engine truth every feature
// editor needs. They were reachable only by deep relative path, which pushed
// consumers past the package boundary (or into redeclaring them).
export * from "./solid-features";
export * from "./tree-organization";
export {evaluateDocumentVariables,type DocumentVariable} from "./variables";
export * from "./part-serialization";
export { editProfileDimension } from "./profile-dimension";

export * from "./file-types";

export * from "./feature-history";
export * from "./component-split";
export { validateCurve3D, curve3dPolylines, moveCurve3DPoint, arc3dGeometry, solve3DConstraints, type Curve3DFeature, type Constraint3D, type Constraint3DKind, type Solve3DReport } from "./curve3d";
export { replaceSketchDrawing } from "./sketch-replace";
export { breakProjectionLink } from "./break-link";
export { STANDARD_PARTS, standardPartLibrary, standardPartDocument, standardPartIssues, standardPartLabel, standardPartVolume, standardPartProperties, standardPartFromProperties, resolveFastenerSeats, type StandardPartFamily, type StandardPartRequest, type FastenerSeat } from "./standard-parts";
export { validateConfigRules, applyConfigRules, activateConfiguration, previewConfiguration, setConfigRule, removeConfigRule, type ConfigRule, type RuleCondition, type RuleEffect, type RuleOperator, type RuleTrace } from "./config-rules";
export { PLASTIC_RULE_LIBRARY, validatePlasticRules, plasticRuleFor, setPlasticRule, removePlasticRule, setActivePlasticRule, assignPlasticRule, type PlasticRule, type PlasticRulesTable } from "./plastic-rules";

export { resolveProfileDrawing, profileSketchFrame } from "./profile-projection";
export { projectSketchDrawing } from "../sketch/projection/drawing";

export { referenceProfileContour } from "./profile-contour-reference";
// Feature editors stamp a contour id when the user picks a region to build
// on; without it the pick can only be an index, which reordering breaks.
export { identifySketchContour, identifyDocumentSketches } from "./identify-sketch-contour";
export { identifyProfileContours } from "./profile-contour-identities";

export { updatePartDocumentVariables } from "./update-variables";

export { createSketchClipboard, serializeSketchClipboard, parseSketchClipboard, pasteSketchClipboard, type SketchClipboard } from "./sketch-clipboard";

export { featureReferenceErrors } from "./feature-errors";
export {validateImageCanvases,type ImageCanvas} from './image-canvases';

export * from "./extrusion-point-reference";

export type {ExtrusionStartReference} from './extrusion-start-reference';

export {validateExtrusionScopeResolution,scopeConsumedBodies,usesExtrusionScopeResolution,type ExtrusionScopeResolution} from './extrusion-scope';

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
export {validatePrimitive,type PrimitiveFeature,type PrimitiveKind} from './primitive';
export { validateThread, resolveThreadGeometry, type ThreadFeature, type ThreadForm } from './thread';
export { validateEmboss, type EmbossFeature } from './emboss';
export { FRAME_PROFILE_LIBRARY, findFrameProfile, resolveFrameProfile, validateFrameMember, validateFrameEndCap, validateFrameTrim, validateFrameGusset, frameCutList, frameCutListCSV, type FrameProfileKind, type FrameProfileSpec, type CustomFrameProfile, type FrameMemberFeature, type FrameEndCapFeature, type FrameTrimFeature, type FrameGussetFeature, type FrameCutListRow } from './frame';
export {validateCoil,type CoilFeature} from './coil';
export {validateRemoveBody,type RemoveBodyFeature} from './remove-body';
export {validateBoss,validateRest,type BossFeature,type RestFeature} from './plastic';
export {resolvePointPosition,validatePointDefinition,type PointDefinition,type ConstructionPointFeature} from './construction-points';
export {resolveAxisLine,validateAxisDefinition,type AxisDefinition,type ConstructionAxisFeature,type AxisLine} from './construction-axes';
export {validateSolidEdgeReference,validateEdgeFinishEdge,type SolidEdgeReference,type SolidEdgeAnchor,type CurvedEdgeReference,type EdgeFinishEdge} from './solid-edge-reference';
export * from "./sketch-regions";
export { patternCopyIds } from "./pattern";
export { surfaceFeatureTypes, surfaceCreatorTypes, validateSurfaceFeature, type SurfaceFeature, type SurfaceExtrudeFeature, type SurfaceRuledFeature, type SurfaceExtendFeature, type SurfaceBoundaryFeature, type SurfaceBlendFeature, type SurfaceMatchFeature, type SurfaceFilletFeature, type SurfaceUntrimFeature, type SurfaceRevolveFeature, type SurfaceLoftFeature, type SurfacePatchFeature, type SurfaceSweepFeature, type SurfaceOffsetFeature, type SurfaceThickenFeature, type SurfaceStitchFeature, type SurfaceUnstitchFeature, type SurfaceReverseNormalFeature } from "./surface";
export { sheetBendTable, bendTableCSV, type BendTableRow, type SheetPerforateFeature } from "./sheet-metal";
export { sheetMetalFeatureTypes, defaultSheetMetalRule, SHEET_METAL_RULE_LIBRARY, bendAllowanceMillimeters, validateSheetMetalFeature, validateSheetMetalRule, type NamedSheetMetalRule, type SheetMetalRule, type SheetMetalFeature, type SheetBaseFeature, type SheetConvertFeature, type SheetPathFlangeFeature, type SheetFlangeFeature, type SheetHemFeature, type SheetFoldFeature, type SheetUnfoldFeature, type SheetRefoldFeature } from "./sheet-metal";
export { validateSheetMetalRules, validateNamedSheetMetalRule, sheetMetalRuleFor, setSheetMetalRule, removeSheetMetalRule, setActiveSheetMetalRule, assignSheetMetalRule, type SheetMetalRulesTable } from "./sheet-metal-rules";
export { addConfigurationColumn, removeConfigurationColumn, addConfigurationRow, removeConfigurationRow, setConfigurationValue, applyConfigurationRow, updateConfigurationFromDesign, configurationMatches, configurationColumnKey, currentConfigurationValue, validateConfigurations, type ConfigurationColumn, type ConfigurationRow, type ConfigurationTable } from "./configurations";

export { variableUsers, variableGraph, setVariableComment, setVariableFavorite, moveVariable, renameVariable, safeDeleteVariable, exportVariables, importVariables, completeExpression, referencedVariables, expressionFunctions, expressionUnits, type VariableUsers, type VariableGraph, type CompletionSuggestion } from "./variable-tools";
export { PHYSICAL_MATERIAL_LIBRARY, findPhysicalMaterial, assignBodyMaterial, clearBodyMaterial, materialForBody, validateMaterialCard, directionalElasticModulus, type PhysicalMaterialCard, type MaterialValidationReport } from "./physical-materials";
export { applyFeatureExpressions, evaluateFeatureExpression } from "./feature-expressions";
export { evaluateExpression } from "../expressions/evaluate";
export { validateDocumentNotes, addDocumentNote, updateDocumentNote, deleteDocumentNote, listDocumentNotes, type DocumentNote } from "./notes";
export { copyFeatures, pastePosition } from "./timeline-clipboard";
export { exportPartScript } from "./script-export";

export { identifySurfaceExtrusionProfiles } from './surface-extrusion-identities';
