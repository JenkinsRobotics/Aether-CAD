import { describe, expect, it } from "vitest";
import { appendDocument, featuresOfBody, splitDocument } from "./component-split";
import { availableBodies } from "./feature-history";
import { PART_DOCUMENT_VERSION, type PartDocument } from "./part-document";
import { createCenterRectangleSketch } from "../sketch/constraints";

const rect = (id: string, w: number) => createCenterRectangleSketch(id, "XY", w, 10, true);
const extrude = (id: string, sketch: string, extra: object = {}) => ({ id, type: "extrude", name: id, profileFeatureId: sketch, operation: "new", distanceMillimeters: 5, suppressed: false, ...extra } as any);
const doc = (features: any[]): PartDocument => ({ format: "aether-part", formatVersion: PART_DOCUMENT_VERSION, documentId: "d", name: "Source", units: "millimeter", features } as any);

describe("splitting a part document by body", () => {
  const two = doc([rect("s1", 10), extrude("e1", "s1"), rect("s2", 20), extrude("e2", "s2"), { id: "f1", type: "fillet", name: "f1", radiusMillimeters: 1, suppressed: false, targetBodyId: "d:body-e2", edges: [{ kind: "curved-edge", sourceFeatureId: "e2", bodyId: "d:body-e2", label: "edge", midpointMillimeters: [10, 0, 5], lengthMillimeters: 10 }] } as any]);
  it("lists a body's producer and its modifiers", () => {
    const [a, b] = availableBodies(two).map((b) => b.id);
    expect(featuresOfBody(two, a)).toEqual(["e1"]);
    expect(featuresOfBody(two, b)).toEqual(["e2", "f1"]);
  });
  it("moves a body with its sketch and leaves the other body whole", () => {
    const [, b] = availableBodies(two).map((b) => b.id);
    const { extracted, remaining } = splitDocument(two, { bodyIds: [b] }, "Part 2");
    expect(extracted.features.map((f) => f.id)).toEqual(["s2", "e2", "f1"]);
    expect(remaining.features.map((f) => f.id)).toEqual(["s1", "e1"]);
    expect(extracted.name).toBe("Part 2");
    expect(availableBodies(extracted)).toHaveLength(1);
  });
  it("copies a sketch two bodies share instead of stealing it", () => {
    const shared = doc([rect("s", 10), extrude("a", "s"), extrude("b", "s", { distanceMillimeters: 9 })]);
    const [, b] = availableBodies(shared).map((b) => b.id);
    const { extracted, remaining } = splitDocument(shared, { bodyIds: [b] }, "B");
    expect(extracted.features.map((f) => f.id)).toEqual(["s", "b"]);
    expect(remaining.features.map((f) => f.id)).toEqual(["s", "a"]);
  });
  it("moves a loose sketch on its own and appends into another document", () => {
    const loose = doc([rect("s1", 10), extrude("e1", "s1"), rect("loose", 40)]);
    const { extracted, remaining } = splitDocument(loose, { sketchIds: ["loose"] }, "Sketches");
    expect(extracted.features.map((f) => f.id)).toEqual(["loose"]);
    expect(remaining.features.map((f) => f.id)).toEqual(["s1", "e1"]);
    const target = doc([rect("t", 10), extrude("te", "t")]);
    expect(appendDocument(target, extracted).features.map((f) => f.id)).toEqual(["t", "te", "loose"]);
    expect(appendDocument(target, extracted).features).toHaveLength(3);
  });
  it("refuses unknown picks", () => {
    expect(() => splitDocument(two, { bodyIds: ["nope"] }, "x")).toThrow(/No body/);
    expect(() => splitDocument(two, {}, "x")).toThrow(/at least one/);
  });
});
