/** The browser's client for Aether CAD's default geometry engine.
 *
 *  FreeCAD (LGPL-2.1-or-later) does the parametric work, headless on the host,
 *  behind the JSON boundary in `Aether CAD/freecad-engine`. This file only
 *  speaks that boundary and converts the answer into `PartGeometryData` — the
 *  payload the viewer already renders — so no renderer code knows or cares
 *  which engine produced it.
 *
 *  See Aether CAD/freecad-engine/README.md and ATTRIBUTION.md.
 */
import type { PartGeometryData } from "./aether-core";
import {readExtrusionPreviewAxes} from './modeling/extrusion-preview-axes';
import {readTransformPreviewFrame} from './modeling/transform-preview-frame';

export interface FreeCADFeature {
  id: string;
  kind:
    | "import-step"
    | "import-cad"
    | "sketch-rectangle"
    | "sketch-polygon"
    | "sketch-circle"
    | "sketch-point"
    | "sketch-wire"
    | "sketch-region"
    | "pad"
    | "pocket"
    | "revolve"
    | "mirror"
    | "fillet"
    | "chamfer"
    | "sweep"
    | "transform"
    | "offset-face"
    | "face-extrude"
    | "shell"
    | "boolean"
  | "pattern"
    | "draft"
    | "loft"
    | "hole";
  parameters: Record<string, unknown>;
}

export interface FreeCADDiagnostic {
  feature_id: string;
  severity: "error" | "warning";
  message: string;
}

interface WireBody {
  geometry_kind?: "solid" | "mesh";
  id?: string;
  volume_mm3: number;
  face_count: number;
  edge_count: number;
  vertices: number[];
  normals: number[];
  triangles: number[];
  edge_lines: number[];
  face_ranges: { start: number; count: number; faceId: number }[];
  topology: { surfaceReference?: PartGeometryData["topology"][number]["surfaceReference"]; measurements?: PartGeometryData["topology"][number]["measurements"]; id: number; surfaceType: string; candidates: PartGeometryData["topology"][number]["candidates"] }[];
  face_names: string[];
}

export interface FreeCADBuild {
  featurePreview?: import("./domain").ImportedModelData["featurePreview"];
  bodyOutputs?: Record<string, string[]>;
  scopeResolutions?: Record<string,import("@aether/core/document").ExtrusionScopeResolution>;
  sketchFrames?: Record<string, import("@aether/core/sketch").SketchFrame>;
  status: "ok" | "error";
  engine: string;
  message: string;
  buildSeconds: number;
  diagnostics: FreeCADDiagnostic[];
  parts: PartGeometryData[];
  volumeMillimetersCubed: number;
}

/** Reported by the engine and shown in the status tray, so the operator can
 *  always see which engine produced the geometry in front of them. */
export async function describeGeometryEngine(): Promise<
  { ok: true; engine: string; licence: string; capabilities?: string[] } | { ok: false; error: string }
> {
  const response = await fetch("/api/cad/engine", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) return { ok: false, error: `Host returned ${response.status}.` };
  return response.json();
}

/** Older installations must never silently rebuild a tapered feature as a
 * straight prism. Check the live worker for every advanced request so a
 * reconnect or server generation change cannot reuse a stale capability. */
export async function requireFeatureCapabilities(features: readonly FreeCADFeature[]) {
  const extrusions = features.filter(feature => feature.kind === 'pad' || feature.kind === 'pocket');
  const required = new Set<string>();
  if (features.some(f => f.kind === 'sketch-region')) required.add('sketch-connected-region');
  if (features.some(f => f.kind === 'sketch-wire' && (f.parameters.segments as {type?:string}[] | undefined)?.some(s => s.type === 'conic'))) required.add('sketch-conic');
  if(features.some(f=>f.parameters.pierce_checks!==undefined))required.add('sketch-pierce');
  if (features.some(f => Array.isArray(f.parameters.blocked_geometry) && f.parameters.blocked_geometry.length)) required.add('sketch-fixed-geometry');
  if (features.some(f => f.kind === 'sketch-wire' && (f.parameters.segments as {type?:string}[] | undefined)?.some(s => s.type === 'ellipse'))) required.add('sketch-ellipse');
  if(features.some(feature=>feature.kind==='transform'))required.add('part-transform');
  if(features.some(feature=>feature.kind==='transform'&&String((feature.parameters.transform as {kind?:string})?.kind).endsWith('-reference')))required.add('referenced-part-transform');
  if(features.some(feature=>feature.kind==='offset-face'))required.add('offset-face');
  if(features.some(feature=>feature.kind==='offset-face'&&feature.parameters.transform!==undefined))required.add('move-face');
  for (const {parameters:p} of extrusions) {
    if (p.thin !== undefined) required.add('extrude-thin');
    if (p.direction_vector !== undefined) required.add('extrude-direction-vector');
    if (p.direction_reference !== undefined) required.add('extrude-sketch-line-direction');
    if (p.end_type === 'symmetric-through-all') required.add('extrude-symmetric-through-all');
    const second = p.second_end as {draft_angle_deg?:number;end_type?:string;end_reference?:{surfaceType?:string}}|undefined;
    if ([p,second].some(end=>end?.end_type==='up-to-face'&&(end.end_reference as {surfaceType?:string}|undefined)?.surfaceType)) required.add('extrude-curved-face');
    if (p.scope_mode)required.add('extrude-automatic-scope');
    if (p.starting_reference) required.add('extrude-reference-start');
    if ([p,second].some(end=>end?.end_type==='up-to-vertex')) required.add('extrude-up-to-vertex');
    if ([p,second].some(end=>end?.end_type==='up-to-next'&&end?.draft_angle_deg)) required.add('extrude-drafted-general-next');
    if ([p,second].some(end=>end?.end_type==='up-to-next'&&!end?.draft_angle_deg)) required.add('extrude-general-next');
    if ([p,second].some(end=>end?.end_type==='up-to-part')) required.add('extrude-up-to-part');
    if (p.draft_angle_deg || second?.draft_angle_deg) required.add('extrude-draft');
    if ([p,second].some(end => end?.draft_angle_deg && ['up-to-face','up-to-next','through-all','symmetric-through-all'].includes(String(end.end_type)))) required.add('extrude-drafted-limits');
    if (p.second_end || (p.draft_angle_deg && (p.end_type === 'symmetric' || p.second_distance_mm))) required.add('extrude-independent-ends');
  }
  if (!required.size) return;
  const engine = await describeGeometryEngine();
  if (!engine.ok) throw new Error(engine.error);
  if(required.has('sketch-pierce')&&!engine.capabilities?.includes('sketch-pierce'))throw Error('This geometry worker does not support associative Pierce constraints. Update the CAD worker before rebuilding.');
  if (required.has('sketch-conic') && !engine.capabilities?.includes('sketch-conic')) throw Error('This geometry worker does not support exact sketch conics. Update the CAD worker before rebuilding.');
  if (required.has('sketch-fixed-geometry') && !engine.capabilities?.includes('sketch-fixed-geometry')) throw Error('This geometry worker does not support whole-entity sketch Fix. Update the CAD worker before rebuilding.');
  if (required.has('sketch-ellipse') && !engine.capabilities?.includes('sketch-ellipse')) throw Error('This geometry worker does not support exact sketch ellipses. Update the CAD worker before rebuilding.');
  if (required.has('sketch-connected-region') && !engine.capabilities?.includes('sketch-connected-region')) throw Error('This geometry worker does not support connected sketch regions. Update the CAD worker before rebuilding.');
  if(features.some(f=>f.kind==='transform'&&(f.parameters.transform as {reference?:{kind?:string}})?.reference?.kind==='solid-edge')&&!engine.capabilities?.includes('solid-edge-transform'))throw Error('This geometry worker does not support solid-edge transform references. Update the CAD worker to rebuild this feature.');
  if(required.has('referenced-part-transform')&&!engine.capabilities?.includes('referenced-part-transform'))throw Error('This geometry worker does not support geometry-referenced transforms. Update the CAD worker to rebuild this feature.');
  if(required.has('part-transform')&&!engine.capabilities?.includes('part-transform'))throw Error('This geometry worker does not support solid part transforms. Update the CAD worker to rebuild this feature.');
  if(required.has('move-face')&&!engine.capabilities?.includes('move-face'))throw Error('This geometry worker does not support face translation and rotation. Update the CAD worker to rebuild this feature.');
  if(required.has('offset-face')&&!engine.capabilities?.includes('offset-face'))throw Error('This geometry worker does not support direct face offsets. Update the CAD worker to rebuild this feature.');
  if (required.has('extrude-automatic-scope')&&!engine.capabilities?.includes('extrude-automatic-scope'))throw Error('This geometry worker does not support automatic extrusion scope. Update the CAD worker to rebuild this feature.');
  if (required.has('extrude-reference-start') && !engine.capabilities?.includes('extrude-reference-start')) throw new Error('This geometry worker does not support referenced extrusion starts. Update the CAD worker to rebuild this feature.');
  if (required.has('extrude-up-to-vertex') && !engine.capabilities?.includes('extrude-up-to-vertex')) throw new Error('This geometry worker does not support Up to vertex. Update the CAD worker to rebuild this feature.');
  if (required.has('extrude-general-next') && !engine.capabilities?.includes('extrude-general-next')) throw new Error('This geometry worker does not support general Up to next boundaries. Update the CAD worker to rebuild this feature.');
  if (required.has('extrude-up-to-part') && !engine.capabilities?.includes('extrude-up-to-part')) throw new Error('This geometry worker does not support Up to part. Update the CAD worker to rebuild this feature.');
  if (required.has('extrude-thin') && !engine.capabilities?.includes('extrude-thin')) throw new Error('This geometry worker does not support thin extrusion. Update the CAD worker to rebuild this feature.');
  if (required.has('extrude-sketch-line-direction') && !engine.capabilities?.includes('extrude-sketch-line-direction')) throw new Error('This geometry worker does not support sketch-line extrusion directions. Update the CAD worker or choose another direction.');
  if (required.has('extrude-direction-vector') && !engine.capabilities?.includes('extrude-direction-vector')) throw new Error('This geometry worker does not support custom extrusion directions. Update the CAD worker or use Normal to sketch.');
  if (required.has('extrude-symmetric-through-all') && !engine.capabilities?.includes('extrude-symmetric-through-all')) throw new Error('This geometry worker does not support symmetric Through all. Update the CAD worker to rebuild this feature.');
  if (required.has('extrude-draft') && !engine.capabilities?.includes('extrude-draft')) throw new Error('This geometry worker does not support extrusion draft. Update the CAD worker or disable Draft.');
  if (required.has('extrude-drafted-limits') && !engine.capabilities?.includes('extrude-drafted-limits')) throw new Error('This geometry worker does not support drafted extrusion limits. Update the CAD worker or use a Blind end.');
  if (required.has('extrude-drafted-general-next') && !engine.capabilities?.includes('extrude-drafted-general-next')) throw new Error('This geometry worker does not support drafted general Up to next boundaries. Update the CAD worker to rebuild this feature.');
  if (required.has('extrude-curved-face')&&!engine.capabilities?.includes('extrude-curved-face')) throw new Error('This geometry worker does not support curved Up to face limits. Update the CAD worker to rebuild this feature.');
  if (required.has('extrude-independent-ends') && !engine.capabilities?.includes('extrude-independent-ends')) throw new Error('This geometry worker does not support independent extrusion ends. Update the CAD worker to rebuild this feature.');
}

export async function buildWithFreeCAD(
  features: readonly FreeCADFeature[],
  options: { rollback?: number | null; toleranceMillimeters?: number; previewFeatureId?: string } = {},
): Promise<FreeCADBuild> {
  await requireFeatureCapabilities(features);
  const response = await fetch("/api/cad/geometry", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      features,
      rollback: options.rollback ?? null,
      preview_feature_id: options.previewFeatureId,
      tolerance_mm: options.toleranceMillimeters ?? 0.1,
    }),
  });
  if (!response.ok) {
    let message = `The geometry engine returned ${response.status}.`;
    try {
      const failure = await response.json();
      if (failure?.error) message = String(failure.error);
    } catch {
      // A non-JSON failure keeps the status-code message.
    }
    throw new Error(message);
  }
  const payload = await response.json();
  const bodies: WireBody[] = payload.bodies ?? [];
  return {
    featurePreview: payload.preview ? {base: payload.preview.base.map(toPartGeometry), added: payload.preview.added.map(toPartGeometry), removed: payload.preview.removed.map(toPartGeometry), featureId:payload.preview.feature_id, extrusionAxes:readExtrusionPreviewAxes(payload.preview.extrusion_axes), transformFrame:readTransformPreviewFrame(payload.preview.transform_frame)} : undefined,
    status: payload.status === "ok" ? "ok" : "error",
    engine: String(payload.engine ?? "FreeCAD"),
    message: String(payload.message ?? ""),
    buildSeconds: Number(payload.build_seconds ?? 0),
    bodyOutputs: payload.body_outputs ?? {},
    scopeResolutions: payload.scope_resolutions ?? {},
    sketchFrames: payload.sketch_frames ?? {},
    diagnostics: (payload.diagnostics ?? []) as FreeCADDiagnostic[],
    parts: bodies.map((body, index) => toPartGeometry(body, index)),
    volumeMillimetersCubed: bodies.reduce((total, body) => total + body.volume_mm3, 0),
  };
}

/** JSON number arrays become the typed arrays the renderer wants.
 *
 *  The engine already tessellates per face, so `faceRanges` arrives intact and
 *  face picking works on FreeCAD geometry the same way it does on the browser
 *  engine's. `candidates` is empty for now: connector inference is the browser
 *  engine's `extractExactTopology`, not yet ported to this path.
 */
export function toPartGeometry(body: WireBody, index: number): PartGeometryData {
  return {
    ...(body.geometry_kind === "mesh" ? {geometryKind:"mesh" as const} : {}),
    id: body.id ?? `freecad:body-${index + 1}`,
    name: index === 0 ? "Body" : `Body ${index + 1}`,
    sourceDocumentId: "freecad",
    sourceName: "FreeCAD",
    vertices: new Float32Array(body.vertices),
    normals: new Float32Array(body.normals),
    triangles: new Uint32Array(body.triangles),
    edgeLines: new Float32Array(body.edge_lines),
    faceRanges: body.face_ranges.map((range) => ({
      // The native wire counts triangles; Three.js material groups and the
      // viewport's picking contract count entries in the index buffer.
      start: range.start * 3,
      count: range.count * 3,
      faceId: range.faceId,
    })),
    topology: body.topology.map((face) => ({
      id: face.id,
      surfaceType: face.surfaceType,
      ...(face.surfaceReference?{surfaceReference:face.surfaceReference}:{}),
      ...(face.measurements ? {measurements: face.measurements} : {}),
      candidates: face.candidates,
    })),
  };
}
