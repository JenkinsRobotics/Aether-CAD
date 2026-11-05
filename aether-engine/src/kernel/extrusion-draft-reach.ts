import type { Shape3D } from 'replicad';

/** Find a valid construction tool, never a substitute user depth. A narrowing
 * profile may collapse past its actual stopping surface but before the far
 * bounding-box face. The caller must cut this tool and verify that none of its
 * far cap remains in the result. Thus the final stop stays exact, independently
 * of this search's construction distance. Returned shapes belong to the caller.
 */
export function extrusionDraftReach(start: number, far: number, build: (far: number) => Shape3D): { tool: Shape3D; far: number } {
  try { return { tool: build(far), far }; }
  catch (failure) {
    let invalid = far, valid = start;
    let best: Shape3D | undefined;
    for (let iteration = 0; iteration < 28; iteration++) {
      const middle = (valid + invalid) / 2;
      if (middle - start < 1e-7) break;
      try {
        const candidate = build(middle);
        best?.delete(); best = candidate; valid = middle;
      } catch { invalid = middle; }
      if (best && invalid - valid <= Math.max(1e-6, (far - start) * 1e-8)) break;
    }
    if (!best) throw failure;
    return { tool: best, far: valid };
  }
}
