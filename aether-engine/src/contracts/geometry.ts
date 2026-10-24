import type { PartDocument } from "../document/index";

export type Vec3 = readonly [number, number, number];

export type ConnectorKind =
  | "face-center"
  | "edge-midpoint"
  | "vertex"
  | "circle-center"
  | "ellipse-center"
  | "cylinder-axis"
  | "cone-axis"
  | "sphere-center"
  | "torus-center";

export interface ConnectorFrameData {
  origin: Vec3;
  xAxis: Vec3;
  yAxis: Vec3;
  zAxis: Vec3;
}

export interface TopologyMeasurements {
  lengthMillimeters?: number;
  radiusMillimeters?: number;
  areaSquareMillimeters?: number;
  centerMillimeters?: Vec3;
  /** Exact unit directions, present only for straight edges / planar faces. */
  linearDirection?: Vec3;
  planarNormal?: Vec3;
  /** A circular edge's axis (the circle's normal); a cylinder's axis through a rim pick. */
  axisDirection?: Vec3;
}

export interface ConnectorCandidate extends ConnectorFrameData {
  edgeAnchor?: import("../document/solid-edge-reference").SolidEdgeAnchor;
  vertexAnchor?: import("../document/extrusion-point-reference").SolidVertexAnchor;
  measurements?: TopologyMeasurements;
  id: string;
  faceId: number;
  kind: ConnectorKind;
  label: string;
}

export interface FaceTopologyData {
  surfaceReference?: import("../document/extrusion-face-reference").CurvedSurfaceAnchor;
  measurements?: TopologyMeasurements;
  id: number;
  surfaceType: string;
  candidates: ConnectorCandidate[];
}

export interface FaceRangeData {
  start: number;
  count: number;
  faceId: number;
}

export interface PartGeometryData {
  geometryKind?: "solid" | "mesh";
  id: string;
  name: string;
  sourceDocumentId: string;
  sourceName: string;
  vertices: Float32Array;
  normals: Float32Array;
  triangles: Uint32Array;
  edgeLines: Float32Array;
  faceRanges: FaceRangeData[];
  topology: FaceTopologyData[];
}

/** Evaluated UI metadata. Never persisted or used as feature geometry input. */
export interface ExtrusionPreviewAxis {
  side: "primary" | "opposite";
  parameter: "distance" | "second";
  originMillimeters: [number, number, number];
  direction: [number, number, number];
  scale: 1 | 0.5;
  reversed: boolean;
}

/** A manipulator the preview offers for one numeric parameter of the previewed feature
 *  (every feature with a length, angle or size the viewport can drag): a linear handle
 *  slides along `direction` from `originMillimeters`; an angular one turns about it. */
export interface PreviewHandle {
  parameter: string;
  kind: "linear" | "angular";
  originMillimeters: [number, number, number];
  direction: [number, number, number];
  /** Linear: control value per millimetre dragged (0.5 for a symmetric extent). */
  scale?: number;
  /** Linear: the control may go negative (a push as well as a pull). */
  signed?: boolean;
  label?: string;
}
export interface TransformPreviewFrame {
  centerMillimeters: [number, number, number];
  radiusMillimeters: number;
  resolvedTransform?: import("../document/part-transform").NumericPartTransform;
  referenceDirection?: [number,number,number];
}

export interface ImportedModelData {
  /** Transient exact feature changes, never selectable/persisted bodies. */
  featurePreviewUnavailable?: boolean;
  featurePreview?: { base: PartGeometryData[]; added: PartGeometryData[]; removed: PartGeometryData[]; featureId?: string; extrusionAxes?: ExtrusionPreviewAxis[]; transformFrame?: TransformPreviewFrame };
  /** Manipulators for the previewed feature's parameters (see PreviewHandle). */
  previewHandles?: PreviewHandle[];
  previewFeatureId?: string;
  bodyOutputs?: Record<string, string[]>;
  scopeResolutions?: Record<string, import("../document/extrusion-scope").ExtrusionScopeResolution>;
  sketchFrames?: Record<string, import("../sketch/drawing").SketchFrame>;
  sourceName: string;
  parts: PartGeometryData[];
  parseMilliseconds: number;
  /** How many history entries the engine actually rebuilt (the rest came from its cache). */
  replayedFeatures?: number;
}

export interface MateConnector {
  id: string;
  name: string;
  partId: string;
  partName: string;
  candidate: ConnectorCandidate;
}

export interface AppliedMate {
  id: string;
  movingPartId: string;
  targetPartId: string;
  movingConnectorId: string;
  targetConnectorId: string;
  movingConnector: ConnectorCandidate;
  targetConnector: ConnectorCandidate;
}

/** Exact analyses and file output, in the shape the FreeCAD services answered with. */
export interface AnalysisOptions { kind: "properties" | "section" | "interference" | "clearance" | "compare" | "continuity" | "curvature_comb" | "isocurve" | "minimum_radius" | "intersection_curve" | "isoparametric_curve" | "project_curve" | "mesh_convert"; /** mesh_convert: fitting tolerance, mm. */ tolerance_mm?: number; /** isoparametric_curve: the parameter the curve runs along. */ uv?: "u" | "v"; /** isoparametric_curve: a point it passes through, mm. */ point_mm?: [number, number, number]; /** project_curve: world sketch polylines, mm, and the projection direction. */ polylines?: [number, number, number][][]; direction?: [number, number, number]; /** curve analyses: the faces or edges to analyse (default: all). */ entities?: MeasureEntity[]; /** isocurve: curves each way; curvature_comb: samples per edge. */ count?: number; /** curvature_comb: tooth mm per 1/mm of curvature. */ scale?: number; /** minimum_radius: flag radii below this (mm). */ radius_mm?: number; plane?: "XY" | "XZ" | "YZ"; offset_mm?: number; reverse?: boolean; density_kg_m3?: number; /** compare: the two bodies (default: the first two); clearance: the bodies to check (default: all). */ bodyIds?: string[]; /** compare: a difference smaller than this (mm³) counts as none. */ tolerance_mm3?: number }
export interface AnalysisResult { status: "ok"; kind: AnalysisOptions["kind"]; bodies: PartGeometryData[]; measurements: Record<string, unknown>[]; /** World polylines the viewport draws for curve analyses. */ curves?: { label: string; color: string; polylines: [number, number, number][][] }[] }
export interface ExportOptions { format: "step" | "stl"; bodyIds?: string[] | null; toleranceMillimeters?: number }
export interface ExportResult { format: "step" | "stl"; units: "mm"; body_count: number; bytes: ArrayBuffer }

export type WorkerRequest =
  | { type: "analyze-part"; requestId: number; document: PartDocument; options: AnalysisOptions }
  | { type: "check-contacts"; requestId: number; input: import("../kernel/contacts").ContactCheckInput }
  | { type: "export-part"; requestId: number; document: PartDocument; options: ExportOptions }
  | {
      type: "import-step";
      requestId: number;
      sourceName: string;
      bytes: ArrayBuffer;
    }
  | {
      type: "evaluate-part";
      requestId: number;
      document: PartDocument;
      options?: { preview?: boolean };
    }
  | {
      /** Exact minimum distance between two entities of the evaluated document. */
      type: "measure-distance";
      requestId: number;
      document: PartDocument;
      entities: MeasureEntity[];
    }
  | {
      /** The sketch plane's section through the bodies, or the body edges lying in it, as sketch contours. */
      type: "sketch-section";
      requestId: number;
      document: PartDocument;
      frame: import("../sketch/drawing").SketchFrame;
      kind: "section" | "edges" | "fit" | "spun";
      /** spun: the axis, two points in sketch coordinates. */
      axis?: [[number, number], [number, number]];
    };

/** An entity of an evaluated body, as the viewer names it: the face id and the
 *  edge's index on that face (the topology candidate numbering). */
export interface MeasureEntity { body_id: string; face_id?: number; edge_index?: number; vertex?: "a" | "b" }
export interface DistanceMeasurement { distance_mm: number; points: [Vec3, Vec3] }

export type WorkerResponse =
  | { type: "ready" }
  | {
      type: "imported";
      requestId: number;
      model: ImportedModelData;
    }
  | {
      type: "part-evaluated";
      requestId: number;
      model: ImportedModelData;
    }
  | {
      type: "distance-measured";
      requestId: number;
      measurement: DistanceMeasurement;
    }
  | { type: "part-analyzed"; requestId: number; result: AnalysisResult }
  | { type: "contacts-checked"; requestId: number; result: { overlaps: import("../kernel/contacts").ContactOverlap[]; checked_pairs: number } }
  | { type: "sketch-sectioned"; requestId: number; contours: import("../sketch/drawing").SketchContour[] }
  | { type: "part-exported"; requestId: number; result: ExportResult }
  | {
      type: "error";
      requestId?: number;
      message: string;
      /** The feature that failed, when one did; `unsupported` when the engine cannot build it yet. */
      featureId?: string;
      featureName?: string;
      unsupported?: boolean;
    };
