export { extractExactTopology } from "./exact-topology";
export {
  projectHiddenLineView,
  type HiddenLineView,
  type HiddenLineOptions,
  type ViewPolyline,
} from "./hidden-line";
export { evaluatePartDocument, FeatureFailure, UnsupportedFeature } from "./part-evaluator";
export { measureDistance } from "./measure";
export { buildPartGeometry } from "./part-geometry";
export { OCCTWorkerClient, EngineError } from "./worker-client";
export { solveAssemblyJob, solvableMateKinds, jointResiduals, dofValue, evaluateCamTable } from "./assembly-solver";
export { solveAssemblyIK, driveJoint, sweepJoint, findJointLimits, type AssemblyIKRequest, type AssemblyIKResult, type JointDriveResult, type JointSweepSample } from "./assembly-kinematics";
export { analyzePart } from "./analysis";
export { runParameterSweep, compareParameterVariants, type ParameterSweepStep, type ParameterSweepResult, type ParameterVariantSpec, type ParameterVariantOutcome } from "./parameter-sweep";
export { exportPart, exportPartOBJWithMTL } from "./export";
export { exportCurrentViewDXF, type CurrentViewDXFOptions, type CurrentViewDXFResult } from "./view-dxf";
export { extractSheetFlatPattern, sheetFlatPatternToDXF, type FlatPatternLine, type FlatPatternResult } from "./features/sheet-metal-flat";
export { projectPartDrawing } from "./drawing-projection";
export { sketchSectionContours } from "./sketch-section";
export { projectModelGeometry } from "./sketch-projection";
