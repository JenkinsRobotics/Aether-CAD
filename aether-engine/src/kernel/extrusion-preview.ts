import type { ExtrusionPreviewAxis } from '../contracts/geometry';

type V3 = [number, number, number];
type End = { endType: string };

/** Use the same resolved direction and start as the native prism. Stop-bound
 * extents have no depth handle: changing an unused depth would mislead users. */
export function extrusionPreviewAxes(options: {
  center: V3;
  direction: V3;
  offset: number;
  endType: string;
  primary: End;
  second?: End;
  reversed: boolean;
}): ExtrusionPreviewAxis[] {
  const { center, direction, offset, primary, second, reversed } = options;
  const origin = center.map((v, i) => v + direction[i] * offset) as V3;
  const symmetric = options.endType === 'symmetric';
  const axes: ExtrusionPreviewAxis[] = [];
  if (primary.endType === 'blind') axes.push({
    side: 'primary', parameter: 'distance', originMillimeters: origin,
    direction, scale: symmetric ? 0.5 : 1, reversed,
  });
  if (second?.endType === 'blind') axes.push({
    side: 'opposite', parameter: symmetric ? 'distance' : 'second', originMillimeters: origin,
    direction: direction.map(v => -v) as V3, scale: symmetric ? 0.5 : 1, reversed,
  });
  return axes;
}
