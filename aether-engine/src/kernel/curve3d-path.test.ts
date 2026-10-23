import { beforeAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import init from "replicad-opencascadejs";
import { measureVolume, setOC, type Shape3D } from "replicad";
import { evaluatePartDocument } from "./part-evaluator";
import { createEmptyPartDocument } from "../document/part-document";

beforeAll(async () => {
  setOC(await (init as any)({ wasmBinary: readFileSync(require.resolve("replicad-opencascadejs/src/replicad_single.wasm")) }));
}, 60000);

const volume = (d: ReturnType<typeof createEmptyPartDocument>) => { let v = 0; evaluatePartDocument(d, { withBodies: (b) => { for (const body of b.values()) v += measureVolume(body as Shape3D); } }); return v; };

it("pipes along a 3D polyline and a 3D spline", () => {
  const doc = createEmptyPartDocument("Space pipe");
  doc.features.push({ id: "c", type: "curve3d", name: "Path", suppressed: false, kind: "line", pointsMillimeters: [[0, 0, 0], [0, 0, 40]] } as never);
  doc.features.push({ id: "pipe", type: "pipe", name: "Pipe", suppressed: false, pathFeatureId: "c", diameterMillimeters: 10, operation: "new" } as never);
  expect(volume(doc)).toBeCloseTo(Math.PI * 25 * 40, 0);

  const spline = createEmptyPartDocument("Spline pipe");
  spline.features.push({ id: "c", type: "curve3d", name: "Path", suppressed: false, kind: "spline", pointsMillimeters: [[0, 0, 0], [20, 0, 10], [40, 10, 20], [60, 30, 20]] } as never);
  spline.features.push({ id: "pipe", type: "pipe", name: "Pipe", suppressed: false, pathFeatureId: "c", diameterMillimeters: 4, operation: "new" } as never);
  // Polyline length through the points is a lower bound on the smooth curve's length.
  const chord = Math.hypot(20, 0, 10) + Math.hypot(20, 10, 10) + Math.hypot(20, 20, 0);
  const v = volume(spline);
  expect(v).toBeGreaterThan(Math.PI * 4 * chord * 0.95);
  expect(v).toBeLessThan(Math.PI * 4 * chord * 1.25);
  expect(evaluatePartDocument(spline).parts).toHaveLength(1);
}, 60000);
