export { resolvePlaneFrame, principalFrame, canonicalPlaneXDirection, validatePlaneDefinition, type PlaneDefinition, type PlaneReference, type PointReference, type AxisReference } from "./construction-planes";
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

export {validateSolidEdgeReference,type SolidEdgeReference,type SolidEdgeAnchor} from './solid-edge-reference';
