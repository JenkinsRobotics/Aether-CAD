/** Device interaction preferences; they do not alter saved model constraints. */
export interface CADSnappingState { enabled: boolean; geometry: boolean; grid: boolean }
const defaults: CADSnappingState = {enabled:true, geometry:true, grid:true};
const key = 'aether-cad.snapping';
export class CADSnappingStore {
  private state: Readonly<CADSnappingState>;
  private listeners = new Set<() => void>();
  constructor(private storage?: Pick<Storage, 'getItem' | 'setItem'>) {
    let saved: Partial<CADSnappingState> = {};
    try { saved = JSON.parse(storage?.getItem(key) ?? '{}') ?? {}; } catch { /* Defaults when storage is unavailable. */ }
    this.state = Object.freeze(Object.fromEntries(Object.entries(defaults).map(([name,value]) => [name, typeof saved[name as keyof CADSnappingState] === 'boolean' ? saved[name as keyof CADSnappingState] : value])) as unknown as CADSnappingState);
  }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  set(patch: Partial<CADSnappingState>) {
    this.state = Object.freeze({...this.state,...patch});
    try { this.storage?.setItem(key, JSON.stringify(this.state)); } catch { /* Session-only fallback. */ }
    this.listeners.forEach(listener => listener());
  }
}
const storage = (() => { try { return globalThis.localStorage; } catch { return undefined; } })();
export const cadSnapping = new CADSnappingStore(storage);
