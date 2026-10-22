import { expect, it } from "vitest";
import { resolvePointPosition } from "./construction-points";

const edgeX = { kind: "axis" as const, partId: "p", candidateId: "e1", originMillimeters: [5, 0, 0] as [number, number, number], directionMillimeters: [1, 0, 0] as [number, number, number], lengthMillimeters: 10 };
const edgeY = { kind: "axis" as const, partId: "p", candidateId: "e2", originMillimeters: [0, 5, 2] as [number, number, number], directionMillimeters: [0, 1, 0] as [number, number, number], lengthMillimeters: 10 };
const base = { id: "pt", name: "Point", type: "point" as const, suppressed: false };

it("resolves every point construction", () => {
  expect(resolvePointPosition({ ...base, definition: { method: "vertex", point: { kind: "point", partId: "p", candidateId: "v", positionMillimeters: [1, 2, 3] } } })).toEqual([1, 2, 3]);
  expect(resolvePointPosition({ ...base, definition: { method: "two-edges", axes: [edgeX, edgeY] } })).toEqual([0, 0, 1]);
  expect(resolvePointPosition({ ...base, definition: { method: "three-planes", references: [{ kind: "principal", plane: "XY" }, { kind: "principal", plane: "XZ" }, { kind: "principal", plane: "YZ" }] } })).toEqual([0, 0, 0]);
  expect(resolvePointPosition({ ...base, definition: { method: "center", axis: { ...edgeX, originMillimeters: [4, 4, 4] } } })).toEqual([4, 4, 4]);
  expect(resolvePointPosition({ ...base, definition: { method: "edge-plane", axis: edgeX, reference: { kind: "principal", plane: "YZ" } } })).toEqual([0, 0, 0]);
  expect(resolvePointPosition({ ...base, definition: { method: "along-path", axis: edgeX, t: 1 } })).toEqual([10, 0, 0]);
  expect(() => resolvePointPosition({ ...base, definition: { method: "two-edges", axes: [edgeX, edgeX] } })).toThrow(/parallel/);
});
