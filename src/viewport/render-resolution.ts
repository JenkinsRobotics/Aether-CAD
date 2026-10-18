/** Bound both HiDPI and supersampling so quality cannot allocate unbounded targets. */
export function renderPixelRatio(scale = 1, deviceRatio = 1): number {
  const device = Number.isFinite(deviceRatio) ? Math.max(1, Math.min(2, deviceRatio)) : 1;
  const quality = Number.isFinite(scale) ? Math.max(.5, Math.min(1.5, scale)) : 1;
  return device * quality;
}
