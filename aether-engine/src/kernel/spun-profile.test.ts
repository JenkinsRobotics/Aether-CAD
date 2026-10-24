import { beforeAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import init from "replicad-opencascadejs";
import { setOC, type Shape3D } from "replicad";
import { spunProfileContours } from "./sketch-section";
import { evaluatePartDocument } from "./part-evaluator";
import { createEmptyPartDocument } from "../document/part-document";

beforeAll(async () => {
  setOC(await (init as any)({ wasmBinary: readFileSync(require.resolve("replicad-opencascadejs/src/replicad_single.wasm")) }));
}, 60000);

it("spins a stepped shaft about its axis into its turned half-profile", () => {
  // Two coaxial cylinders along +Z: Ø20 × 10, then Ø10 × 15.
  const doc = createEmptyPartDocument("Shaft");
  doc.features.push({ id: "a", type: "profile", name: "a", plane: "XY", offsetMillimeters: 0, suppressed: false, profile: { type: "circle", radiusMillimeters: 10, centerMillimeters: [0, 0] } } as never);
  doc.features.push({ id: "ae", type: "extrude", name: "a", profileFeatureId: "a", distanceMillimeters: 10, operation: "new", suppressed: false } as never);
  doc.features.push({ id: "b", type: "profile", name: "b", plane: "XY", offsetMillimeters: 10, suppressed: false, profile: { type: "circle", radiusMillimeters: 5, centerMillimeters: [0, 0] } } as never);
  doc.features.push({ id: "be", type: "extrude", name: "b", profileFeatureId: "b", distanceMillimeters: 15, operation: "add", suppressed: false } as never);
  let shapes: Shape3D[] = [];
  evaluatePartDocument(doc, { withBodies: (b) => { shapes = [...b.values()] as Shape3D[]; } });
  // Sketch on XZ: sketch x = world X, sketch y = world Z (normal −Y). The axis is the sketch's y axis.
  const frame = { originMillimeters: [0, 0, 0] as [number, number, number], xDirection: [1, 0, 0] as [number, number, number], normal: [0, -1, 0] as [number, number, number] };
  const [profile] = spunProfileContours(shapes, [], frame, [[0, 0], [0, 1]], 0.05) as { type: "path"; start: number[]; segments: { type: string; end: number[] }[] }[];
  expect(profile.type).toBe("path");
  const corners = [profile.start, ...profile.segments.map((s) => s.end)].map(([u, v]) => [Math.round(Math.abs(u) * 10) / 10, Math.round(v * 10) / 10]);
  // Out to r 10 from z 0 to 10, step down to r 5 until z 25, back along the axis.
  for (const corner of [[10, 0], [10, 10], [5, 10], [5, 25], [0, 25], [0, 0]]) expect(corners.some(([u, v]) => Math.abs(u - corner[0]) <= 0.2 && Math.abs(v - corner[1]) <= 0.2)).toBe(true);
  expect(profile.segments.every((s) => s.type === "line")).toBe(true);
});
