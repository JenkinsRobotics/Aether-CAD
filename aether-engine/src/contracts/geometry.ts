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
  bodyOutputs?: Record<string, string[]>;
  scopeResolutions?: Record<string, import("../document/extrusion-scope").ExtrusionScopeResolution>;
  sketchFrames?: Record<string, import("../sketch/drawing").SketchFrame>;
  sourceName: string;
  parts: PartGeometryData[];
  parseMilliseconds: number;
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

export type WorkerRequest =
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
    };

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
      type: "error";
      requestId?: number;
      message: string;
    };
