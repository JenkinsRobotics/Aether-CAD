import { expect, it } from "vitest";
import { curvesAsFeatures, thinPolyline } from "./derived-curves-window";

it("turns model curves into 3D sketch features: straight runs as lines, others as thinned splines", () => {
  const circle = Array.from({ length: 501 }, (_, i) => [Math.cos(i / 500 * 2 * Math.PI) * 5, Math.sin(i / 500 * 2 * Math.PI) * 5, 10] as [number, number, number]);
  const line: [number, number, number][] = [[0, 0, 0], [5, 0, 0], [10, 0, 0]];
  const features = curvesAsFeatures([circle, line], "Intersection curve", (i) => `c${i}`) as unknown as { id: string; name: string; kind: string; pointsMillimeters: number[][] }[];
  expect(features.map((f) => [f.id, f.name, f.kind])).toEqual([["c0", "Intersection curve 1", "spline"], ["c1", "Intersection curve 2", "line"]]);
  expect(features[0].pointsMillimeters).toHaveLength(200);
  expect(features[0].pointsMillimeters[0]).toEqual(circle[0]);
  expect(features[1].pointsMillimeters).toEqual([[0, 0, 0], [10, 0, 0]]);
  expect(thinPolyline(line)).toBe(line);
});
