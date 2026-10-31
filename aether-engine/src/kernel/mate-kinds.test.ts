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

it("sweep mates keep a point on a path in the first connector's frame and hold a position along it", () => {
  expect(solvableMateKinds).toContain("sweep");
  const a = frame([10, 0, 0], [0, 1, 0], [-1, 0, 0]); // a's x is world y
  const path = { path_mm: [[0, 0, 0], [10, 0, 0], [10, 10, 0]] }; // world: (10,0,0) → (10,10,0) → (0,10,0)
  expect(jointResiduals("sweep", a, frame([10, 4, 0]), path).every((r) => Math.abs(r) < 1e-9)).toBe(true);
  expect(jointResiduals("sweep", a, frame([5, 10, 0]), path).every((r) => Math.abs(r) < 1e-9)).toBe(true);
  const off = jointResiduals("sweep", a, frame([13, 4, 2]), path);
  expect(off[0]).toBeCloseTo(3, 9); expect(off[2]).toBeCloseTo(2, 9);
  // Position 15 mm along a 20 mm path is 5 mm into the second leg: world (5, 10, 0).
  const held = jointResiduals("sweep", a, frame([0, 0, 0]), { ...path, dofs: [{ name: "position", kind: "translation", axis: "x", value: 15 }] });
  expect(held[0]).toBeCloseTo(-5, 9); expect(held[1]).toBeCloseTo(-10, 9); expect(held[2]).toBeCloseTo(0, 9);
  expect(() => jointResiduals("sweep", a, frame([0, 0, 0]), {})).toThrow(/path_mm/);
});
