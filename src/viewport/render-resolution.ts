/** Bound both HiDPI and supersampling so quality cannot allocate unbounded targets. */
export function renderPixelRatio(scale = 1, deviceRatio = 1): number {
  // The real device ratio, never capped at 2: a 3× or 4× display rendered at 2× is upscaled and
  // every edge blurs (Jonathan, 2026-11-01). 4 bounds memory on absurd ratios only.
  const device = Number.isFinite(deviceRatio) ? Math.max(1, Math.min(4, deviceRatio)) : 1;
  const quality = Number.isFinite(scale) ? Math.max(.5, Math.min(1.5, scale)) : 1;
  return device * quality;
}
