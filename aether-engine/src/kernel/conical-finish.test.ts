import { beforeAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import init from "replicad-opencascadejs";
import { measureVolume, setOC } from "replicad";
import { parsePartDocument, type PartDocument, type PartFeature } from "../document/index";
import { evaluatePartDocument, resetEvaluationCache } from "./part-evaluator";

beforeAll(async () => {
  setOC(await (init as any)({ wasmBinary: readFileSync(new URL("../../node_modules/replicad-opencascadejs/src/replicad_single.wasm", import.meta.url)) }));
}, 30000);

const shoulder = (): PartDocument => parsePartDocument(JSON.stringify({
  format: "aether-part", formatVersion: 22, documentId: "conical-shoulder", name: "Tapered shoulder", units: "millimeter",
  features: [
    { id: "s", name: "Sketch", type: "profile", plane: "XZ", offsetMillimeters: 0, suppressed: false,
      profile: { type: "polygon", pointsMillimeters: [[0, 10], [0, 30], [8, 30], [10, 25], [30, 24], [30, 10]] } },
    { id: "r", name: "Revolve", type: "revolve", profileFeatureId: "s", axis: "X", angleDegrees: 90, operation: "new", bodyId: "body", suppressed: false },
  ],
}));

it("retains both tapered faces, the shared circular shoulder and exact cone-axis anchors in the compact kernel", () => {
  const body = evaluatePartDocument(shoulder()).parts[0];
  expect(body.topology.some(face => face.surfaceType === "UNAVAILABLE")).toBe(false);
  const cones = body.topology.filter(face => face.surfaceType === "CONE");
  expect(cones).toHaveLength(2);
  for (const face of cones) {
    expect(face.measurements!.areaSquareMillimeters).toBeGreaterThan(0);
    const edges = face.candidates.filter(candidate => candidate.kind === "edge-midpoint");
    expect(edges).toHaveLength(4);
    const rim = edges.find(edge => Math.abs(edge.origin[0] - 10) < 1e-7)!;
    expect(rim).toBeDefined();
    expect(rim.measurements!.lengthMillimeters).toBeCloseTo(25 * Math.PI / 2, 6);
    expect(Math.hypot(rim.origin[1], rim.origin[2])).toBeCloseTo(25, 6);
    const stations = face.candidates.filter(candidate => candidate.kind === "cone-axis");
    expect(stations).toHaveLength(3);
    const xs = stations.map(station => station.origin[0]).sort((a, b) => a - b);
    expect(xs.map(x => Math.round(x * 1e6) / 1e6)).toEqual(xs[0] < 9 ? [8, 9, 10] : [10, 20, 30]);
    for (const station of stations) {
      expect(Math.hypot(station.origin[1], station.origin[2])).toBeLessThan(1e-7);
      expect(Math.abs(station.zAxis[0])).toBeCloseTo(1, 7);
    }
  }
});

for (const kind of ["fillet", "chamfer"] as const) {
  it(`${kind} resolves the shoulder from either tapered face and survives saved rebuild`, () => {
    const doc = shoulder();
    const body = evaluatePartDocument(doc).parts[0];
    const cones = body.topology.filter(face => face.surfaceType === "CONE");
    expect(cones).toHaveLength(2);
    const volumes: number[] = [];
    for (const face of cones) {
      const edge = face.candidates.find(candidate => candidate.kind === "edge-midpoint" && Math.abs(candidate.origin[0] - 10) < 1e-7)!;
      const finish = { id: "finish", name: kind, type: kind, suppressed: false,
        radiusMillimeters: 0.5,
        edges: [{ kind: "curved-edge", sourceFeatureId: "r", bodyId: body.id, label: "Tapered shoulder",
          midpointMillimeters: [...edge.origin], lengthMillimeters: edge.measurements!.lengthMillimeters }],
      } as PartFeature;
      const edited = { ...doc, features: [...doc.features, finish] };
      let volume = 0;
      const result = evaluatePartDocument(edited, { withBodies: bodies => { volume = measureVolume([...bodies.values()][0]); } });
      expect(result.parts[0].topology.length).toBeGreaterThan(body.topology.length);
      expect(result.parts[0].topology.every(f => f.surfaceType !== "UNAVAILABLE")).toBe(true);
      volumes.push(volume);
      resetEvaluationCache();
      evaluatePartDocument(JSON.parse(JSON.stringify(edited)), { withBodies: bodies => expect(measureVolume([...bodies.values()][0])).toBeCloseTo(volume, 6) });
    }
    expect(volumes[0]).toBeCloseTo(volumes[1], 6);
  });
}
