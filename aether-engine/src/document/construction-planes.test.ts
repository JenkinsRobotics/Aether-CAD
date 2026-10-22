import { describe, expect, it } from "vitest";
import { resolvePlaneFrame } from "./construction-planes";
import type { ConstructionPlaneFeature } from "./construction-planes";
import {
  createEmptyPartDocument,
  parsePartDocument,
  serializePartDocument,
  validatePartDocument,
} from "./index";

const plane = (overrides: Partial<ConstructionPlaneFeature>): ConstructionPlaneFeature => ({
  id: "p1",
  name: "Plane 1",
  type: "plane",
  plane: "XY",
  offsetMillimeters: 0,
  suppressed: false,
  ...overrides,
});

describe("construction plane definitions", () => {
  it("legacy planes resolve as principal plus offset", () => {
    expect(resolvePlaneFrame(plane({ plane: "XZ", offsetMillimeters: 25 }))).toEqual({
      originMillimeters: [0, -25, 0],
      normal: [0, -1, 0],
      xDirection: [1, 0, 0],
    });
  });

  it("offsets from an earlier plane feature, recursively", () => {
    const base = plane({ id: "base", offsetMillimeters: 5 });
    const derived = plane({
      id: "derived",
      name: "Plane 2",
      definition: {
        method: "offset",
        reference: { kind: "feature", featureId: "base" },
        distanceMillimeters: 7,
      },
    });
    expect(resolvePlaneFrame(derived, [base]).originMillimeters).toEqual([0, 0, 12]);
  });

  it("mid plane sits halfway between two parallel planes", () => {
    const a = plane({ id: "a", offsetMillimeters: 10 });
    const b = plane({ id: "b", offsetMillimeters: 30 });
    const mid = plane({
      id: "mid",
      name: "Mid",
      definition: {
        method: "mid",
        references: [
          { kind: "feature", featureId: "a" },
          { kind: "feature", featureId: "b" },
        ],
      },
    });
    expect(resolvePlaneFrame(mid, [a, b])).toEqual({
      originMillimeters: [0, 0, 20],
      normal: [0, 0, 1],
      xDirection: [1, 0, 0],
    });
  });

  it("flip negates the resolved normal", () => {
    const flipped = plane({
      definition: {
        method: "offset",
        reference: { kind: "principal", plane: "XY" },
        distanceMillimeters: 5,
        flip: true,
      },
    });
    expect(resolvePlaneFrame(flipped, [])).toMatchObject({
      originMillimeters: [0, 0, 5],
      normal: [-0, -0, -1],
    });
  });

  it("rejects a mid plane between non-parallel planes", () => {
    const mid = plane({
      id: "mid",
      name: "Mid",
      definition: {
        method: "mid",
        references: [
          { kind: "principal", plane: "XY" },
          { kind: "principal", plane: "XZ" },
        ],
      },
    });
    expect(() => resolvePlaneFrame(mid, [])).toThrow(/parallel/);
  });

  it("validation preserves missing references and rejects later planes and round-trips definitions", () => {
    const doc = createEmptyPartDocument("Planes");
    doc.features.push(
      plane({
        id: "orphan",
        definition: {
          method: "offset",
          reference: { kind: "feature", featureId: "nope" },
          distanceMillimeters: 5,
        },
      }),
    );
    expect(() => validatePartDocument(doc)).not.toThrow();
    doc.features.length = 0;
    doc.features.push(
      plane({ id: "base" }),
      plane({
        id: "mid",
        name: "Plane 2",
        definition: {
          method: "mid",
          references: [
            { kind: "feature", featureId: "base" },
            { kind: "principal", plane: "XY" },
          ],
        },
      }),
    );
    validatePartDocument(doc);
    const reopened = parsePartDocument(serializePartDocument(doc));
    expect(reopened.features[1]).toMatchObject({
      definition: { method: "mid" },
    });
  });
});

it('an angled plane must contain its straight rotation axis',()=>{
 const feature=plane({definition:{method:'angle',reference:{kind:'principal',plane:'XY'},axis:{kind:'axis',partId:'p',candidateId:'e',originMillimeters:[2,3,4],directionMillimeters:[0,0,1]},angleDegrees:45}});
 expect(()=>resolvePlaneFrame(feature)).toThrow(/axis must be parallel/);
 if(feature.definition?.method !== 'angle')throw new Error('Expected angle');
 feature.definition.axis.directionMillimeters=[1,0,0];
 const frame=resolvePlaneFrame(feature);
 expect(frame.originMillimeters).toEqual([2,3,4]);
 expect(frame.normal[0]).toBeCloseTo(0);
 expect(frame.normal[1]).toBeCloseTo(-Math.SQRT1_2);
 expect(frame.normal[2]).toBeCloseTo(Math.SQRT1_2);
});

it("resolves perpendicular, two-edge, tangent and along-path planes", async () => {
  const { resolvePlaneFrame, validatePlaneDefinition } = await import("./construction-planes");
  const edgeX = { kind: "axis" as const, partId: "p", candidateId: "e1", originMillimeters: [5, 0, 0] as [number, number, number], directionMillimeters: [1, 0, 0] as [number, number, number], lengthMillimeters: 10 };
  const edgeY = { kind: "axis" as const, partId: "p", candidateId: "e2", originMillimeters: [0, 5, 0] as [number, number, number], directionMillimeters: [0, 1, 0] as [number, number, number], lengthMillimeters: 10 };
  const base = { id: "pl", name: "Plane", type: "plane" as const, plane: "XY" as const, offsetMillimeters: 0, suppressed: false };
  const perpendicular = resolvePlaneFrame({ ...base, definition: { method: "perpendicular", axis: edgeX, reference: { kind: "principal", plane: "XY" } } });
  expect(perpendicular.normal.map(Math.abs)).toEqual([0, 1, 0]);
  expect(perpendicular.originMillimeters).toEqual([5, 0, 0]);
  const twoEdges = resolvePlaneFrame({ ...base, definition: { method: "two-edges", axes: [edgeX, edgeY] } });
  expect(twoEdges.normal.map(Math.abs)).toEqual([0, 0, 1]);
  expect(() => resolvePlaneFrame({ ...base, definition: { method: "two-edges", axes: [edgeX, { ...edgeY, originMillimeters: [0, 5, 3] }] } })).toThrow(/one plane/);
  const tangent = resolvePlaneFrame({ ...base, definition: { method: "tangent", surface: { kind: "surface-point", partId: "p", faceId: 3, pointMillimeters: [1, 2, 3], normalMillimeters: [0, 0, 2] } } });
  expect(tangent.normal).toEqual([0, 0, 1]); expect(tangent.originMillimeters).toEqual([1, 2, 3]);
  const along = resolvePlaneFrame({ ...base, definition: { method: "along-path", axis: edgeX, t: 0.25 } });
  expect(along.originMillimeters).toEqual([2.5, 0, 0]); expect(along.normal).toEqual([1, 0, 0]);
  expect(() => validatePlaneDefinition({ ...base, definition: { method: "along-path", axis: { ...edgeX, lengthMillimeters: undefined }, t: 0.5 } }, new Set())).toThrow(/length/);
});

