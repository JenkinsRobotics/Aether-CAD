import type { ImportedModelData } from '../domain';
import type { PartDocument } from '../aether-core';

export interface AssemblyGeometryDependencies {
  evaluate(document: PartDocument): Promise<ImportedModelData>;
  parseDocument(source: string): PartDocument;
}

export interface EvaluatedDefinition {
  document: PartDocument;
  model: ImportedModelData;
}

interface Entry {
  source: string;
  result: Promise<EvaluatedDefinition>;
  bytes: number;
}

/** Session-local display geometry. Exact operations still use the kernel.
 * Content, rather than the workspace revision or part ID alone, invalidates a
 * definition. Placement, selection and mate changes can reuse transferred data.
 * The bounded LRU never persists user content or caches a failed evaluation. */
export class AssemblyGeometryCache {
  private readonly entries = new Map<string, Entry>();
  private bytes = 0;

  constructor(private readonly deps: AssemblyGeometryDependencies,
    private readonly maxBytes = 128 * 1024 * 1024,
    private readonly maxEntries = 2048) {}

  get(definitionId: string, source: string): Promise<EvaluatedDefinition> {
    const previous = this.entries.get(definitionId);
    if (previous?.source === source) {
      this.entries.delete(definitionId);
      this.entries.set(definitionId, previous);
      return previous.result;
    }
    if (previous) this.remove(definitionId, previous);
    const entry: Entry = { source, bytes: source.length * 2,
      result: Promise.resolve().then(async () => {
        const document = this.deps.parseDocument(source);
        const model = await this.deps.evaluate(document);
        // An older request may finish after a newer source replaced it.
        if (this.entries.get(definitionId) === entry) {
          const geometryBytes = model.parts.reduce((sum, part) => sum +
            part.vertices.byteLength + part.normals.byteLength + part.triangles.byteLength + part.edgeLines.byteLength +
            JSON.stringify([part.topology, part.faceRanges]).length * 2, 0);
          entry.bytes += geometryBytes;
          this.bytes += geometryBytes;
          this.trim();
        }
        return { document, model };
      }).catch(error => {
        if (this.entries.get(definitionId) === entry) this.remove(definitionId, entry);
        throw error;
      }),
    };
    this.entries.set(definitionId, entry);
    this.bytes += entry.bytes;
    this.trim();
    return entry.result;
  }

  clear(): void { this.entries.clear(); this.bytes = 0; }

  private remove(id: string, entry: Entry): void {
    this.entries.delete(id);
    this.bytes -= entry.bytes;
  }

  private trim(): void {
    while (this.bytes > this.maxBytes || this.entries.size > this.maxEntries) {
      const oldest = this.entries.entries().next().value;
      if (!oldest) break;
      this.remove(...oldest);
    }
  }
}
