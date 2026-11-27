/** Row-normalized local Jacobian rank. Copies input so callers can reuse rows. */
export function diagnosticRank(input: number[][]): number {
  const rows = input
    .filter((row) => Math.hypot(...row) > 1e-8)
    .map((row) => {
      const n = Math.hypot(...row);
      return row.map((x) => x / n);
    });
  const width = rows[0]?.length ?? 0;
  let rank = 0;
  for (let col = 0; col < width && rank < rows.length; col++) {
    let pivot = rank;
    for (let i = rank + 1; i < rows.length; i++)
      if (Math.abs(rows[i][col]) > Math.abs(rows[pivot][col])) pivot = i;
    if (Math.abs(rows[pivot][col]) < 1e-7) continue;
    [rows[rank], rows[pivot]] = [rows[pivot], rows[rank]];
    const scale = rows[rank][col];
    for (let k = col; k < width; k++) rows[rank][k] /= scale;
    for (let i = rank + 1; i < rows.length; i++) {
      const f = rows[i][col];
      for (let k = col; k < width; k++) rows[i][k] -= f * rows[rank][k];
    }
    rank++;
  }
  return rank;
}

export interface RedundancyClassification {
  rank: number;
  redundantIds: string[];
  determinedBy: Record<string, string[]>;
}

/** Incremental modified Gram-Schmidt row classification with provenance: identifies
 *  each linearly dependent constraint and the earlier basis constraints that determine it. */
export function classifyConstraintRows(
  rows: { id: string; values: number[] }[],
): RedundancyClassification {
  const basis: { id: string; vec: number[]; deps: Set<string> }[] = [];
  const redundantSet = new Set<string>();
  const determinedBy: Record<string, string[]> = {};
  for (const row of rows) {
    const rawNorm = Math.hypot(...row.values);
    if (rawNorm <= 1e-8) continue;
    const v = row.values.map((x) => x / rawNorm);
    const contributors = new Set<string>();
    // Two passes of modified Gram-Schmidt for numerical stability.
    for (let pass = 0; pass < 2; pass++) {
      for (const b of basis) {
        let dot = 0;
        for (let k = 0; k < v.length; k++) dot += v[k] * b.vec[k];
        if (Math.abs(dot) > 1e-7) {
          contributors.add(b.id);
          for (const d of b.deps) contributors.add(d);
          for (let k = 0; k < v.length; k++) v[k] -= dot * b.vec[k];
        }
      }
    }
    const remNorm = Math.hypot(...v);
    if (remNorm < 1e-6) {
      redundantSet.add(row.id);
      const prev = new Set(determinedBy[row.id] ?? []);
      for (const id of contributors) if (id !== row.id) prev.add(id);
      determinedBy[row.id] = [...prev];
    } else {
      for (let k = 0; k < v.length; k++) v[k] /= remNorm;
      basis.push({ id: row.id, vec: v, deps: contributors });
    }
  }
  return { rank: basis.length, redundantIds: [...redundantSet], determinedBy };
}
