import { beforeAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { makeBox, measureVolume, type Shape3D } from "replicad";
import { initNodeKernel } from "../node-kernel";
import { createRectanglePartDocument } from "../../document/part-document";
import { principalFrame } from "../../document/construction-planes";
import { projectBodyGeometry, projectModelGeometry } from "./index";
import { facesOf } from "../exact-topology";
import { sketchSectionContours } from "../sketch-section";
import { validateModelProjection } from "../../sketch/model-projection";

beforeAll(async () => { await initNodeKernel(readFileSync(new URL("../../../node_modules/replicad-opencascadejs/src/replicad_single.wasm", import.meta.url))); }, 30000);
const frame = principalFrame("XY", 27);
it("projects out-of-plane model edges while preserving the separate coplanar auto-project operation", () => {
  const doc = createRectanglePartDocument("Box", { widthMillimeters: 30, heightMillimeters: 20, depthMillimeters: 10 });
  expect(sketchSectionContours(doc, frame, "edges")).toEqual([]);
  const projected = projectModelGeometry(doc, frame);
  expect(projected.approximatedEdges).toEqual([]);
  const lines = projected.contours.filter(c => c.type === "path" && c.segments.length);
  expect(lines).toHaveLength(4); // Eight coincident top/bottom edges become four.
  const points = lines.flatMap(c => c.type === "path" ? [c.start, ...c.segments.map(s => s.end)] : []);
  expect(Math.max(...points.map(p => p[0])) - Math.min(...points.map(p => p[0]))).toBeCloseTo(30, 7);
  expect(Math.max(...points.map(p => p[1])) - Math.min(...points.map(p => p[1]))).toBeCloseTo(20, 7);
});
it("scopes face, edge and vertex selections; refuses stale selections atomically without consuming the body", () => {
  const body = makeBox([0, 0, 0], [30, 20, 10]);
  const bodies = new Map<string, Shape3D>([["body", body]]), faces = facesOf(body);
  try {
    const face = faces[0], edges = face.face.edges;
    try {
      const selected = { body_id: "body", face_id: face.id, edge_index: 0 };
      const result = projectBodyGeometry(bodies, frame, { entities: [selected, selected] });
      expect(result.contours).toHaveLength(1);
      expect(projectBodyGeometry(bodies, frame, { entities: [{ ...selected, vertex: "a" }] }).contours).toMatchObject([{ type: "path", segments: [] }]);
      expect(projectBodyGeometry(bodies, frame, { entities: [{ body_id: "body", face_id: face.id }] }).contours.length).toBeGreaterThan(0);
      for (const bad of [{ body_id: "missing" }, { ...selected, face_id: 0 }, { ...selected, edge_index: 999 }]) {
        expect(() => projectBodyGeometry(bodies, frame, { entities: [selected, bad] })).toThrow(/no longer exists/);
        expect(measureVolume(body)).toBeCloseTo(6000, 6);
      }
      expect(projectBodyGeometry(bodies, frame, { entities: [selected] })).toEqual(result);
    } finally { edges.forEach(edge => edge.delete()); }
  } finally { faces.forEach(item => item.face.delete()); body.delete(); }
});
it("rejects malformed frames, selections and tolerances before evaluating any geometry", () => {
  for (const options of [{ entities: [] }, { entities: [{ body_id: "b", edge_index: 0 }] }, { entities: [{ body_id: "b", face_id: 0.5 }] }, { entities: [{ body_id: "b", vertex: "a" }] }, { toleranceMillimeters: 0 }, { toleranceMillimeters: Infinity }, { toleranceMillimeters: "0.1" }, { unknown: true }])
    expect(() => validateModelProjection(frame, options as never)).toThrow();
  expect(() => validateModelProjection({ ...frame, xDirection: [2, 0, 0] }, {})).toThrow(/orthonormal/);
  expect(() => projectBodyGeometry(new Map(), frame)).toThrow(/no exact edges/);
  expect(validateModelProjection(frame, { entities: [{ body_id: "b", face_id: -12, edge_index: 0 }] })).toBe(0.01);
  expect(() => validateModelProjection(frame, { toleranceMillimeters: null } as never)).toThrow(/tolerance/);
});
