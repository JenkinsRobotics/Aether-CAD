import { expect, it } from "vitest";
import { measureReference } from "./measure-reference";

it("names faces, edges, circular edges and vertices the way the engine resolves them", () => {
  expect(measureReference({ id: "face:pad:-12", kind: "face", partId: "pad", label: "Face", faceId: -12 })).toEqual({ body_id: "pad", face_id: -12 });
  expect(measureReference({ id: "edge:pad:face--12-edge-3", kind: "edge", partId: "pad", label: "Edge" })).toEqual({ body_id: "pad", face_id: -12, edge_index: 3 });
  expect(measureReference({ id: "edge:pad:face-7-circle-0", kind: "edge", partId: "pad", label: "Edge" })).toEqual({ body_id: "pad", face_id: 7, edge_index: 0 });
  expect(measureReference({ id: "vertex:pad:face-7-vertex-2-b", kind: "vertex", partId: "pad", label: "Vertex" })).toEqual({ body_id: "pad", face_id: 7, edge_index: 2, vertex: "b" });
  expect(measureReference({ id: "body:pad", kind: "body", partId: "pad", label: "Body" })).toEqual({ body_id: "pad" });
  // A component (assembly instance) has no single exact shape here.
  expect(measureReference({ id: "component:i", kind: "component", partId: "i", label: "Instance" })).toBeNull();
});


it('never treats an inferred circular center as the whole circular edge', () => {
  expect(measureReference({ id: 'anchor:body:part:face-7-circle-0', kind: 'vertex', partId: 'body:part', label: 'Circle center' })).toBeNull();
});
