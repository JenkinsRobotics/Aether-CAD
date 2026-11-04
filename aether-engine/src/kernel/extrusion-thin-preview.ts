import type { PreviewHandle } from '../contracts/geometry';
import type { ExtrudeFeature } from '../document/index';
import { add, neg, scale, type V3 } from './vector';

/** Thickness is measured across the sketch curve at the evaluated start plane.
 * Mid-plane displays total thickness while each end moves half that amount. */
export function extrusionThicknessHandles(frame: { origin: V3; inward: V3 }, thin: NonNullable<ExtrudeFeature['thin']>, direction: V3, offset: number, draftDegrees = 0): PreviewHandle[] {
  const base = add(frame.origin, scale(direction, offset));
  const origin = (side: V3) => add(base, scale(side, -offset * Math.tan(draftDegrees * Math.PI / 180)));
  if (thin.midplane) return [{
    parameter: 'midThickness', label: 'Wall thickness', kind: 'linear',
    originMillimeters: origin(neg(frame.inward)), direction: neg(frame.inward), scale: 2,
  }];
  const outward = thin.flipped ? frame.inward : neg(frame.inward);
  return [
    { parameter: 'thickness1', label: 'Wall thickness 1', kind: 'linear', nonnegative: true, originMillimeters: origin(outward), direction: outward },
    { parameter: 'thickness2', label: 'Wall thickness 2', kind: 'linear', nonnegative: true, originMillimeters: origin(neg(outward)), direction: neg(outward) },
  ];
}
