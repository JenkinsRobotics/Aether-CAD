import type { DrawingAnnotation, DrawingPoint } from './document';

/** A chain is authored in one transaction and stored as individually editable
 * dimensions. No derived labels or measured values are persisted. */
export interface DimensionChain {
  id: string;
  viewId: string;
  pointsMm: DrawingPoint[];
  positionMm: DrawingPoint;
  decimals: number;
  axis?: 'x' | 'y';
}
export function dimensionChainAnnotations(chain: DimensionChain): DrawingAnnotation[] {
  if (!chain || !Array.isArray(chain.pointsMm) || chain.pointsMm.length < 3 || chain.pointsMm.length > 64) {
    throw Error('A dimension chain needs 3–64 ordered points.');
  }
  const point = (p: DrawingPoint) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
  if (!chain.pointsMm.every(point) || !point(chain.positionMm)) throw Error('Chain coordinates must be finite X, Y pairs.');
  if (typeof chain.id !== 'string' || !chain.id.trim() || chain.id.length > 950) throw Error('A dimension chain requires an ID of 1–950 characters.');
  if (chain.axis !== undefined && chain.axis !== 'x' && chain.axis !== 'y') throw Error('Chain axis must be x or y.');
  const [first, second] = chain.pointsMm;
  const offset: DrawingPoint = [chain.positionMm[0] - (first[0] + second[0]) / 2, chain.positionMm[1] - (first[1] + second[1]) / 2];
  return chain.pointsMm.slice(1).map((b, index) => {
    const a = chain.pointsMm[index];
    const midpoint: DrawingPoint = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const positionMm: DrawingPoint = chain.axis === 'x' ? [midpoint[0], chain.positionMm[1]]
      : chain.axis === 'y' ? [chain.positionMm[0], midpoint[1]]
      : [midpoint[0] + offset[0], midpoint[1] + offset[1]];
    return { id: `${chain.id}/${index + 1}`, kind: 'point-distance', viewId: chain.viewId,
      pointsMm: [a, b], positionMm, decimals: chain.decimals, ...(chain.axis ? { axis: chain.axis } : {}) };
  });
}
