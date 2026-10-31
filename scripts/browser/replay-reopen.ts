/** Production worker + real IndexedDB: build, reload, then edit. Driven by scripts/verify-replay-reopen.mjs. */
import { OCCTWorkerClient } from '@aether/core/kernel';
import type { PartDocument } from '@aether/core/document';

const worker = new OCCTWorkerClient();
const hex = async (bytes: BufferSource) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
/** Exact identity of what the viewer receives; normals by value (a restored face may sign a zero differently). */
const signature = async (model: Awaited<ReturnType<typeof worker.evaluatePart>>) => Promise.all(model.parts.map(async part => ({
  id: part.id, triangles: part.triangles.length / 3, faces: part.faceRanges.length, vertices: await hex(part.vertices), indices: await hex(part.triangles),
  normals: await hex(part.normals.map(n => n + 0)), edges: await hex(part.edgeLines), topology: await hex(new TextEncoder().encode(JSON.stringify([part.topology, part.faceRanges]))),
})));
const database = () => new Promise<IDBDatabase>((resolve, reject) => { const open = indexedDB.open('aether-cad-replay-cache', 1); open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error); });
const each = async (change: (value: any) => void) => { const db = await database(); await new Promise<void>((resolve, reject) => {
  const tx = db.transaction('snapshots', 'readwrite'); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  const cursor = tx.objectStore('snapshots').openCursor();
  cursor.onsuccess = () => { const row = cursor.result; if (!row) return; const value = row.value; change(value); row.update(value); row.continue(); };
}); db.close(); };
let blocker: IDBDatabase | undefined;

Object.assign(window, { replayCheck: {
  ready: worker.ready,
  async evaluate(document: PartDocument) {
    const started = performance.now();
    const model = await worker.evaluatePart(document);
    return { ms: performance.now() - started, replayed: model.replayedFeatures, signature: await signature(model) };
  },
  async saved() { try { const db = await database(); const n = await new Promise<number>(r => { const c = db.transaction('snapshots').objectStore('snapshots').count(); c.onsuccess = () => r(c.result); }); db.close(); return n; } catch { return -1; } },
  clear: () => new Promise(resolve => { const d = indexedDB.deleteDatabase('aether-cad-replay-cache'); d.onsuccess = d.onerror = d.onblocked = () => resolve(undefined); }),
  damage: () => each(value => { value.snapshot.shapes[0] = value.snapshot.shapes[0].slice(0, 64); }),
  obsolete: () => each(value => { value.version = 'obsolete'; }),
  /** Holds a newer schema open, so the worker's open fails: storage unavailable. */
  block: () => new Promise(resolve => { const open = indexedDB.open('aether-cad-replay-cache', 2); open.onsuccess = () => { blocker = open.result; resolve(undefined); }; }),
} });
