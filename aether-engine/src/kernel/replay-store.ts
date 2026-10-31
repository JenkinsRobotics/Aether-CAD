/** The worker's replay snapshots in IndexedDB: one per document, about 256 MiB and 64
 *  documents at most, least recently used out first. Disposable: the version is the
 *  fingerprinted worker build, the snapshot carries its complete source, and a missing,
 *  stale, damaged or denied entry only means the next build replays every feature. */
import type { EvaluationSnapshot } from "./part-evaluator";

interface Saved { key: string; version: string; snapshot: EvaluationSnapshot }
const DB = "aether-cad-replay-cache";
const MAX_BYTES = 256 * 1024 * 1024;
const MAX_ENTRIES = 64;
const request = <T>(value: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  value.onsuccess = () => resolve(value.result); value.onerror = () => reject(value.error);
});

export class ReplayStore {
  private database?: Promise<IDBDatabase>;
  constructor(private readonly version: string) {}

  private open(): Promise<IDBDatabase> {
    return this.database ??= new Promise((resolve, reject) => {
      const pending = indexedDB.open(DB, 1);
      pending.onupgradeneeded = () => {
        pending.result.createObjectStore("snapshots", { keyPath: "key" });
        pending.result.createObjectStore("lru", { keyPath: "key" });
      };
      pending.onsuccess = () => { pending.result.onversionchange = () => pending.result.close(); resolve(pending.result); };
      pending.onerror = () => reject(pending.error);
      pending.onblocked = () => reject(Error("Replay cache is unavailable."));
    });
  }

  async read(documentId: string): Promise<EvaluationSnapshot | undefined> {
    const db = await this.open();
    const saved = await request<Saved | undefined>(db.transaction("snapshots").objectStore("snapshots").get(documentId));
    if (saved?.version !== this.version || typeof saved.snapshot?.source !== "string") return undefined;
    const store = db.transaction("lru", "readwrite").objectStore("lru"), metadata = store.get(documentId);
    metadata.onsuccess = () => { if (metadata.result) store.put({ ...metadata.result, used: Date.now() }); };
    return saved.snapshot;
  }

  async write(documentId: string, snapshot: EvaluationSnapshot): Promise<void> {
    const bytes = snapshot.source.length * 2 + snapshot.shapes.reduce((sum, shape) => sum + shape.byteLength, 0)
      + snapshot.steps.reduce((sum, step) => sum + step.meshes.reduce((n, [, m]) => n + m.vertices.byteLength + m.normals.byteLength + m.triangles.byteLength, 0), 0);
    if (bytes > MAX_BYTES) return;
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["snapshots", "lru"], "readwrite");
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
      const snapshots = tx.objectStore("snapshots"), lru = tx.objectStore("lru"), existing = lru.getAll();
      existing.onsuccess = () => {
        const entries = (existing.result as { key: string; bytes: number; used: number }[])
          .filter((entry) => entry.key !== documentId).sort((a, b) => a.used - b.used);
        let total = entries.reduce((sum, entry) => sum + entry.bytes, bytes);
        while (entries.length >= MAX_ENTRIES || total > MAX_BYTES) {
          const oldest = entries.shift(); if (!oldest) break;
          snapshots.delete(oldest.key); lru.delete(oldest.key); total -= oldest.bytes;
        }
        snapshots.put({ key: documentId, version: this.version, snapshot } satisfies Saved);
        lru.put({ key: documentId, bytes, used: Date.now() });
      };
    });
  }
}
