import { expect, it } from 'vitest';
import { pointDistance, threePointAngle } from './measurement-geometry';
it('measures world distance and the full three-point angle at the second pick', () => {
  expect(pointDistance([10, -20, 3], [13, -16, 15])).toBe(13);
  expect(threePointAngle([1,0,0], [0,0,0], [-1,1,0])).toBeCloseTo(Math.PI * .75);
  expect(threePointAngle([1,0,0], [0,0,0], [-1,0,0])).toBe(Math.PI);
  expect(threePointAngle([1,0,0], [0,0,0], [2,0,0])).toBe(0);
  expect(threePointAngle([0,0,0], [0,0,0], [1,0,0])).toBeNull();
});
