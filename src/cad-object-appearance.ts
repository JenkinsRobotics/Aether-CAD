import type { MateViewport } from './viewer';
import type { PartDisplayOverride } from './viewport/part-display';

type Viewer = Pick<MateViewport, 'getPartRows' | 'getPartDisplay' | 'setPartDisplay'>;
export interface ObjectAppearanceRow { id: string; name: string; documentId?: string; value: PartDisplayOverride }

/** Observable projection of the renderer's existing session overrides. The
 * renderer remains the owner; neither React nor this adapter stores a copy of
 * document geometry or physical material assignments. */
export class ObjectAppearanceStore {
  private viewer?: Viewer;
  private rows: readonly ObjectAppearanceRow[] = [];
  private listeners = new Set<() => void>();
  snapshot = () => this.rows;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  attach(viewer: Viewer) {
    this.viewer = viewer; this.refresh();
    return () => { if (this.viewer === viewer) { this.viewer = undefined; this.rows = []; this.emit(); } };
  }
  refresh = () => {
    if (!this.viewer) return;
    const rows = this.viewer.getPartRows().map(row => ({ id: row.id, name: row.name, documentId: row.sourceDocumentId, value: this.viewer!.getPartDisplay(row.id) }));
    if (JSON.stringify(rows) === JSON.stringify(this.rows)) return;
    this.rows = rows; this.emit();
  };
  change(row: ObjectAppearanceRow, patch: PartDisplayOverride, reset = false) {
    const current = this.viewer?.getPartRows().find(part => part.id === row.id && part.sourceDocumentId === row.documentId);
    if (!current || !this.viewer) return;
    this.viewer.setPartDisplay(row.id, reset ? {} : { ...this.viewer.getPartDisplay(row.id), ...patch });
    this.refresh();
  }
  private emit() { this.listeners.forEach(fn => fn()); }
}
export const cadObjectAppearance = new ObjectAppearanceStore();
