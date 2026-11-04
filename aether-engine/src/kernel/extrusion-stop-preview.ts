import type { PreviewHandle } from '../contracts/geometry';
import { add, scale, type V3 } from './vector';

/** Offsets move the stopping surface along the extrusion axis. Positive values
 * stop short; the arrow therefore points back toward the starting profile.
 * `contact` is on the evaluated (already offset) terminal surface. */
export function extrusionStopHandle(contact: V3, direction: V3, offset: number, opposite: boolean): PreviewHandle {
  return {
    parameter: opposite ? 'secondOffset' : 'endOffset',
    label: opposite ? 'Opposite end offset' : 'End offset',
    kind: 'linear', signed: true,
    originMillimeters: add(contact, scale(direction, offset)),
    direction: scale(direction, -1),
  };
}
