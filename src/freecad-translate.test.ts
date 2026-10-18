import { describe, expect, it } from "vitest";
import { createRectanglePartDocument } from "./aether-core";
import { sketchRegions, translateDocument } from "./freecad-translate";

describe("translating a real document for the FreeCAD engine", () => {
  it("translates the app's own rectangle-and-extrude part completely", () => {
    const document = createRectanglePartDocument("Bracket", {
      widthMillimeters: 60,
      heightMillimeters: 40,
      depthMillimeters: 20,
    });
    const translation = translateDocument(document);
    expect(translation.complete).toBe(true);
    expect(translation.untranslated).toEqual([]);
    expect(translation.features.map((f) => f.kind)).toEqual([
      "sketch-polygon",
      "pad",
    ]);
    const [sketch, pad] = translation.features;
    expect((sketch.parameters.points_mm as number[][]).length).toBe(4);
    expect(pad.parameters.distance_mm).toBe(20);
    // The pad must name the sketch it extrudes, or the engine guesses.
    expect(pad.parameters.profile).toBe(sketch.id);
  });

  it("honours rollback by truncating, the way the engine expects", () => {
    const document = createRectanglePartDocument("Bracket", {
      widthMillimeters: 60, heightMillimeters: 40, depthMillimeters: 20,
    });
    const translation = translateDocument({ ...document, rollbackIndex: 1 });
    expect(translation.features.map((f) => f.kind)).toEqual(["sketch-polygon"]);
  });

  it("skips suppressed features instead of building them", () => {
    const document = createRectanglePartDocument("Bracket", {
      widthMillimeters: 60, heightMillimeters: 40, depthMillimeters: 20,
    });
    const suppressed = {
      ...document,
      features: document.features.map((feature) =>
        feature.type === "extrude" ? { ...feature, suppressed: true } : feature,
      ),
    };
    const translation = translateDocument(suppressed);
    expect(translation.features.map((f) => f.kind)).toEqual(["sketch-polygon"]);
  });

  it("reports what it cannot express rather than dropping it silently", () => {
    const document = createRectanglePartDocument("Bracket", {
      widthMillimeters: 60, heightMillimeters: 40, depthMillimeters: 20,
    });
    // A mirror that cuts: the document can express it, the FreeCAD path
    // cannot yet, and the difference has to reach the caller.
    const withCuttingMirror = {
      ...document,
      features: [
        ...document.features,
        {
          id: "mir-1", type: "mirror" as const, name: "Mirror 1",
          suppressed: false, sourceFeatureId: document.features[1].id,
          plane: "YZ" as const, offsetMillimeters: 0, operation: "cut" as const,
        } as never,
      ],
    };
    const translation = translateDocument(withCuttingMirror);
    expect(translation.complete).toBe(false);
    expect(translation.untranslated).toEqual([
      {
        id: "mir-1",
        name: "Mirror 1",
        reason: "a mirror that cuts is not translated yet",
      },
    ]);
    // The features that do translate still come through.
    expect(translation.features.map((f) => f.kind)).toEqual(["sketch-polygon", "pad"]);
  });

  it("refuses an extrude whose sketch never translated", () => {
    const translation = translateDocument({
      documentId: "d1", name: "Orphan", format: "aether-part", version: 3,
      features: [
        {
          id: "e1", type: "extrude", name: "Extrude 1", suppressed: false,
          profileFeatureId: "missing", distanceMillimeters: 10, operation: "new",
        },
      ],
    } as never);
    expect(translation.features).toEqual([]);
    expect(translation.untranslated[0].reason).toMatch(/Missing reference: missing/);
  });

  it("maps a cut extrude to a pocket, not a pad", () => {
    const document = createRectanglePartDocument("Bracket", {
      widthMillimeters: 60, heightMillimeters: 40, depthMillimeters: 20,
    });
    const cut = {
      ...document,
      features: [...document.features, { ...document.features.find(f => f.type === "extrude")!, id: "cut", operation: "cut" as const }],
    };
    expect(translateDocument(cut).features[2]).toMatchObject({
      kind: "pocket",
      parameters: { depth_mm: 20 },
    });
  });
});

describe("translating the solid features the toolbar can now reach", () => {
  const sketch = {
    id: "s1",
    type: "profile" as const,
    name: "Sketch",
    plane: "XY" as const,
    offsetMillimeters: 0,
    suppressed: false,
    profile: {
      type: "polygon" as const,
      pointsMillimeters: [
        [10, 0],
        [30, 0],
        [30, 10],
      ] as [number, number][],
    },
  };
  const document = (features: unknown[]) =>
    translateDocument({ features } as never);

  it("translates a revolve, naming its sketch and axis", () => {
    const translation = document([
      sketch,
      {
        id: "r1",
        type: "revolve",
        name: "Revolve",
        profileFeatureId: "s1",
        axis: "X",
        angleDegrees: 270,
        operation: "new",
        suppressed: false,
      },
    ]);
    expect(translation.complete).toBe(true);
    const revolve = translation.features[1];
    expect(revolve.kind).toBe("revolve");
    expect(revolve.parameters).toMatchObject({
      profile: "s1",
      axis: "X",
      angle_deg: 270,
      cut: false,
    });
  });

  it("sends a cutting revolve across as a cut, which the engine grooves", () => {
    const translation = document([
      sketch,
      { id: "base", type: "extrude", profileFeatureId: "s1", name: "Base", operation: "new", distanceMillimeters: 10, suppressed: false },
      {
        id: "r1", type: "revolve", name: "Revolve", profileFeatureId: "s1",
        axis: "Z", angleDegrees: 360, operation: "cut", suppressed: false,
      },
    ]);
    expect(translation.features[2].parameters.cut).toBe(true);
  });

  it("refuses a revolve whose angle is outside a single turn", () => {
    const translation = document([
      sketch,
      {
        id: "r1", type: "revolve", name: "Revolve", profileFeatureId: "s1",
        axis: "Z", angleDegrees: 361, operation: "new", suppressed: false,
      },
    ]);
    expect(translation.features).toHaveLength(1);
    expect(translation.untranslated[0].reason).toMatch(/between 0 and 360/);
  });

  it("carries an edge finish's plane through, and omits it when every edge counts", () => {
    const translation = document([
      sketch,
      {
        id: "e1", type: "extrude", name: "Extrude", profileFeatureId: "s1",
        distanceMillimeters: 5, operation: "new", suppressed: false,
      },
      {
        id: "f1", type: "fillet", name: "Fillet",
        radiusMillimeters: 2, suppressed: false,
        edgePlane: { plane: "XY", offsetMillimeters: 5 },
      },
      {
        id: "c1", type: "chamfer", name: "Chamfer",
        radiusMillimeters: 1, suppressed: false,
      },
    ]);
    expect(translation.complete).toBe(true);
    expect(translation.features[2].parameters).toMatchObject({
      radius_mm: 2,
      plane: "XY",
      offset_mm: 5,
    });
    // No plane means every edge; sending one would silently narrow it.
    expect(translation.features[3].parameters).toMatchObject({ radius_mm: 1 });
    expect(translation.features[3].parameters.plane).toBeUndefined();
  });

  it("mirrors a translated solid, and says so when the source never made it", () => {
    const mirror = {
      id: "m1", type: "mirror", name: "Mirror", sourceFeatureId: "e1",
      plane: "YZ", offsetMillimeters: 0, operation: "add", suppressed: false,
    };
    const extrude = {
      id: "e1", type: "extrude", name: "Extrude", profileFeatureId: "s1",
      distanceMillimeters: 5, operation: "new" as const, suppressed: false,
    };
    expect(document([sketch, extrude, mirror]).features[2].parameters).toMatchObject({
      source: "e1",
      plane: "YZ",
    });
    // Without the extrude there is nothing to mirror, and the reason has to say so.
    const orphan = document([sketch, mirror]);
    expect(orphan.features).toHaveLength(1);
    expect(orphan.untranslated[0].reason).toMatch(/Missing reference: e1/);
  });

  it("does not pretend a cutting mirror is an adding one", () => {
    const translation = document([
      sketch,
      {
        id: "e1", type: "extrude", name: "Extrude", profileFeatureId: "s1",
        distanceMillimeters: 5, operation: "new", suppressed: false,
      },
      {
        id: "m1", type: "mirror", name: "Mirror", sourceFeatureId: "e1",
        plane: "YZ", offsetMillimeters: 0, operation: "cut", suppressed: false,
      },
    ]);
    expect(translation.features).toHaveLength(2);
    expect(translation.untranslated[0].reason).toMatch(/cuts is not translated/);
  });
});

describe("a sketch holding several separate regions", () => {
  /** Jonathan's part: two triangles, a square and a circle in one sketch. */
  const drawnSketch = {
    id: "s1",
    type: "profile" as const,
    name: "Sketch 1",
    plane: "XY" as const,
    offsetMillimeters: 0,
    suppressed: false,
    profile: {
      type: "drawing" as const,
      contours: [
        {
          type: "path" as const,
          start: [0, 0] as [number, number],
          segments: [
            { type: "line" as const, end: [10, 0] as [number, number] },
            { type: "line" as const, end: [5, 8] as [number, number] },
            { type: "line" as const, end: [0, 0] as [number, number] },
          ],
        },
        {
          type: "path" as const,
          start: [20, 0] as [number, number],
          segments: [
            { type: "line" as const, end: [30, 0] as [number, number] },
            { type: "line" as const, end: [30, 10] as [number, number] },
            { type: "line" as const, end: [20, 10] as [number, number] },
            { type: "line" as const, end: [20, 0] as [number, number] },
          ],
        },
        { type: "circle" as const, center: [50, 5] as [number, number], radius: 4 },
      ],
    },
  };
  const translate = (features: unknown[]) => translateDocument({ features } as never);

  it("translates every closed region instead of refusing the whole sketch", () => {
    const translation = translate([drawnSketch]);
    // Before this, `contours.length !== 1` made a multi-region sketch
    // untranslatable, so nothing in the part could be built at all.
    expect(translation.features.map((f) => f.kind)).toEqual([
      "sketch-polygon",
      "sketch-polygon",
      "sketch-circle",
    ]);
    expect(translation.features.map((f) => f.id)).toEqual(["s1#0", "s1#1", "s1#2"]);
    expect(translation.features[2].parameters).toMatchObject({ radius_mm: 4 });
  });

  it("offers those regions to a picker, in the order the translator uses", () => {
    expect(sketchRegions(drawnSketch as never).map((r) => r.label)).toEqual([
      "Region 1 · 3 sides",
      "Region 2 · 4 sides",
      "Region 3 · circle",
    ]);
  });

  it("extrudes the one region it names, not the whole sketch", () => {
    const identified = {
      ...drawnSketch,
      profile: {
        ...drawnSketch.profile,
        contours: drawnSketch.profile.contours.map((c, i) =>
          i === 2 ? { ...c, id: "circle-contour" } : c,
        ),
      },
    };
    const translation = translate([
      identified,
      {
        id: "e1", type: "extrude", name: "Extrude 1", profileFeatureId: "s1",
        profileContourId: "circle-contour", distanceMillimeters: 6,
        operation: "new", suppressed: false,
      },
    ]);
    expect(translation.complete).toBe(true);
    const pad = translation.features.at(-1)!;
    expect(pad.kind).toBe("pad");
    // The circle is the third contour, so its engine sketch is s1#2.
    expect(pad.parameters).toMatchObject({ profile: "s1#2", distance_mm: 6 });
  });

  it("refuses to guess when several regions exist and none was named", () => {
    const translation = translate([
      drawnSketch,
      {
        id: "e1", type: "extrude", name: "Extrude 1", profileFeatureId: "s1",
        distanceMillimeters: 6, operation: "new", suppressed: false,
      },
    ]);
    expect(translation.features.some((f) => f.kind === "pad")).toBe(false);
    expect(translation.untranslated[0].reason).toMatch(/has 3 regions/);
  });

  it("says so when the named region has left the sketch", () => {
    const translation = translate([
      drawnSketch,
      {
        id: "e1", type: "extrude", name: "Extrude 1", profileFeatureId: "s1",
        profileContourId: "deleted-contour", distanceMillimeters: 6,
        operation: "new", suppressed: false,
      },
    ]);
    expect(translation.untranslated[0].reason).toMatch(/no longer in its sketch/);
  });

  it("still needs no region named when the sketch holds only one", () => {
    const single = {
      ...drawnSketch,
      profile: { ...drawnSketch.profile, contours: [drawnSketch.profile.contours[0]] },
    };
    const translation = translate([
      single,
      {
        id: "e1", type: "extrude", name: "Extrude 1", profileFeatureId: "s1",
        distanceMillimeters: 6, operation: "new", suppressed: false,
      },
    ]);
    expect(translation.complete).toBe(true);
    // One region keeps the plain sketch id, so documents already saved against
    // it still translate unchanged.
    expect(translation.features[0].id).toBe("s1");
    expect(translation.features[1].parameters).toMatchObject({ profile: "s1" });
  });

  it("reports a curved region rather than dropping it in silence", () => {
    const curved = {
      ...drawnSketch,
      profile: {
        ...drawnSketch.profile,
        contours: [
          drawnSketch.profile.contours[0],
          {
            type: "path" as const,
            start: [0, 0] as [number, number],
            segments: [{ type: "arc" as const, end: [5, 5] as [number, number] }],
          },
        ],
      },
    };
    const translation = translate([curved]);
    expect(translation.features).toHaveLength(1);
    expect(translation.untranslated[0].reason).toMatch(/Region 2 has an arc without/);
  });
});

it("preserves open paths as wires but never offers them as extrudable regions", () => {
  const feature = { id: "open", type: "profile", name: "Path", plane: "XY", offsetMillimeters: 0, suppressed: false,
    profile: { type: "drawing", contours: [{ type: "path", start: [0, 0], segments: [{ type: "line", end: [10, 0] }, { type: "line", end: [10, 10] }] }] } };
  const translated = translateDocument({ features: [feature] } as never);
  expect(translated.complete).toBe(true);
  expect(translated.features[0].kind).toBe("sketch-wire");
  expect(sketchRegions(feature as never)).toHaveLength(0);
});

it("preserves a face sketch's frame and exact arc geometry", () => {
  const frame = { originMillimeters: [0, 0, 10], xDirection: [1, 0, 0], normal: [0, 0, 1] };
  const feature = { id: "arc", type: "profile", name: "Arc profile", plane: "XY", frame, offsetMillimeters: 0, suppressed: false,
    profile: { type: "drawing", contours: [{ type: "path", start: [0, 0], segments: [{ type: "arc", middle: [5, 5], end: [10, 0] }, { type: "line", end: [0, 0] }] }] } };
  const translated = translateDocument({ features: [feature] } as never);
  expect(translated.complete).toBe(true);
  expect(translated.features[0].parameters.frame).toEqual(frame);
  expect(sketchRegions(feature as never)).toHaveLength(1);
});
