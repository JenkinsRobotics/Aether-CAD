import type { ImportedModelData } from '../domain';
import type { PartDocument } from '../part-document';

interface RecordValue { key: string; version: string; source: string; model: ImportedModelData }
export interface DisplayStorage {
  read(key: string): Promise<RecordValue | undefined>;
  write(value: RecordValue): Promise<void>;
}

/** Disposable display results, never the document or an exact kernel shape.
 * The complete source and built engine revision must match. Edits, analysis,
 * export and feature previews continue through the same native feature engine. */
export class CachedDisplayEvaluator {
  constructor(private readonly version: string, private readonly storage: DisplayStorage,
    private readonly evaluate: (document: PartDocument) => Promise<ImportedModelData>) {}

  async evaluatePart(document: PartDocument): Promise<ImportedModelData> {
    const source = JSON.stringify(document);
    const captured = JSON.parse(source) as PartDocument;
    let key: string | undefined;
    try {
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(this.version + '\n' + source));
      key = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
      const saved = await this.storage.read(key);
      if (saved?.version === this.version && saved.source === source && usableModel(saved.model)) return saved.model;
    } catch { /* Unavailable/corrupt browser storage must not prevent modeling. */ }
    const model = await this.evaluate(captured);
    if (key) {
      try { await this.storage.write({key, version: this.version, source, model}); }
      catch { /* Quota/private mode: the exact build is still the result. */ }
    }
    return model;
  }
}

function usableModel(model: ImportedModelData): boolean {
  return !!model && Array.isArray(model.parts) && !model.featurePreview && model.parts.every(part =>
    typeof part.id === 'string' && part.vertices instanceof Float32Array && part.normals instanceof Float32Array &&
    part.triangles instanceof Uint32Array && part.edgeLines instanceof Float32Array &&
    part.vertices.length % 3 === 0 && part.normals.length === part.vertices.length &&
    part.triangles.length % 3 === 0 && part.edgeLines.length % 6 === 0 &&
    part.vertices.every(Number.isFinite) && part.normals.every(Number.isFinite) && part.edgeLines.every(Number.isFinite) &&
    part.triangles.every(index => index < part.vertices.length / 3) &&
    Array.isArray(part.topology) && Array.isArray(part.faceRanges));
}

const DB = 'aether-cad-display-cache';
const MAX_BYTES = 128 * 1024 * 1024;
const MAX_ENTRIES = 512;
const request = <T>(value: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  value.onsuccess = () => resolve(value.result); value.onerror = () => reject(value.error);
});

/** Small LRU metadata lives separately so eviction never reads every mesh. */
export class BrowserDisplayStorage implements DisplayStorage {
  private database?: Promise<IDBDatabase>;
  private open(): Promise<IDBDatabase> {
    return this.database ??= new Promise((resolve, reject) => {
      const pending = indexedDB.open(DB, 1);
      pending.onupgradeneeded = () => {
        pending.result.createObjectStore('geometry', {keyPath: 'key'});
        pending.result.createObjectStore('lru', {keyPath: 'key'});
      };
      pending.onsuccess = () => { pending.result.onversionchange = () => pending.result.close(); resolve(pending.result); };
      pending.onerror = () => reject(pending.error);
      pending.onblocked = () => reject(Error('Display cache is unavailable.'));
    });
  }
  async read(key: string): Promise<RecordValue | undefined> {
    const db = await this.open();
    const value = await request<RecordValue | undefined>(db.transaction('geometry').objectStore('geometry').get(key));
    if (value) {
      const tx = db.transaction('lru', 'readwrite'), store = tx.objectStore('lru');
      const metadata = store.get(key);
      metadata.onsuccess = () => { if (metadata.result) store.put({...metadata.result, used: Date.now()}); };
    }
    return value;
  }
  async write(value: RecordValue): Promise<void> {
    const bytes = value.source.length * 2 + value.model.parts.reduce((sum, part) => sum +
      part.vertices.byteLength + part.normals.byteLength + part.triangles.byteLength + part.edgeLines.byteLength +
      JSON.stringify([part.topology, part.faceRanges]).length * 2, 0);
    if (bytes > MAX_BYTES) return;
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['geometry', 'lru'], 'readwrite');
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
      const geometry = tx.objectStore('geometry'), lru = tx.objectStore('lru');
      const existing = lru.getAll();
      existing.onsuccess = () => {
        const entries = (existing.result as {key: string; bytes: number; used: number}[])
          .filter(entry => entry.key !== value.key).sort((a, b) => a.used - b.used);
        let total = entries.reduce((sum, entry) => sum + entry.bytes, bytes);
        while (entries.length >= MAX_ENTRIES || total > MAX_BYTES) {
          const oldest = entries.shift(); if (!oldest) break;
          geometry.delete(oldest.key); lru.delete(oldest.key); total -= oldest.bytes;
        }
        geometry.put(value); lru.put({key: value.key, bytes, used: Date.now()});
      };
    });
  }
}
