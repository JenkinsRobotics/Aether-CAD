import { beforeAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import init from "replicad-opencascadejs";
import { setOC } from "replicad";
import { cachedSteps, evaluatePartDocument, FeatureFailure, resetEvaluationCache, UnsupportedFeature } from "./part-evaluator";
import { measureDistance } from "./measure";
import { createRectanglePartDocument, type PartDocument } from "../document/index";

beforeAll(async () => {
  setOC(await (init as any)({ wasmBinary: readFileSync(new URL("../../node_modules/replicad-opencascadejs/src/replicad_single.wasm", import.meta.url)) }));
}, 30000);

const ids = { documentId: "doc", sketchId: "sk", extrudeId: "ex" };
const plate = () => createRectanglePartDocument("Plate", { widthMillimeters: 60, heightMillimeters: 40, depthMillimeters: 20 }, ids);
const hole = { id: "hole", type: "profile" as const, name: "Hole", plane: "XY" as const, offsetMillimeters: 20, suppressed: false, profile: { type: "circle" as const, radiusMillimeters: 5, centerMillimeters: [10, 0] as [number, number] } };
const cut: PartDocument["features"][number] = { id: "cut", type: "extrude", name: "Cut", profileFeatureId: "hole", distanceMillimeters: 20, operation: "cut", endType: "through-all", suppressed: false };
const withHole = (document = plate()): PartDocument => ({ ...document, features: [...document.features, hole, cut] });
const box = (id: string, x0: number, x1: number) => [
  { id: id + "s", name: "Sketch " + id, type: "profile" as const, plane: "XY" as const, offsetMillimeters: 0, suppressed: false, profile: { type: "polygon" as const, pointsMillimeters: [[x0, -20], [x1, -20], [x1, 20], [x0, 20]] as [number, number][] } },
  { id, name: "Extrude " + id, type: "extrude" as const, profileFeatureId: id + "s", distanceMillimeters: 30, endType: "blind" as const, operation: "new" as const, separateBodies: true, suppressed: false }];
const boxes = { format: "aether-part", formatVersion: 21, documentId: "doc", name: "Boxes", units: "millimeter", features: [...box("A", -60, -5), ...box("B", 5, 60)] } as unknown as PartDocument;

it("separate bodies are named as the document records them and a later cut reaches them", () => {
  const document = plate();
  const separate = { ...document, features: [document.features[0], { ...document.features[1], separateBodies: true } as never] };
  const model = evaluatePartDocument(separate);
  expect(model.parts.map(part => part.id)).toEqual(["doc:body-1:solid-ebea8b55387acf9e52727864"]);
  expect(model.bodyOutputs).toEqual({ ex: ["doc:body-1:solid-ebea8b55387acf9e52727864"] });
  // The outputs come back from the cache too (the app opens a document twice: load, then thumbnail).
  expect(evaluatePartDocument(separate).bodyOutputs).toEqual({ ex: ["doc:body-1:solid-ebea8b55387acf9e52727864"] });
  expect(evaluatePartDocument({ ...separate, rollbackIndex: 2 }).bodyOutputs).toEqual({ ex: ["doc:body-1:solid-ebea8b55387acf9e52727864"] });
  const bored = evaluatePartDocument(withHole(separate));
  expect(bored.parts).toHaveLength(1);
  expect(bored.parts[0].topology.some(face => face.surfaceType === "CYLINDER")).toBe(true);
});

it("through-all cuts and symmetric extrusions follow the sketch frame; face ids survive the cut", () => {
  const before = evaluatePartDocument(plate());
  const after = evaluatePartDocument(withHole());
  expect(after.parts[0].triangles.length).toBeGreaterThan(before.parts[0].triangles.length);
  const sides = before.parts[0].topology.filter(f => f.candidates[0].zAxis[2] === 0).map(f => f.id);
  expect(sides).toHaveLength(4);
  expect(sides.every(id => after.parts[0].topology.some(f => f.id === id))).toBe(true);
  expect(evaluatePartDocument(plate()).parts[0].topology.map(f => f.id)).toEqual(before.parts[0].topology.map(f => f.id));
  const document = plate();
  const symmetric = evaluatePartDocument({ ...document, features: [document.features[0], { ...document.features[1], endType: "symmetric" } as never] });
  const zs = Array.from(symmetric.parts[0].vertices).filter((_, i) => i % 3 === 2);
  expect(Math.min(...zs)).toBeCloseTo(-10); expect(Math.max(...zs)).toBeCloseTo(10);
});

it("previews the last feature as its own material over the design before it", () => {
  const model = evaluatePartDocument(withHole(), { preview: true });
  expect(model.parts).toEqual([]); // the overlay is what the viewer draws; the result mesh is not built
  expect(model.featurePreview?.featureId).toBe("cut");
  expect(model.featurePreview?.base.map(p => p.id)).toEqual(["preview:base:doc:body-1"]);
  expect(model.featurePreview?.removed.map(p => p.id)).toEqual(["preview:removed:doc:body-1"]);
  expect(model.featurePreview?.added).toEqual([]);
  const first = evaluatePartDocument(plate(), { preview: true });
  expect(first.featurePreview?.base).toEqual([]);
  expect(first.featurePreview?.added.map(p => p.id)).toEqual(["preview:added:doc:body-1"]);
});

it("names the feature in failures, and says what it cannot build yet", () => {
  const document = plate();
  const open = { id: "open", type: "profile" as const, name: "Open", plane: "XY" as const, offsetMillimeters: 0, suppressed: false, profile: { type: "drawing" as const, contours: [{ type: "path" as const, start: [0, 0] as [number, number], segments: [{ type: "line" as const, end: [10, 0] as [number, number] }] }] } };
  try { evaluatePartDocument({ ...document, features: [open, { ...document.features[1], id: "ex2", name: "Extrude 2", profileFeatureId: "open" } as never] }); expect.unreachable(); }
  catch (error) { expect(error).toBeInstanceOf(FeatureFailure); expect((error as FeatureFailure).featureId).toBe("ex2"); expect((error as Error).message).toMatch(/^Extrude 2: /); }
  const body = `${document.documentId}:body-1`;
  // Still refused by the engine (and by FreeCAD's PartDesign): patterning an intersect feature.
  const intersect = { ...document.features[1], id: "ex2", name: "Extrude 2", operation: "intersect", targetBodyId: body } as never;
  const pattern = { id: "pat", type: "pattern", name: "Pattern", sourceFeatureId: "ex2", suppressed: false, patternType: "linear", axis: "X", count: 2, spacingMillimeters: 10, reversed: false, targetBodyId: body } as never;
  try { evaluatePartDocument({ ...document, features: [...document.features, intersect, pattern] }); expect.unreachable(); }
  catch (error) { expect(error).toBeInstanceOf(UnsupportedFeature); expect((error as UnsupportedFeature).featureId).toBe("pat"); }
});

it("measures face-to-face, edge, vertex and body distances by the viewer's ids", () => {
  const model = evaluatePartDocument(boxes);
  const [a, b] = model.parts;
  // The planar faces at x = -5 (A's right) and x = 5 (B's left), by their centres.
  const at = (part: typeof a, x: number) => part.topology.find(face => face.surfaceType === "PLANE" && Math.abs(face.candidates[0].origin[0] - x) < 1e-6)!;
  const right = at(a, -5), left = at(b, 5);
  const faces = measureDistance(boxes, [{ body_id: a.id, face_id: right.id }, { body_id: b.id, face_id: left.id }]);
  expect(faces.distance_mm).toBeCloseTo(10);
  expect(faces.points[0][0]).toBeCloseTo(-5); expect(faces.points[1][0]).toBeCloseTo(5);
  const edge = (face: typeof right) => Number(/edge-(\d+)/.exec(face.candidates.find(c => c.kind === "edge-midpoint")!.id)![1]);
  expect(measureDistance(boxes, [{ body_id: a.id, face_id: right.id, edge_index: edge(right) }, { body_id: b.id, face_id: left.id, edge_index: edge(left) }]).distance_mm).toBeGreaterThanOrEqual(10);
  expect(measureDistance(boxes, [{ body_id: a.id, face_id: right.id, edge_index: edge(right), vertex: "a" }, { body_id: b.id }]).distance_mm).toBeCloseTo(10);
  expect(() => measureDistance(boxes, [{ body_id: a.id, face_id: 12345 }, { body_id: b.id }])).toThrow(/solid bodies/);
});

it("replays only from the first changed feature and keeps the geometry identical", () => {
  resetEvaluationCache();
  const first = evaluatePartDocument(plate());
  expect(cachedSteps("doc")).toBe(2);
  const bored = evaluatePartDocument(withHole());
  expect(cachedSteps("doc")).toBe(4);
  // A preview and the Apply of the same document hit the cache whole; the result is the same geometry.
  const previewed = evaluatePartDocument(withHole(), { preview: true });
  expect(previewed.featurePreview?.removed).toHaveLength(1);
  expect(previewed.parts).toEqual([]);
  const applied = evaluatePartDocument(withHole());
  expect(Array.from(applied.parts[0].triangles)).toEqual(Array.from(bored.parts[0].triangles));
  expect(applied.parts[0].topology.map(f => f.id)).toEqual(bored.parts[0].topology.map(f => f.id));
  // Editing the hole keeps the plate's steps and rebuilds from the hole sketch on.
  const wider = withHole();
  const edited = evaluatePartDocument({ ...wider, features: [wider.features[0], wider.features[1], { ...hole, profile: { ...hole.profile, radiusMillimeters: 8 } }, cut] });
  expect(cachedSteps("doc")).toBe(4);
  expect(edited.parts[0].triangles.length).not.toBe(0);
  const bore = edited.parts[0].topology.find(f => f.surfaceType === "CYLINDER")!;
  expect(bore.candidates.find(c => c.kind === "circle-center")?.measurements).toBeUndefined();
  // Rolling back evaluates a prefix without discarding the cached future.
  expect(evaluatePartDocument({ ...withHole(), rollbackIndex: 2 }).parts[0].topology).toHaveLength(6);
  expect(cachedSteps("doc")).toBe(4);
  // Buffers are fresh per call, so transferring one never detaches the cache.
  expect(first.parts[0].vertices.buffer).not.toBe(evaluatePartDocument(plate()).parts[0].vertices.buffer);
  resetEvaluationCache();
  expect(cachedSteps("doc")).toBe(0);
});

it("faces and edges carry the measurements the selection and Measure tools read", () => {
  const model = evaluatePartDocument(withHole());
  const faces = model.parts[0].topology;
  const top = faces.find(f => f.measurements?.planarNormal?.[2] === 1)!, bottom = faces.find(f => f.measurements?.planarNormal?.[2] === -1)!;
  expect(top.measurements?.centerMillimeters?.[2]).toBeCloseTo(20); expect(bottom.measurements?.centerMillimeters?.[2]).toBeCloseTo(0);
  expect(top.candidates[0].zAxis[2]).toBe(1); expect(bottom.candidates[0].zAxis[2]).toBe(-1);
  expect(top.measurements?.areaSquareMillimeters).toBeCloseTo(2400 - Math.PI * 25, 3);
  const bore = faces.find(f => f.surfaceType === "CYLINDER")!;
  expect(bore.measurements?.radiusMillimeters).toBeCloseTo(5);
  // On the bore itself the circle centres coincide with the exact axis stations, which win; the top face keeps the circle.
  const circle = top.candidates.find(c => c.kind === "circle-center")!;
  expect(circle.measurements?.radiusMillimeters).toBeCloseTo(5); expect(circle.measurements?.lengthMillimeters).toBeGreaterThan(0);
  const straight = top.candidates.find(c => c.kind === "edge-midpoint" && c.measurements?.linearDirection)!;
  expect(straight.measurements?.lengthMillimeters).toBeGreaterThan(0);
  expect(Math.hypot(...straight.measurements!.linearDirection!)).toBeCloseTo(1);
});

it("intersects: the body keeps only the material inside the tool", () => {
  const document = plate();
  const post = { id: "post", type: "profile" as const, name: "Post", plane: "XY" as const, offsetMillimeters: 0, suppressed: false, profile: { type: "circle" as const, radiusMillimeters: 10, centerMillimeters: [0, 0] as [number, number] } };
  const keep: PartDocument["features"][number] = { id: "keep", type: "extrude", name: "Keep", profileFeatureId: "post", distanceMillimeters: 50, operation: "intersect", suppressed: false };
  const model = evaluatePartDocument({ ...document, features: [...document.features, post, keep] });
  expect(model.parts).toHaveLength(1);
  const xs = Array.from(model.parts[0].vertices).filter((_, i) => i % 3 === 0), zs = Array.from(model.parts[0].vertices).filter((_, i) => i % 3 === 2);
  expect(Math.max(...xs)).toBeCloseTo(10, 1); expect(Math.max(...zs)).toBeCloseTo(20, 3);
});

it("mesh face groups are named by the same stable ids as the topology, so picks resolve", () => {
  const part = evaluatePartDocument(withHole()).parts[0];
  expect(part.faceRanges).toHaveLength(part.topology.length);
  const ids = new Set(part.topology.map(f => f.id));
  expect(part.faceRanges.every(range => ids.has(range.faceId))).toBe(true);
  expect(new Set(part.faceRanges.map(range => range.faceId)).size).toBe(part.faceRanges.length);
  // The cylinder's triangles belong to the cylinder face.
  const bore = part.topology.find(f => f.surfaceType === "CYLINDER")!;
  const range = part.faceRanges.find(r => r.faceId === bore.id)!;
  expect(range.count).toBeGreaterThan(6 * 3);
});

it("sketches on a face resolve their frame from the body as it was after the source feature, like FreeCAD", () => {
  const document = plate();
  const onTop = { id: "boss-sketch", type: "profile" as const, name: "Boss sketch", plane: "XY" as const, offsetMillimeters: 0, suppressed: false,
    support: { sourceFeatureId: "ex", bodyId: "doc:body-1", normal: [0, 0, 1] as [number, number, number], xDirection: [1, 0, 0] as [number, number, number], label: "Face of Extrude 1" },
    profile: { type: "circle" as const, radiusMillimeters: 5, centerMillimeters: [10, 0] as [number, number] } };
  const boss: PartDocument["features"][number] = { id: "boss", type: "extrude", name: "Boss", profileFeatureId: "boss-sketch", distanceMillimeters: 5, operation: "add", suppressed: false };
  const model = evaluatePartDocument({ ...document, features: [...document.features, onTop, boss] });
  const frame = model.sketchFrames!["boss-sketch"];
  expect(frame.originMillimeters.map(v => Math.round(v * 1e6) / 1e6)).toEqual([0, 0, 20]);
  expect(frame.normal).toEqual([0, 0, 1]); expect(frame.xDirection).toEqual([1, 0, 0]);
  const zs = Array.from(model.parts[0].vertices).filter((_, i) => i % 3 === 2);
  expect(Math.max(...zs)).toBeCloseTo(25, 3);
  // The frame comes back from the cache as well.
  expect(evaluatePartDocument({ ...document, features: [...document.features, onTop, boss] }).sketchFrames?.["boss-sketch"]?.originMillimeters.map(v => Math.round(v * 1e6) / 1e6)).toEqual([0, 0, 20]);
  // A normal no face has is refused the way FreeCAD refuses it.
  const sideways = { ...onTop, support: { ...onTop.support, normal: [0, 0.6, 0.8] as [number, number, number] } };
  expect(() => evaluatePartDocument({ ...document, features: [...document.features, sideways, boss] })).toThrow(/Sketch support face is missing or ambiguous/);
  // Two faces with the same normal need the anchor: the boss top (z 25) versus the plate top.
  const second = { ...onTop, id: "second-sketch", name: "Second", support: { ...onTop.support, sourceFeatureId: "boss" }, profile: { ...onTop.profile, radiusMillimeters: 2 } };
  const pin: PartDocument["features"][number] = { id: "pin", type: "extrude", name: "Pin", profileFeatureId: "second-sketch", distanceMillimeters: 3, operation: "add", suppressed: false };
  expect(() => evaluatePartDocument({ ...document, features: [...document.features, onTop, boss, second, pin] })).toThrow(/ambiguous/);
  const anchored = { ...second, support: { ...second.support, faceAnchor: { centerMillimeters: [10, 0, 25] as [number, number, number], areaSquareMillimeters: Math.PI * 25 } } };
  const pinned = evaluatePartDocument({ ...document, features: [...document.features, onTop, boss, anchored, pin] });
  expect(pinned.sketchFrames?.["second-sketch"]?.originMillimeters.map(v => Math.round(v * 1e6) / 1e6)).toEqual([10, 0, 25]);
  expect(Math.max(...Array.from(pinned.parts[0].vertices).filter((_, i) => i % 3 === 2))).toBeCloseTo(28, 3);
  const taller = { ...document, features: [...document.features.map(f => f.id === "ex" ? { ...f, distanceMillimeters: 30 } : f), onTop, boss, anchored, pin] };
  const followed = evaluatePartDocument(taller);
  expect(followed.sketchFrames?.["second-sketch"]?.originMillimeters.map(v => Math.round(v * 1e6) / 1e6)).toEqual([10, 0, 35]);
  expect(Math.max(...Array.from(followed.parts[0].vertices).filter((_, i) => i % 3 === 2))).toBeCloseTo(38, 3);
  const shifted = { ...anchored, support: { ...anchored.support, faceAnchor: { ...anchored.support.faceAnchor, centerMillimeters: [11, 0, 25] as [number, number, number] } } };
  expect(() => evaluatePartDocument({ ...taller, features: [...taller.features.slice(0, -2), shifted, pin] })).toThrow(/Sketch support face changed or is ambiguous/);

});

it("builds only the sketch regions a feature selected, the way the UI records picks", () => {
  // Two separate squares in one sketch; the extrude names one of them.
  const sketch = { id: "two", type: "profile" as const, name: "Two squares", plane: "XY" as const, offsetMillimeters: 0, suppressed: false, profile: { type: "drawing" as const, contours: [
    { type: "path" as const, id: "left", start: [-30, -5] as [number, number], segments: [{ type: "line" as const, end: [-20, -5] as [number, number] }, { type: "line" as const, end: [-20, 5] as [number, number] }, { type: "line" as const, end: [-30, 5] as [number, number] }, { type: "line" as const, end: [-30, -5] as [number, number] }] },
    { type: "path" as const, id: "right", start: [20, -5] as [number, number], segments: [{ type: "line" as const, end: [30, -5] as [number, number] }, { type: "line" as const, end: [30, 5] as [number, number] }, { type: "line" as const, end: [20, 5] as [number, number] }, { type: "line" as const, end: [20, -5] as [number, number] }] }] } };
  const base: PartDocument = { ...plate(), features: [sketch] };
  const one = evaluatePartDocument({ ...base, features: [sketch, { id: "e", type: "extrude", name: "E", profileFeatureId: "two", distanceMillimeters: 4, operation: "new", suppressed: false, regionMode: "faces", profileContourId: "right", profileSelections: [{ profileFeatureId: "two", profileContourId: "right" }] } as never] });
  const xs = Array.from(one.parts[0].vertices).filter((_, i) => i % 3 === 0);
  expect(Math.min(...xs)).toBeCloseTo(20); expect(Math.max(...xs)).toBeCloseTo(30);
  const both = evaluatePartDocument({ ...base, features: [sketch, { id: "e", type: "extrude", name: "E", profileFeatureId: "two", distanceMillimeters: 4, operation: "new", suppressed: false, profileSelections: [{ profileFeatureId: "two", profileContourId: "left" }, { profileFeatureId: "two", profileContourId: "right" }] } as never] });
  expect(Math.min(...Array.from(both.parts[0].vertices).filter((_, i) => i % 3 === 0))).toBeCloseTo(-30);
  // Nothing named extrudes the whole sketch (legacy and text documents).
  const all = evaluatePartDocument({ ...base, features: [sketch, { id: "e", type: "extrude", name: "E", profileFeatureId: "two", distanceMillimeters: 4, operation: "new", suppressed: false } as never] });
  expect(Math.min(...Array.from(all.parts[0].vertices).filter((_, i) => i % 3 === 0))).toBeCloseTo(-30);
  expect(() => evaluatePartDocument({ ...base, features: [sketch, { id: "e", type: "extrude", name: "E", profileFeatureId: "two", distanceMillimeters: 4, operation: "new", suppressed: false, profileContourId: "gone" } as never] })).toThrow(/no longer in its sketch/);
});

it("refuses a revolve whose profile crosses its axis instead of building an empty body", () => {
  const doc = {
    format: "aether-part", formatVersion: 21, documentId: "axis", name: "Axis", units: "millimeter", features: [
      { id: "s", type: "profile", name: "Sketch 1", plane: "XY", offsetMillimeters: 0, suppressed: false, profile: { type: "drawing", contours: [{ type: "circle", id: "c", center: [0, 0], radius: 10 }] } },
      { id: "r", type: "revolve", name: "Revolve 1", profileFeatureId: "s", profileContourId: "c", axis: "X", angleDegrees: 90, operation: "new", suppressed: false }] } as unknown as PartDocument;
  expect(() => evaluatePartDocument(doc)).toThrow(/Revolve 1: Revolve profile crosses its axis/);
  (doc.features[0] as any).profile.contours[0].center = [0, 30];
  expect(evaluatePartDocument(doc).parts.map(p => p.id)).toEqual(["axis:body-1"]);
});
