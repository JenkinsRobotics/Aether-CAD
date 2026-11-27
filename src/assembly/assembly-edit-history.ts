/** Session-local archive history. The anchor is an immutable model identity,
 * not a reusable saved revision number or a presentation/BOM snapshot. */
export const ASSEMBLY_HISTORY_MAX_STEPS = 64;
export const ASSEMBLY_HISTORY_MAX_BYTES = 64 * 1024 * 1024;

export class AssemblyEditHistory<T extends object> {
  private entries: { before: string; after: string }[] = [];
  private cursor = 0;
  private anchor: T | null = null;

  constructor(private readonly maxSteps = ASSEMBLY_HISTORY_MAX_STEPS,
    private readonly maxBytes = ASSEMBLY_HISTORY_MAX_BYTES) {}

  clear(): void { this.entries = []; this.cursor = 0; this.anchor = null; }

  canMove(direction: -1 | 1, source: T | null): boolean {
    return source !== null && source === this.anchor
      && (direction === -1 ? this.cursor > 0 : this.cursor < this.entries.length);
  }

  target(direction: -1 | 1, source: T): string {
    if (!this.canMove(direction, source)) throw Error("No matching Assembly edit history is available.");
    return direction === -1 ? this.entries[this.cursor - 1].before : this.entries[this.cursor].after;
  }

  record(before: string, after: string, source: T, next: T): void {
    if (source !== this.anchor) this.clear();
    this.entries = this.entries.slice(0, this.cursor);
    this.entries.push({ before, after });
    // Count UTF-16 storage conservatively. Large archives evict oldest edits;
    // they never make the history grow without a bound.
    let bytes = this.entries.reduce((sum, entry) => sum + 2 * (entry.before.length + entry.after.length), 0);
    while (this.entries.length > this.maxSteps || bytes > this.maxBytes) {
      const removed = this.entries.shift()!;
      bytes -= 2 * (removed.before.length + removed.after.length);
    }
    this.cursor = this.entries.length;
    this.anchor = next;
  }

  moved(direction: -1 | 1, source: T, next: T): void {
    if (!this.canMove(direction, source)) throw Error("The Assembly history changed while restoring.");
    this.cursor += direction;
    this.anchor = next;
  }
}
