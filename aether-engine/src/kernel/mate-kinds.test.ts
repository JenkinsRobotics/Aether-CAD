import { expect, it } from "vitest";
import { jointResiduals, solvableMateKinds } from "./assembly-solver";

const frame = (o: [number, number, number], x: [number, number, number] = [1, 0, 0], y: [number, number, number] = [0, 1, 0], z: [number, number, number] = [0, 0, 1]) => ({ o, x, y, z });

it("planar and pin-slot mates leave their free motions unpenalised and catch the rest", () => {
  expect(solvableMateKinds).toContain("planar"); expect(solvableMateKinds).toContain("pin_slot");
  const a = frame([0, 0, 0]);
  // Planar: sliding in the plane and turning about its normal are free; lifting off is not.
  expect(jointResiduals("planar", a, frame([5, 7, 0], [0, 1, 0], [-1, 0, 0]))).toEqual([0, 0, 0]);
  expect(jointResiduals("planar", a, frame([5, 7, 3]))[0]).toBeCloseTo(3, 9);
  expect(jointResiduals("planar", a, frame([0, 0, 0], [1, 0, 0], [0, 0, 1], [0, -1, 0])).some((r) => Math.abs(r) > 1e-6)).toBe(true);
  // Pin slot: sliding along x and turning about z are free; moving along y or z is not.
  expect(jointResiduals("pin_slot", a, frame([9, 0, 0], [0, 1, 0], [-1, 0, 0]))).toEqual([0, 0, 0, 0]);
  const off = jointResiduals("pin_slot", a, frame([9, 2, 1]));
  expect(off[0]).toBeCloseTo(2, 9); expect(off[1]).toBeCloseTo(1, 9);
});
