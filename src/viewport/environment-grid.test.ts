import { expect, it } from 'vitest';
import { niceGridStep, stageGridFade, stageGridFraming } from './environment-grid';

it('steps through the 1-2-5 series', () => {
  expect([0.7, 1, 3, 7.5, 19, 20, 49, 120].map(niceGridStep)).toEqual([0.5, 1, 2, 5, 10, 20, 20, 100]);
});

it('reproduces the Model Studio demo stage at its scale and scales it with any part', () => {
  // Demo: ~5 m robot, 1 m cells over 40 m, fog 14–32 m at ~10 m camera distance.
  expect(stageGridFraming(5000, 10_000)).toMatchObject({ spacing: 1000, near: 14_000, far: 32_000 });
  const small = stageGridFraming(60, 160);
  expect(small.spacing).toBe(10);
  expect(small.far).toBeGreaterThanOrEqual(160 * 3);
});

it('keeps the fade continuous with the camera and always inside the grid edge', () => {
  const { spacing, extent } = stageGridFraming(60, 160);
  for (const distance of [40, 160, 400, 1200, 50_000]) {
    const fade = stageGridFade(spacing, extent, 60, distance);
    expect(fade.near).toBeLessThan(fade.far);
    expect(fade.far).toBeLessThanOrEqual(extent / 2);
  }
  expect(stageGridFade(spacing, extent, 60, 400).far).toBeGreaterThan(stageGridFade(spacing, extent, 60, 160).far);
});
