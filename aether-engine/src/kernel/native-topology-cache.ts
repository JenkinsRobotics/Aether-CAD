import { getOC, type Face } from 'replicad';
import type { FaceTopologyData } from '../contracts/index';

/** Native identity, location and orientation decide whether topology is reusable.
 * Rounded centroid/area signatures are document IDs, not geometric cache keys:
 * distinct faces can have exactly the same centroid and area.
 */
export class NativeTopologyCache {
  private kernel: ReturnType<typeof getOC> | undefined;
  private readonly entries = new Map<number, { face: Face; data: FaceTopologyData }>();
  constructor(private readonly limit = 2048) {}

  private synchronizeKernel() {
    const kernel = getOC();
    if (kernel !== this.kernel) {
      this.clear();
      this.kernel = kernel;
    }
  }

  get(face: Face, id: number): FaceTopologyData | undefined {
    this.synchronizeKernel();
    const cached = this.entries.get(face.hashCode);
    if (!cached || !cached.face.wrapped.IsEqual(face.wrapped)) return;
    const data = cached.data;
    return { ...data, id, candidates: data.candidates.map(candidate => ({
      ...candidate, faceId: id,
      id: candidate.id.replace(`face-${data.id}-`, `face-${id}-`),
    })) };
  }

  set(face: Face, data: FaceTopologyData) {
    this.synchronizeKernel();
    const key = face.hashCode;
    // Collisions only evict an entry; native IsEqual still guards every hit.
    this.entries.get(key)?.face.delete();
    this.entries.delete(key);
    if (this.entries.size >= this.limit) {
      const oldest = this.entries.keys().next().value!;
      this.entries.get(oldest)!.face.delete();
      this.entries.delete(oldest);
    }
    this.entries.set(key, { face: face.clone(), data });
  }

  clear() {
    for (const entry of this.entries.values()) entry.face.delete();
    this.entries.clear();
  }
}
