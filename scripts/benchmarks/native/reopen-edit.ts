// Reopen, then edit: the first build after a new worker, with and without a restored replay
// snapshot. The snapshot passes through structuredClone, as IndexedDB stores it.
import { readFileSync, writeFileSync } from 'node:fs';
import { initNodeKernel, solidMeasures } from '../../../aether-engine/src/kernel/node-kernel';
import { evaluatePartDocument, resetEvaluationCache, restoreEvaluation, snapshotEvaluation } from '../../../aether-engine/src/kernel/part-evaluator';
import type { PartDocument } from '../../../aether-engine/src/document';
import type { EvaluationTiming } from '../../../aether-engine/src/kernel/evaluation-timing';

const input = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const document: PartDocument = input.document ?? input;
const edited = structuredClone(document);
Object.assign(edited.features.find(f => f.id === input.edit.featureId)!, { [input.edit.field]: input.edit.value });
await initNodeKernel(readFileSync('aether-engine/node_modules/replicad-opencascadejs/src/replicad_single.wasm'));

function build(doc: PartDocument) {
  const events: EvaluationTiming[] = [];
  let measures: unknown[] = [];
  const start = performance.now();
  const result = evaluatePartDocument(structuredClone(doc), { observe: e => events.push(e), withBodies: b => { measures = [...b.values()].map(solidMeasures); } });
  const feature = events.filter(e => e.phase === 'feature'), display = events.filter(e => e.phase === 'display');
  return { totalMs: performance.now() - start, replayed: result.replayedFeatures, featureMs: feature.reduce((n, e) => n + e.milliseconds, 0),
    displayMs: display.reduce((n, e) => n + e.milliseconds, 0), measures };
}
const time = <T>(run: () => T): [T, number] => { const start = performance.now(); const value = run(); return [value, performance.now() - start]; };

const runs = [];
for (let round = 0; round < Number(process.env.BENCH_RUNS ?? 1); round++) {
  resetEvaluationCache();
  const cold = build(document);
  const [snapshot, snapshotMs] = time(() => snapshotEvaluation(document)!);
  const [stored, cloneMs] = time(() => structuredClone(snapshot));
  resetEvaluationCache();
  const coldEdit = build(edited);                     // today: a reopened worker replays everything
  resetEvaluationCache();
  const [restored, restoreMs] = time(() => restoreEvaluation(edited, stored));
  const restoredEdit = build(edited);
  if (JSON.stringify(restoredEdit.measures) !== JSON.stringify(coldEdit.measures)) throw new Error('Restored edit differs from a cold edit');
  runs.push({ round, cold, snapshotMs, cloneMs, snapshotBytes: snapshot.shapes.reduce((n, s) => n + s.byteLength, 0) + snapshot.source.length * 2,
    shapes: snapshot.shapes.length, coldEdit, restoredSteps: restored, restoreMs, restoredEdit, restoredEditWithRestoreMs: restoreMs + restoredEdit.totalMs });
}
const output = { engine: 'Aether OCCT WASM / Node', node: process.version, document: document.name, features: document.features.length, edit: input.edit, runs };
writeFileSync(process.argv[3], JSON.stringify(output, null, 2));
console.log(JSON.stringify(runs.map(({ cold, coldEdit, restoredEdit, ...r }) => ({ ...r, coldMs: cold.totalMs, coldEditMs: coldEdit.totalMs, restoredEditMs: restoredEdit.totalMs, restoredReplayed: restoredEdit.replayed, restoredFeatureMs: restoredEdit.featureMs, restoredDisplayMs: restoredEdit.displayMs }))));
resetEvaluationCache();
