/** The Aether engine in the headless runner: the same evaluator the editor runs
 *  in its worker, loaded from the wasm beside the bundle. One process per
 *  request (the host owns the deadline), so the kernel loads once per run. */
import { readFileSync } from 'node:fs';
import { initNodeKernel, runNodeOperation, solidMeasures } from '@aether/core/kernel/node';
import { evaluatePartDocument, FeatureFailure, UnsupportedFeature, analyzePart, exportPart, solveAssemblyJob, solvableMateKinds, projectPartDrawing, projectModelGeometry } from '@aether/core/kernel';
import { executeDrawingRequest } from './drawing-commands';
import { drawingFont } from './drawing-font';
import { parsePartDocument, serializePartDocument } from '@aether/core/document';
import { prepareModelProjection } from './model-projection';
import type { AnalysisOptions, ExportOptions } from '@aether/core/contracts';
import type { AssemblyJobInput } from '@aether/core/contracts';

let ready: Promise<void> | undefined;
const fullWasmPath = new URL('./opencascade.wasm', import.meta.url);
export function ensureEngine(): Promise<void> {
  if (!ready) ready = initNodeKernel(readFileSync(new URL('./replicad_single.wasm', import.meta.url)));
  return ready;
}

const diagnostic = (error: unknown) => {
  if (error instanceof FeatureFailure) return { feature_id: error.featureId, message: error.message.replace(new RegExp(`^${error.featureName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: `), ''), severity: 'error' as const };
  if (error instanceof UnsupportedFeature) return { feature_id: error.featureId, message: `The headless engine does not support ${error.message}.`, severity: 'error' as const };
  return { feature_id: 'part', message: error instanceof Error ? error.message : String(error), severity: 'error' as const };
};

/** The build answer the host's orchestration expects: outputs, frames, scopes and each body's exact measures and topology. */
export async function buildPhase(content: string, options: { rollback?: number } = {}) {
  await ensureEngine();
  const started = performance.now();
  const document = parsePartDocument(content);
  if (typeof options.rollback === 'number') document.rollbackIndex = options.rollback;
  const bodies: { id: string; geometry_kind: string; volume_mm3: number; face_count: number; edge_count: number; bbox_mm: number[][]; topology: unknown[] }[] = [];
  try {
    const model = await runNodeOperation(document, () => evaluatePartDocument(document, { withBodies: (shapes) => {
      for (const [id, shape] of shapes) bodies.push({ id, geometry_kind: 'solid', ...solidMeasures(shape), bbox_mm: shape.boundingBox.bounds.map((b) => [...b]), topology: [] });
    } }), fullWasmPath);
    for (const part of model.parts) { const body = bodies.find((b) => b.id === part.id); if (body) body.topology = part.topology ?? []; }
    return { status: 'ok', engine: 'Aether', message: '', build_seconds: (performance.now() - started) / 1000, body_outputs: model.bodyOutputs ?? {}, scope_resolutions: model.scopeResolutions ?? {}, sketch_frames: model.sketchFrames ?? {}, diagnostics: [], bodies };
  } catch (error) {
    return { status: 'error', engine: 'Aether', message: 'Some features did not build.', build_seconds: (performance.now() - started) / 1000, body_outputs: {}, scope_resolutions: {}, sketch_frames: {}, diagnostics: [diagnostic(error)], bodies: [] };
  }
}

export async function analyzePhase(content: string, options: AnalysisOptions) {
  await ensureEngine();
  try { const document = parsePartDocument(content); const result = await runNodeOperation(document, () => analyzePart(document, options), fullWasmPath); return { status: 'ok', engine: 'Aether', kind: result.kind, measurements: result.measurements, diagnostics: [] }; }
  catch (error) { return { status: 'error', engine: 'Aether', measurements: [], diagnostics: [diagnostic(error)] }; }
}

export async function exportPhase(content: string, options: ExportOptions) {
  await ensureEngine();
  try { const document = parsePartDocument(content); const result = await runNodeOperation(document, () => exportPart(document, options), fullWasmPath); return { status: 'ok', engine: 'Aether', format: options.format, data_base64: Buffer.from(result.bytes).toString('base64'), diagnostics: [] }; }
  catch (error) { return { status: 'error', engine: 'Aether', format: options.format, diagnostics: [diagnostic(error)] }; }
}

export function assemblyPhase(job: AssemblyJobInput) { return solveAssemblyJob(job); }

export async function modelProjectionPhase(content: string, arguments_: Record<string, unknown>) {
  await ensureEngine();
  const document = parsePartDocument(content);
  // Studio owns document/revision routing; only CAD fields enter the operation.
  const { app: _app, id: _id, expected_revision: _revision, ...args } = arguments_;
  const prepared = await runNodeOperation(document, () => prepareModelProjection(document, args, {
    evaluatePart: async candidate => evaluatePartDocument(candidate),
    projectModelGeometry: async (...input) => projectModelGeometry(...input),
  }), fullWasmPath);
  return { candidate: serializePartDocument(prepared.document), build: true, changed: true,
    result: { feature_id: prepared.featureID, projection: prepared.projection } };
}

export async function drawingPhase(request: Record<string, unknown>) {
  return executeDrawingRequest(request, async (document, options) => {
    await ensureEngine();
    return runNodeOperation(document, () => projectPartDrawing(document, options), fullWasmPath);
  }, drawingFont);
}

export const engineDescription = () => ({ ok: true, engine: 'Aether', kernel: 'OpenCASCADE (OpenCascade.js, in-process)', mate_kinds: [...solvableMateKinds] });
