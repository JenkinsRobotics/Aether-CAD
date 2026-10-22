/** A structurally valid relationship whose source geometry is unavailable.
 * It is repairable document state, never permission to ignore invalid geometry,
 * malformed metadata, numerical failures or conflicting target constraints. */
export class PierceReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PierceReferenceError';
  }
}
