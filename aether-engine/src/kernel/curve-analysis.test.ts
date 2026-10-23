import { beforeAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import init from "replicad-opencascadejs";
import { setOC } from "replicad";
import { analyzePart } from "./analysis";
import { createEmptyPartDocument, createRectanglePartDocument } from "../document/part-document";
import { evaluatePartDocument } from "./part-evaluator";

beforeAll(async () => {
  setOC(await (init as any)({ wasmBinary: readFileSync(require.resolve("replicad-opencascadejs/src/replicad_single.wasm")) }));
}, 60000);

const cylinder = () => {
  const doc = createEmptyPartDocument("Drum");
  doc.features.push({ id: "s", type: "profile", name: "Sketch", plane: "XY", offsetMillimeters: 0, suppressed: false, profile: { type: "circle", radiusMillimeters: 10, centerMillimeters: [0, 0] } } as never);
  doc.features.push({ id: "e", type: "extrude", name: "Extrude", profileFeatureId: "s", distanceMillimeters: 8, operation: "new", suppressed: false } as never);
  return doc;
};

it("measures the minimum radius and draws isocurves and a comb on a cylinder", () => {
  const doc = cylinder();
  const radius = analyzePart(doc, { kind: "minimum_radius" });
  const overall = radius.measurements.find((m) => "overall_min_radius_mm" in m) as { overall_min_radius_mm: number };
  expect(overall.overall_min_radius_mm).toBeCloseTo(10, 3);
  expect(radius.curves?.[0].polylines).toHaveLength(3);
  const flagged = analyzePart(doc, { kind: "minimum_radius", radius_mm: 12 });
  expect(flagged.measurements.some((m) => m.flagged === true)).toBe(true);

  const iso = analyzePart(doc, { kind: "isocurve", count: 4 });
  // Three faces (side, two caps), two families each.
  expect(iso.curves).toHaveLength(6);
  expect(iso.curves!.every((c) => c.polylines.length === 4 && c.polylines[0].length === 33)).toBe(true);

  const comb = analyzePart(doc, { kind: "curvature_comb", count: 16 });
  const rims = comb.measurements.filter((m) => typeof m.min_radius_mm === "number") as { min_radius_mm: number }[];
  expect(rims.length).toBeGreaterThanOrEqual(2);
  rims.forEach((m) => expect(m.min_radius_mm).toBeCloseTo(10, 3));
  // The seam is straight: curvature zero, no radius.
  expect(comb.measurements.some((m) => m.min_radius_mm === null)).toBe(true);
  // Teeth: 17 samples + the tip envelope.
  expect(comb.curves![0].polylines).toHaveLength(18);
}, 60000);

it("classifies continuity: G0 at a box corner, G1 where a fillet meets a plane", () => {
  const box = createRectanglePartDocument("Block", { widthMillimeters: 30, heightMillimeters: 20, depthMillimeters: 10 });
  const plain = analyzePart(box, { kind: "continuity" });
  expect(plain.measurements).toHaveLength(12);
  expect(plain.measurements.every((m) => m.continuity === "G0")).toBe(true);
  expect((plain.measurements[0] as { max_normal_angle_deg: number }).max_normal_angle_deg).toBeCloseTo(90, 1);

  const built = evaluatePartDocument(box).parts[0];
  const edge = built.topology.flatMap((f) => f.candidates).find((c) => c.kind === "edge-midpoint" && c.edgeAnchor && Math.abs(c.origin[2] - 10) < 1e-6)!;
  const filleted = { ...box, features: [...box.features, { id: "f", type: "fillet", name: "Round", suppressed: false, radiusMillimeters: 2, targetBodyId: built.id, edges: [{ kind: "solid-edge", sourceFeatureId: box.features[1].id, bodyId: built.id, label: "Edge", anchor: structuredClone(edge.edgeAnchor!) }] } as never] };
  const result = analyzePart(filleted, { kind: "continuity" });
  const kinds = result.measurements.map((m) => m.continuity);
  expect(kinds.filter((k) => k === "G1")).toHaveLength(2);
  expect(kinds.filter((k) => k === "G0").length).toBeGreaterThan(8);
  expect(result.curves!.find((c) => c.label.startsWith("G1"))?.color).toBe("#f2b134");
}, 60000);
