/** Real worker + viewport fixture. No Studio files or server geometry involved. */
import { MateViewport } from '../../src/viewer';
import { OCCTWorkerClient } from '@aether/core/kernel';
import { createRectanglePartDocument, parsePartDocument } from '../../src/aether-core';
import { bodiesForPlacements } from '../../src/startup/assembly-solve';
import type { AssemblyProjectionV1 } from '../../src/cad-assembly-bridge';
import { cadViewportMetrics } from '../../src/cad-viewport-metrics-store';
import { AssemblyGeometryCache } from '../../src/assembly/geometry-cache';
import { cadSelection } from '../../src/cad-selection-store';

document.body.style.cssText = 'margin:0;height:100vh';
const viewport = new MateViewport(document.body, {
  onHover() {}, onStatus() {}, onStateChanged() {}, onMateApplied() {}, onCameraChanged() {},
});
const worker = new OCCTWorkerClient();
const startup = performance.now();
await worker.ready;
const workerStartupMs = performance.now() - startup;
// Exclude the existing finite background warm-up from both measurements.
await new Promise(resolve => setTimeout(resolve, 3000));
let evaluations = 0;
const deps = { parseDocument: parsePartDocument, evaluate: (doc: Parameters<typeof worker.evaluatePart>[0]) => {
  evaluations++; return worker.evaluatePart(doc);
} };
const geometryCache = new AssemblyGeometryCache(deps);
const snapshot = () => {
  const viewer = viewport as any;
  return { ...cadViewportMetrics.snapshot(), drawCalls: viewer.renderer.info.render.drawCalls,
    geometries: viewer.renderer.info.memory.geometries,
    uniqueVertexBuffers: new Set([...viewer.parts.values()].map((part: any) => part.data.vertices.buffer)).size };
};
const frame = async () => {
  const viewer = viewport as any;
  await viewer.output.renderAsync(viewer.camera);
  await new Promise(requestAnimationFrame);
};
const measure = async (projection: AssemblyProjectionV1, placements: any[]) => {
  const before = evaluations, start = performance.now();
  const bodies = await bodiesForPlacements(projection, placements, { ...deps, geometryCache });
  const prepared = performance.now();
  viewport.replaceAssemblyBodies(bodies);
  const uploaded = performance.now();
  viewport.frameAll();
  await frame();
  const presented = performance.now();
  for (let i = 0; i < 3; i++) await frame();
  return { evaluations: evaluations - before, prepareMs: prepared-start, sceneMs: uploaded-prepared,
    firstFrameMs: presented-uploaded, totalMs: presented-start, ...snapshot() };
};
(window as any).assemblyPerformance = {
  async run(count: number, definitions: number) {
    viewport.replaceAssemblyBodies([]);
    geometryCache.clear();
    const projection = {
      workspace_id: `benchmark-${count}-${definitions}`, assembly_id: 'main',
      part_definitions: Array.from({ length: definitions }, (_, i) => ({ id: `p${i}`, name: `Part ${i}`,
        feature_document: { ...createRectanglePartDocument(`Part ${i}`, {
          widthMillimeters: 20, heightMillimeters: 12, depthMillimeters: 5 + i % 7,
        }), documentId: `benchmark-${count}-${definitions}-${i}` } })),
      instances: Array.from({ length: count }, (_, i) => ({ id: `i${i}`, name: `Part ${i}`, definition_id: `p${i % definitions}`,
        definition_kind: 'part', visible: true, suppressed: false })),
    } as AssemblyProjectionV1;
    const placements = projection.instances.map((item, i) => ({ id: item.id,
      placement_mm: [(i%32)*28, Math.floor(i/32)*20, 0], rotation: [0,0,0,1] }));
    const cold = await measure(projection, placements);
    const originals = new Map([...(viewport as any).parts].map(([id,part]: any) => [id,part.surface.geometry]));
    const warm = await measure(projection, placements.map(item => ({ ...item, placement_mm: item.placement_mm.map(v => v+2) })));
    const retainedOnMove = [...(viewport as any).parts].filter(([id,part]: any) => originals.get(id) === part.surface.geometry).length;
    const changed = structuredClone(projection);
    const features = (changed.part_definitions[0].feature_document as any).features;
    features.find((f: any) => f.type === 'extrude').distanceMillimeters += 3;
    const edit = await measure(changed, placements);
    const retainedOnEdit = [...(viewport as any).parts].filter(([id,part]: any) => originals.get(id) === part.surface.geometry).length;
    const first = [...(viewport as any).parts.values()][0] as any;
    const faceId = first.faceRanges[0].faceId;
    cadSelection.dispatch({type:'replace',items:[{id:'test-face',kind:'face',partId:first.data.id,faceId,label:'Face'}]});
    viewport.refreshSelectionAppearance();
    await frame();
    const faceHighlight = first.surface.geometry.groups.some((group: any) => group.materialIndex === 2 && group.count === first.faceRanges[0].count);
    const independentHighlight = [...(viewport as any).parts.values()].slice(1).every((part: any) => part.surface.geometry.groups.every((group: any) => group.materialIndex === 0));
    cadSelection.dispatch({type:'clear'}); viewport.refreshSelectionAppearance();
    await frame();
    return { count, definitions, workerStartupMs, backend: viewport.backendLabel, cold, warm, edit,
      retainedOnMove, retainedOnEdit, faceHighlight, independentHighlight };
  },
};
