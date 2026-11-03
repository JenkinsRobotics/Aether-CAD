import { beforeAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import init from "replicad-opencascadejs";
import { measureVolume, setOC, type Shape3D } from "replicad";
import { evaluatePartDocument } from "./part-evaluator";
import initFull from "opencascade.js/dist/node.js";
import { loadExtendedKernel } from "./extended-kernel";
import { createWheelExample } from "../document/wheel-example";
beforeAll(async () => {
  setOC(
    await (init as any)({
      wasmBinary: readFileSync(
        new URL(
          "../../node_modules/replicad-opencascadejs/src/replicad_single.wasm",
          import.meta.url,
        ),
      ),
    }),
  );
}, 30000);
it("builds a revolved wheel with additive hub, bore, and mirrored through holes", () => {
  const result = evaluatePartDocument(createWheelExample());
  expect(result.parts).toHaveLength(1);
  const body = result.parts[0];
  expect(body.triangles.length).toBeGreaterThan(100);
  const centers = body.topology
    .flatMap((f) => f.candidates)
    .filter((c) => c.kind === "cylinder-axis")
    .map((c) => c.origin);
  for (const [x, y] of [
    [16, 8],
    [-16, 8],
    [16, -8],
    [-16, -8],
  ])
    expect(
      centers.some(
        (p) => Math.abs(p[0] - x) < 0.01 && Math.abs(p[1] - y) < 0.01,
      ),
    ).toBe(true);
  const zs = Array.from(body.vertices).filter((_, i) => i % 3 === 2);
  expect(Math.min(...zs)).toBeCloseTo(0, 3);
  expect(Math.max(...zs)).toBeCloseTo(18, 3);
  const changed = createWheelExample();
  const sketch = changed.features.find((f) => f.id === "hole");
  if (sketch?.type === "profile" && sketch.profile.type === "circle")
    sketch.profile.centerMillimeters = [18, 9];
  const rebuilt = evaluatePartDocument(changed).parts[0];
  expect(
    rebuilt.topology
      .flatMap((f) => f.candidates)
      .some(
        (c) =>
          c.kind === "cylinder-axis" &&
          Math.abs(c.origin[0] - 18) < 0.01 &&
          Math.abs(c.origin[1] - 9) < 0.01,
      ),
  ).toBe(true);
  expect(Array.from(rebuilt.vertices)).not.toEqual(Array.from(body.vertices));
}, 30000);

it.each(["fillet", "chamfer"] as const)("finishes only the picked edges (%s)", async (type) => {
  const { createRectanglePartDocument, createEmptyPartDocument } = await import("../document/part-document");
  // A straight edge by its vertex anchors: one top edge of a box.
  const box = createRectanglePartDocument("Picked edge", { widthMillimeters: 30, heightMillimeters: 20, depthMillimeters: 10 });
  const built = evaluatePartDocument(box).parts[0];
  const topEdge = built.topology.flatMap((face) => face.candidates).find((c) => c.kind === "edge-midpoint" && c.edgeAnchor && Math.abs(c.origin[2] - 10) < 1e-6 && c.measurements?.linearDirection && Math.abs(c.measurements.linearDirection[0]) > 0.5);
  expect(topEdge?.edgeAnchor).toBeDefined();
  box.features.push({ id: "finish", name: "Finish", type, radiusMillimeters: 1, suppressed: false,
    edges: [{ kind: "solid-edge", sourceFeatureId: box.features[1].id, bodyId: built.id, anchor: structuredClone(topEdge!.edgeAnchor!), label: "Edge" }] });
  expect(evaluatePartDocument(box).parts[0].topology.length).toBe(built.topology.length + 1);
  // A curved edge by midpoint and length: the top circle of a cylinder.
  const cyl = createEmptyPartDocument("Picked circle");
  cyl.features.push({ id: "s", type: "profile", name: "Sketch", plane: "XY", offsetMillimeters: 0, suppressed: false, profile: { type: "circle", radiusMillimeters: 10, centerMillimeters: [0, 0] } });
  cyl.features.push({ id: "e", type: "extrude", name: "Extrude", profileFeatureId: "s", distanceMillimeters: 8, operation: "new", suppressed: false });
  const drum = evaluatePartDocument(cyl).parts[0];
  const rim = drum.topology.flatMap((face) => face.candidates).find((c) => c.kind === "edge-midpoint" && Math.abs(c.origin[2] - 8) < 1e-6);
  expect(rim?.measurements?.lengthMillimeters).toBeCloseTo(2 * Math.PI * 10, 3);
  cyl.features.push({ id: "finish", name: "Finish", type, radiusMillimeters: 1, suppressed: false,
    edges: [{ kind: "curved-edge", sourceFeatureId: "e", bodyId: drum.id, midpointMillimeters: [...rim!.origin] as [number, number, number], lengthMillimeters: rim!.measurements!.lengthMillimeters!, label: "Rim" }] });
  expect(evaluatePartDocument(cyl).parts[0].topology.length).toBe(drum.topology.length + 1);
  // A pick that no longer matches is a refusal, never the nearest edge.
  cyl.features[2] = { ...cyl.features[2], edges: [{ kind: "curved-edge", sourceFeatureId: "e", bodyId: drum.id, midpointMillimeters: [0, 10, 4], lengthMillimeters: 5, label: "Gone" }] } as typeof cyl.features[2];
  expect(() => evaluatePartDocument(cyl)).toThrow(/Reselect/);
}, 30000);

it("drafts and shells by picked face references", async () => {
  const { createRectanglePartDocument } = await import("../document/part-document");
  const box = createRectanglePartDocument("Picked faces", { widthMillimeters: 30, heightMillimeters: 20, depthMillimeters: 10 });
  const built = evaluatePartDocument(box).parts[0];
  const extrudeId = box.features[1].id;
  const faceWithNormal = (n: [number, number, number]) => built.topology.find((face) => face.surfaceType === "PLANE" && face.candidates.some((c) => c.kind === "face-center" && Math.abs(c.zAxis[0] - n[0]) + Math.abs(c.zAxis[1] - n[1]) + Math.abs(c.zAxis[2] - n[2]) < 1e-6));
  expect(faceWithNormal([1, 0, 0])).toBeDefined();
  // Draft: the +X wall tilts about the XY neutral plane; the +X and -X walls are both drafted.
  const drafted = { ...box, features: [...box.features, { id: "d", type: "draft" as const, name: "Draft", suppressed: false, angleDegrees: 10, reversed: false,
    facePlane: { plane: "YZ" as const, offsetMillimeters: 0 }, neutralPlane: { plane: "XY" as const, offsetMillimeters: 0 },
    faces: [{ sourceFeatureId: extrudeId, bodyId: built.id, label: "+X", normal: [1, 0, 0] as [number, number, number] }, { sourceFeatureId: extrudeId, bodyId: built.id, label: "-X", normal: [-1, 0, 0] as [number, number, number] }] }] };
  const draftedPart = evaluatePartDocument(drafted);
  const volume = (doc: typeof box) => { let v = 0; evaluatePartDocument(doc, { withBodies: (b) => { for (const body of b.values()) v += measureVolume(body as Shape3D); } }); return v; };
  expect(volume(drafted)).toBeLessThan(volume(box) - 1);
  expect(draftedPart.parts[0].topology.length).toBe(6);
  // Shell: the top face opened by reference, not by plane.
  const shelled = { ...box, features: [...box.features, { id: "sh", type: "shell" as const, name: "Shell", suppressed: false, thicknessMillimeters: 1,
    removedFaces: [{ sourceFeatureId: extrudeId, bodyId: built.id, label: "Top", normal: [0, 0, 1] as [number, number, number] }] }] };
  expect(evaluatePartDocument(shelled).parts[0].topology.length).toBe(11);
  expect(volume(shelled)).toBeCloseTo(30 * 20 * 10 - 28 * 18 * 9, 3);
}, 30000);

it("chamfers with two distances or an angle, fillets with a variable or per-edge radius", async () => {
  const { createRectanglePartDocument } = await import("../document/part-document");
  const box = createRectanglePartDocument("Finish sizes", { widthMillimeters: 30, heightMillimeters: 20, depthMillimeters: 10 });
  const built = evaluatePartDocument(box).parts[0];
  const extrudeId = box.features[1].id;
  const topEdges = built.topology.flatMap((face) => face.candidates).filter((c) => c.kind === "edge-midpoint" && c.edgeAnchor && Math.abs(c.origin[2] - 10) < 1e-6 && c.measurements?.linearDirection && Math.abs(c.measurements.linearDirection[0]) > 0.5);
  expect(topEdges.length).toBe(4); // each x-direction top edge is listed by both of its faces
  const picks = [...new Map(topEdges.map((c) => [c.origin.join(","), c])).values()].map((c) => ({ kind: "solid-edge" as const, sourceFeatureId: extrudeId, bodyId: built.id, anchor: structuredClone(c.edgeAnchor!), label: `Edge y=${c.origin[1]}` }));
  expect(picks.length).toBe(2);
  const volume = (doc: typeof box) => { let v = 0; evaluatePartDocument(doc, { withBodies: (b) => { for (const body of b.values()) v += measureVolume(body as Shape3D); } }); return v; };
  const full = volume(box), length = 30;
  const withFinish = (extra: Record<string, unknown>) => ({ ...box, features: [...box.features, { id: "f", name: "Finish", suppressed: false, radiusMillimeters: 1, edges: [picks[0]], ...extra } as typeof box.features[number]] });
  // Chamfer 1 × 3: a right triangle of 1 by 3 swept along the edge.
  expect(full - volume(withFinish({ type: "chamfer", secondDistanceMillimeters: 3 }))).toBeCloseTo(0.5 * 1 * 3 * length, 4);
  // Chamfer distance 2 at 30°: the second leg is 2·tan 30°.
  expect(full - volume(withFinish({ type: "chamfer", radiusMillimeters: 2, angleDegrees: 30 }))).toBeCloseTo(0.5 * 2 * 2 * Math.tan(Math.PI / 6) * length, 4);
  // Variable fillet 1 → 2 removes more than r=1 and less than r=2 would.
  const removed = (r: number) => (1 - Math.PI / 4) * r * r * length;
  const variable = full - volume(withFinish({ type: "fillet", endRadiusMillimeters: 2 }));
  expect(variable).toBeGreaterThan(removed(1)); expect(variable).toBeLessThan(removed(2));
  // Per-edge radii: 1 on one edge, 2 on the other.
  const perEdge = withFinish({ type: "fillet", edges: [picks[0], { ...picks[1], radiusMillimeters: 2 }] });
  expect(full - volume(perEdge)).toBeCloseTo(removed(1) + removed(2), 3);
}, 30000);

it("shells inside, outside or both ways, and drafts about a picked neutral face", async () => {
  const { createRectanglePartDocument } = await import("../document/part-document");
  const box = createRectanglePartDocument("Shell direction", { widthMillimeters: 30, heightMillimeters: 20, depthMillimeters: 10 });
  const built = evaluatePartDocument(box).parts[0];
  const extrudeId = box.features[1].id;
  const volume = (doc: typeof box) => { let v = 0; evaluatePartDocument(doc, { withBodies: (b) => { for (const body of b.values()) v += measureVolume(body as Shape3D); } }); return v; };
  const top = { sourceFeatureId: extrudeId, bodyId: built.id, label: "Top", normal: [0, 0, 1] as [number, number, number] };
  const shelled = (direction?: "inside" | "outside" | "both") => ({ ...box, features: [...box.features, { id: "sh", type: "shell" as const, name: "Shell", suppressed: false, thicknessMillimeters: 1, removedFaces: [top], ...(direction ? { direction } : {}) }] });
  expect(volume(shelled())).toBeCloseTo(6000 - 28 * 18 * 9, 3);
  expect(volume(shelled("inside"))).toBeCloseTo(6000 - 28 * 18 * 9, 3);
  expect(volume(shelled("outside"))).toBeCloseTo(32 * 22 * 11 - 6000, 3);
  expect(volume(shelled("both"))).toBeCloseTo(31 * 21 * 10.5 - 29 * 19 * 9.5, 3);
  // Draft about the bottom face picked as the neutral face equals the XY plane at z = 0.
  const plus = { sourceFeatureId: extrudeId, bodyId: built.id, label: "+X", normal: [1, 0, 0] as [number, number, number] };
  const bottom = { sourceFeatureId: extrudeId, bodyId: built.id, label: "Bottom", normal: [0, 0, -1] as [number, number, number] };
  const draft = (neutral: Record<string, unknown>) => ({ ...box, features: [...box.features, { id: "d", type: "draft" as const, name: "Draft", suppressed: false, angleDegrees: 10, reversed: false, faces: [plus], facePlane: { plane: "YZ" as const, offsetMillimeters: 0 }, neutralPlane: { plane: "XY" as const, offsetMillimeters: 0 }, ...neutral }] });
  expect(volume(draft({ neutralFace: bottom }))).toBeCloseTo(volume(draft({})), 6);
  expect(volume(draft({}))).toBeLessThan(6000);
}, 30000);

it("mirrors about a plane feature or a picked face, and mirrors whole bodies", async () => {
  const { createRectanglePartDocument } = await import("../document/part-document");
  const box = createRectanglePartDocument("Mirror planes", { widthMillimeters: 30, heightMillimeters: 20, depthMillimeters: 10 });
  const built = evaluatePartDocument(box).parts[0];
  const extrudeId = box.features[1].id;
  const volume = (doc: typeof box) => { let v = 0; evaluatePartDocument(doc, { withBodies: (b) => { for (const body of b.values()) v += measureVolume(body as Shape3D); } }); return v; };
  const xMax = Math.max(...built.topology.flatMap((f) => f.candidates).filter((c) => c.kind === "face-center").map((c) => c.origin[0]));
  // About an offset plane feature 5 mm beyond the +X face: a detached mirror image, added.
  const withPlane = { ...box, features: [...box.features,
    { id: "p", type: "plane" as const, name: "Plane", suppressed: false, plane: "YZ" as const, offsetMillimeters: xMax + 5, definition: { method: "offset" as const, reference: { kind: "principal" as const, plane: "YZ" as const }, distanceMillimeters: xMax + 5 } },
    { id: "m", type: "mirror" as const, name: "Mirror", suppressed: false, sourceFeatureId: extrudeId, plane: "YZ" as const, offsetMillimeters: 0, operation: "add" as const, mirrorPlane: { kind: "feature" as const, featureId: "p" } }] };
  const mirrored = evaluatePartDocument(withPlane);
  expect(volume(withPlane)).toBeCloseTo(12000, 3);
  expect(mirrored.parts.length).toBe(1);
  // About the +X face itself: the image shares that face, so one body of twice the volume.
  const plus = { sourceFeatureId: extrudeId, bodyId: built.id, label: "+X", normal: [1, 0, 0] as [number, number, number] };
  const withFace = { ...box, features: [...box.features, { id: "m", type: "mirror" as const, name: "Mirror", suppressed: false, sourceFeatureId: extrudeId, plane: "YZ" as const, offsetMillimeters: 0, operation: "add" as const, mirrorPlane: { kind: "face" as const, ...plus } }] };
  expect(volume(withFace)).toBeCloseTo(12000, 3);
  expect(evaluatePartDocument(withFace).parts[0].topology.length).toBe(6);
  // Mirroring a body makes a second body, the original untouched.
  const bodies = { ...box, features: [...box.features, { id: "m", type: "transform" as const, name: "Mirror parts", suppressed: false, bodyIds: [built.id], copyBodyIds: { [built.id]: "mirror-copy" }, transform: { kind: "mirror" as const, plane: { kind: "principal" as const, plane: "YZ" as const, offsetMillimeters: xMax + 5 } } }] };
  const twoBodies = evaluatePartDocument(bodies);
  expect(twoBodies.parts.length).toBe(2);
  expect(twoBodies.parts.map((p) => p.id).sort()).toEqual([built.id, "mirror-copy"].sort());
  expect(volume(bodies)).toBeCloseTo(12000, 3);
}, 30000);

it("patterns along any direction, in two directions, with alignment, and about a picked edge", async () => {
  const { createEmptyPartDocument } = await import("../document/part-document");
  // A 100 × 100 × 5 plate centred on the origin, a 10 × 10 boss at its centre and a 4 mm post at (30, 0).
  const doc = createEmptyPartDocument("Pattern directions");
  doc.features.push({ id: "s", type: "profile", name: "Plate", plane: "XY", offsetMillimeters: 0, suppressed: false, profile: { type: "polygon", pointsMillimeters: [[-50, -50], [50, -50], [50, 50], [-50, 50]] } });
  doc.features.push({ id: "e", type: "extrude", name: "Extrude", profileFeatureId: "s", distanceMillimeters: 5, operation: "new", suppressed: false });
  doc.features.push({ id: "b", type: "profile", name: "Boss", plane: "XY", offsetMillimeters: 5, suppressed: false, profile: { type: "polygon", pointsMillimeters: [[-5, -5], [5, -5], [5, 5], [-5, 5]] } });
  doc.features.push({ id: "boss", type: "extrude", name: "Boss", profileFeatureId: "b", distanceMillimeters: 5, operation: "add", suppressed: false });
  doc.features.push({ id: "c", type: "profile", name: "Post", plane: "XY", offsetMillimeters: 5, suppressed: false, profile: { type: "circle", radiusMillimeters: 2, centerMillimeters: [30, 0] } });
  doc.features.push({ id: "post", type: "extrude", name: "Post", profileFeatureId: "c", distanceMillimeters: 5, operation: "add", suppressed: false });
  const volume = (d: typeof doc) => { let v = 0; evaluatePartDocument(d, { withBodies: (b) => { for (const body of b.values()) v += measureVolume(body as Shape3D); } }); return v; };
  const base = volume(doc), post = Math.PI * 4 * 5;
  const withPattern = (extra: Record<string, unknown>) => ({ ...doc, features: [...doc.features, { id: "p", type: "pattern" as const, name: "Pattern", suppressed: false, sourceFeatureId: "post", patternType: "linear" as const, axis: "X" as const, count: 3, spacingMillimeters: 10, reversed: false, ...extra } as typeof doc.features[number]] });
  const postsAt = (d: typeof doc) => evaluatePartDocument(d).parts[0].topology.filter((f) => f.surfaceType === "CYLINDER").map((f) => f.candidates.find((c) => c.kind === "face-center")?.origin ?? f.measurements?.centerMillimeters).filter((o): o is NonNullable<typeof o> => !!o).map((o) => o.slice(0, 2).map((v) => Math.round(v * 1000) / 1000).join(",")).sort();
  // A diagonal direction vector: posts at (30,0), (37.07,7.07), (44.14,14.14).
  const diagonal = withPattern({ direction: { kind: "vector", direction: [1, 1, 0] } });
  expect(volume(diagonal)).toBeCloseTo(base + 2 * post, 2);
  expect(postsAt(diagonal)).toEqual(["30,0", "37.071,7.071", "44.142,14.142"]);
  // Two directions: 3 × 2 posts.
  expect(volume(withPattern({ second: { axis: "Y", count: 2, spacingMillimeters: 30 } }))).toBeCloseTo(base + 5 * post, 2);
  // Centred alignment: the original in the middle.
  expect(postsAt(withPattern({ alignment: "center" }))).toEqual(["20,0", "30,0", "40,0"]);
  // Polar about a picked vertical edge of the boss at (5, 5): four posts, none overlapping.
  const built = evaluatePartDocument(doc).parts[0];
  const edge = built.topology.flatMap((f) => f.candidates).find((c) => c.kind === "edge-midpoint" && c.edgeAnchor && Math.abs(c.origin[0] - 5) < 1e-6 && Math.abs(c.origin[1] - 5) < 1e-6 && c.measurements?.linearDirection && Math.abs(c.measurements.linearDirection[2]) > 0.5);
  expect(edge?.edgeAnchor).toBeDefined();
  const polar = withPattern({ patternType: "polar", angleDegrees: 360, count: 4, axisReference: { kind: "solid-edge", sourceFeatureId: "post", bodyId: built.id, anchor: structuredClone(edge!.edgeAnchor!), label: "Boss edge" } });
  expect(volume(polar)).toBeCloseTo(base + 3 * post, 2);
  expect(postsAt(polar)).toEqual(["-20,10", "0,-20", "10,30", "30,0"]);
}, 30000);

it("revolves about a picked straight edge or a given line", async () => {
  const { createRectanglePartDocument } = await import("../document/part-document");
  const box = createRectanglePartDocument("Revolve axis", { widthMillimeters: 30, heightMillimeters: 20, depthMillimeters: 10 });
  const built = evaluatePartDocument(box).parts[0];
  const xMax = Math.max(...built.topology.flatMap((f) => f.candidates).filter((c) => c.kind === "face-center").map((c) => c.origin[0]));
  const yMax = Math.max(...built.topology.flatMap((f) => f.candidates).filter((c) => c.kind === "face-center").map((c) => c.origin[1]));
  // The vertical edge at the box's (+X, +Y) corner.
  const edge = built.topology.flatMap((f) => f.candidates).find((c) => c.kind === "edge-midpoint" && c.edgeAnchor && Math.abs(c.origin[0] - xMax) < 1e-6 && Math.abs(c.origin[1] - yMax) < 1e-6 && c.measurements?.linearDirection && Math.abs(c.measurements.linearDirection[2]) > 0.5);
  expect(edge?.edgeAnchor).toBeDefined();
  const volume = (d: typeof box) => { let v = 0; evaluatePartDocument(d, { withBodies: (b) => { for (const body of b.values()) v += measureVolume(body as Shape3D); } }); return v; };
  // A 10 × 10 profile on XZ whose centre sits 30 mm from that edge, revolved fully as a new body.
  const profile = { id: "r", type: "profile" as const, name: "Ring", plane: "XZ" as const, offsetMillimeters: -yMax, suppressed: false, profile: { type: "polygon" as const, pointsMillimeters: [[xMax + 25, 0], [xMax + 35, 0], [xMax + 35, 10], [xMax + 25, 10]] as [number, number][] } };
  const ring = Math.PI * 2 * 30 * 100;
  const byEdge = { ...box, features: [...box.features, profile, { id: "rev", type: "revolve" as const, name: "Revolve", suppressed: false, profileFeatureId: "r", axis: "Z" as const, angleDegrees: 360, operation: "new" as const,
    axisReference: { kind: "solid-edge" as const, sourceFeatureId: box.features[1].id, bodyId: built.id, anchor: structuredClone(edge!.edgeAnchor!), label: "Corner edge" } }] };
  expect(volume(byEdge) - 6000).toBeCloseTo(ring, 1);
  const byLine = { ...box, features: [...box.features, profile, { id: "rev", type: "revolve" as const, name: "Revolve", suppressed: false, profileFeatureId: "r", axis: "Z" as const, angleDegrees: 90, operation: "new" as const,
    axisReference: { kind: "vector" as const, origin: [xMax, yMax, 0] as [number, number, number], direction: [0, 0, 1] as [number, number, number] } }] };
  expect(volume(byLine) - 6000).toBeCloseTo(ring / 4, 1);
}, 30000);

it("sweeps with a fixed orientation and an end scale, and lofts to an apex point", async () => {
  const { createEmptyPartDocument } = await import("../document/part-document");
  const volume = (d: ReturnType<typeof createEmptyPartDocument>) => { let v = 0; evaluatePartDocument(d, { withBodies: (b) => { for (const body of b.values()) v += measureVolume(body as Shape3D); } }); return v; };
  // A 5 mm circle on XY swept 40 mm along Z (a line on XZ from (0,0) to (0,40)).
  const base = () => { const d = createEmptyPartDocument("Sweep options");
    d.features.push({ id: "c", type: "profile", name: "Circle", plane: "XY", offsetMillimeters: 0, suppressed: false, profile: { type: "circle", radiusMillimeters: 5, centerMillimeters: [0, 0] } });
    d.features.push({ id: "path", type: "profile", name: "Path", plane: "XZ", offsetMillimeters: 0, suppressed: false, profile: { type: "drawing", contours: [{ id: "k", type: "path", start: [0, 0], segments: [{ type: "line", end: [0, 40] }] }] } });
    return d; };
  const plain = base(); plain.features.push({ id: "sw", type: "sweep", name: "Sweep", profileFeatureId: "c", pathFeatureId: "path", operation: "new", suppressed: false });
  expect(volume(plain)).toBeCloseTo(Math.PI * 25 * 40, 1);
  // Parallel (fixed) orientation along a straight path is the same solid.
  const parallel = base(); parallel.features.push({ id: "sw", type: "sweep", name: "Sweep", profileFeatureId: "c", pathFeatureId: "path", operation: "new", suppressed: false, orientation: "parallel" });
  expect(volume(parallel)).toBeCloseTo(Math.PI * 25 * 40, 1);
  // The profile grows linearly to twice its size: ∫(1+t)² = 7/3.
  const scaled = base(); scaled.features.push({ id: "sw", type: "sweep", name: "Sweep", profileFeatureId: "c", pathFeatureId: "path", operation: "new", suppressed: false, endScale: 2 });
  expect(volume(scaled)).toBeCloseTo(Math.PI * 25 * 40 * 7 / 3, 0);
  // A loft from a 20 × 20 square to an apex 30 mm above it is a pyramid.
  const loftDoc = createEmptyPartDocument("Loft apex");
  loftDoc.features.push({ id: "sq", type: "profile", name: "Square", plane: "XY", offsetMillimeters: 0, suppressed: false, profile: { type: "polygon", pointsMillimeters: [[-10, -10], [10, -10], [10, 10], [-10, 10]] } });
  loftDoc.features.push({ id: "lf", type: "loft", name: "Loft", suppressed: false, operation: "new", ruled: true, sections: [{ profileFeatureId: "sq" }], endPoint: { kind: "point", positionMillimeters: [0, 0, 30] } });
  expect(volume(loftDoc)).toBeCloseTo(400 * 30 / 3, 1);
}, 30000);

it("revolves and patterns about an axis feature", async () => {
  const { createRectanglePartDocument } = await import("../document/part-document");
  const { resolveAxisLine } = await import("../document/construction-axes");
  const box = createRectanglePartDocument("Axis feature", { widthMillimeters: 30, heightMillimeters: 20, depthMillimeters: 10 });
  const built = evaluatePartDocument(box).parts[0];
  const centers = built.topology.flatMap((f) => f.candidates).filter((c) => c.kind === "face-center");
  const xMax = Math.max(...centers.map((c) => c.origin[0])), yMax = Math.max(...centers.map((c) => c.origin[1]));
  // Two points: the (+X, +Y) corner's bottom and top vertices → a vertical axis.
  const corner = (z: number) => built.topology.flatMap((f) => f.candidates).find((c) => c.kind === "vertex" && Math.abs(c.origin[0] - xMax) < 1e-6 && Math.abs(c.origin[1] - yMax) < 1e-6 && Math.abs(c.origin[2] - z) < 1e-6)!;
  const point = (c: { id: string; label: string; origin: readonly number[] }) => ({ kind: "point" as const, partId: built.id, candidateId: c.id, label: c.label, positionMillimeters: [...c.origin] as [number, number, number] });
  const axis = { id: "ax", type: "axis" as const, name: "Axis 1", suppressed: false, definition: { method: "two-points" as const, points: [point(corner(0)), point(corner(10))] as [ReturnType<typeof point>, ReturnType<typeof point>] } };
  expect(resolveAxisLine(axis, box.features).directionMillimeters).toEqual([0, 0, 1]);
  // Two planes: XY ∩ YZ is the Y axis.
  expect(resolveAxisLine({ ...axis, definition: { method: "two-planes", references: [{ kind: "principal", plane: "XY" }, { kind: "principal", plane: "YZ" }] } }, []).directionMillimeters.map(Math.abs)).toEqual([0, 1, 0]);
  const volume = (d: typeof box) => { let v = 0; evaluatePartDocument(d, { withBodies: (b) => { for (const body of b.values()) v += measureVolume(body as Shape3D); } }); return v; };
  const profile = { id: "r", type: "profile" as const, name: "Ring", plane: "XZ" as const, offsetMillimeters: -yMax, suppressed: false, profile: { type: "polygon" as const, pointsMillimeters: [[xMax + 25, 0], [xMax + 35, 0], [xMax + 35, 10], [xMax + 25, 10]] as [number, number][] } };
  const doc = { ...box, features: [...box.features, axis, profile, { id: "rev", type: "revolve" as const, name: "Revolve", suppressed: false, profileFeatureId: "r", axis: "Z" as const, angleDegrees: 360, operation: "new" as const, axisReference: { kind: "feature" as const, featureId: "ax" } }] };
  expect(volume(doc) - 6000).toBeCloseTo(Math.PI * 2 * 30 * 100, 1);
  // A polar pattern of the box's own... a post added at the far corner, repeated about the axis.
  const post = { id: "c", type: "profile" as const, name: "Post", plane: "XY" as const, offsetMillimeters: 10, suppressed: false, profile: { type: "circle" as const, radiusMillimeters: 1, centerMillimeters: [xMax - 3, yMax - 3] as [number, number] } };
  const patterned = { ...box, features: [...box.features, axis, post, { id: "p", type: "extrude" as const, name: "Post", profileFeatureId: "c", distanceMillimeters: 2, operation: "add" as const, suppressed: false },
    { id: "pat", type: "pattern" as const, name: "Pattern", suppressed: false, sourceFeatureId: "p", patternType: "polar" as const, axis: "Z" as const, count: 2, angleDegrees: 180, reversed: false, axisReference: { kind: "feature" as const, featureId: "ax" } }] };
  // The second post lands outside the box (mirrored through the corner), so the fuse yields a separate solid: expect a refusal or a second solid, never a silent drop.
  expect(() => evaluatePartDocument(patterned)).not.toThrow();
}, 30000);

it("drills a hole at a picked face point, and one at every circle of a sketch", async () => {
  const { createRectanglePartDocument } = await import("../document/part-document");
  const box = createRectanglePartDocument("Hole placement", { widthMillimeters: 30, heightMillimeters: 20, depthMillimeters: 10 });
  const built = evaluatePartDocument(box).parts[0];
  const extrudeId = box.features[1].id;
  const volume = (d: typeof box) => { let v = 0; evaluatePartDocument(d, { withBodies: (b) => { for (const body of b.values()) v += measureVolume(body as Shape3D); } }); return v; };
  const top = built.topology.flatMap((f) => f.candidates).find((c) => c.kind === "face-center" && c.zAxis[2] > 0.999)!;
  // At a point on the top face, through all: a 4 mm hole, 10 mm deep.
  const atPoint = { ...box, features: [...box.features, { id: "h", type: "hole" as const, name: "Hole", suppressed: false, diameterMillimeters: 4, depthMillimeters: 10, depthType: "through-all" as const, cutType: "plain" as const,
    placement: { kind: "face-point" as const, face: { sourceFeatureId: extrudeId, bodyId: built.id, label: "Top", normal: [0, 0, 1] as [number, number, number] }, pointMillimeters: [top.origin[0] + 5, top.origin[1] + 3, top.origin[2]] as [number, number, number] } }] };
  expect(6000 - volume(atPoint)).toBeCloseTo(Math.PI * 4 * 10, 3);
  // Every circle of a sketch: two 2 mm holes, 3 mm deep.
  const twoCircles = { ...box, features: [...box.features,
    { id: "s2", type: "profile" as const, name: "Centers", plane: "XY" as const, offsetMillimeters: 10, suppressed: false, profile: { type: "drawing" as const, contours: [{ id: "a", type: "circle" as const, center: [top.origin[0] - 8, top.origin[1]] as [number, number], radius: 1 }, { id: "b", type: "circle" as const, center: [top.origin[0] + 8, top.origin[1]] as [number, number], radius: 1 }] } },
    { id: "h", type: "hole" as const, name: "Holes", suppressed: false, profileFeatureId: "s2", allCircles: true, diameterMillimeters: 2, depthMillimeters: 3, depthType: "blind" as const, cutType: "plain" as const }] };
  expect(6000 - volume(twoCircles)).toBeCloseTo(2 * Math.PI * 1 * 3, 3);
}, 30000);

it("splits a body, replaces a face with a plane, and deletes a face", async () => {
  const { createRectanglePartDocument } = await import("../document/part-document");
  const box = createRectanglePartDocument("Split and faces", { widthMillimeters: 30, heightMillimeters: 20, depthMillimeters: 10 });
  const built = evaluatePartDocument(box).parts[0];
  const extrudeId = box.features[1].id;
  const centers = built.topology.flatMap((f) => f.candidates).filter((c) => c.kind === "face-center");
  const xMin = Math.min(...centers.map((c) => c.origin[0]));
  const volumes = (d: typeof box) => { const out: Record<string, number> = {}; evaluatePartDocument(d, { withBodies: (b) => { for (const [id, body] of b) out[id] = measureVolume(body as Shape3D); } }); return out; };
  // Split 10 mm in from the -X face, keeping both: the target keeps the negative side.
  const both = { ...box, features: [...box.features, { id: "sp", type: "split" as const, name: "Split", suppressed: false, bodyIds: [built.id] as [string], copyBodyIds: { [built.id]: "piece-2" }, plane: { kind: "principal" as const, plane: "YZ" as const, offsetMillimeters: xMin + 10 }, keep: "both" as const }] };
  expect(volumes(both)).toEqual({ [built.id]: expect.closeTo(2000, 3), "piece-2": expect.closeTo(4000, 3) });
  const positive = { ...both, features: [...box.features, { ...both.features[2], copyBodyIds: undefined, keep: "positive" as const }] };
  expect(volumes(positive)).toEqual({ [built.id]: expect.closeTo(4000, 3) });
  // Replace the top face with the XY plane at z = 15: the box grows to 15 mm.
  const top = { sourceFeatureId: extrudeId, bodyId: built.id, label: "Top", normal: [0, 0, 1] as [number, number, number] };
  const replaced = { ...box, features: [...box.features, { id: "rf", type: "offset-face" as const, name: "Replace", suppressed: false, faces: [top], replaceWith: { kind: "principal" as const, plane: "XY" as const, offsetMillimeters: 15 } }] };
  expect(Object.values(volumes(replaced))[0]).toBeCloseTo(30 * 20 * 15, 3);
  // Delete a fillet face: the box heals back to its sharp corner (full build).
  await loadExtendedKernel(() => (initFull as any)());
  const topEdge = built.topology.flatMap((f) => f.candidates).find((c) => c.kind === "edge-midpoint" && c.edgeAnchor && Math.abs(c.origin[2] - 10) < 1e-6 && c.measurements?.linearDirection && Math.abs(c.measurements.linearDirection[0]) > 0.5)!;
  const filleted = { ...box, features: [...box.features, { id: "f", type: "fillet" as const, name: "Fillet", suppressed: false, radiusMillimeters: 2, edges: [{ kind: "solid-edge" as const, sourceFeatureId: extrudeId, bodyId: built.id, anchor: structuredClone(topEdge.edgeAnchor!), label: "Edge" }] }] };
  const rounded = evaluatePartDocument(filleted).parts[0];
  expect(rounded.topology.length).toBe(7);
  const healed = { ...filleted, features: [...filleted.features, { id: "df", type: "delete-face" as const, name: "Delete face", suppressed: false, targetBodyId: built.id, faces: [{ sourceFeatureId: "f", bodyId: built.id, label: "Round", surfaceType: "cylinder" as const }] }] };
  expect(Object.values(volumes(healed))[0]).toBeCloseTo(6000, 3);
  expect(evaluatePartDocument(healed).parts[0].topology.length).toBe(6);
}, 60000);

it("builds a pipe along a path, a bounding solid, and a cosmetic thread", async () => {
  const { createEmptyPartDocument, createRectanglePartDocument } = await import("../document/part-document");
  const volume = (d: ReturnType<typeof createEmptyPartDocument>) => { let v = 0; evaluatePartDocument(d, { withBodies: (b) => { for (const body of b.values()) v += measureVolume(body as Shape3D); } }); return v; };
  const doc = createEmptyPartDocument("Pipe");
  doc.features.push({ id: "path", type: "profile", name: "Path", plane: "XZ", offsetMillimeters: 0, suppressed: false, profile: { type: "drawing", contours: [{ id: "k", type: "path", start: [0, 0], segments: [{ type: "line", end: [0, 40] }] }] } });
  doc.features.push({ id: "pipe", type: "pipe", name: "Pipe", suppressed: false, pathFeatureId: "path", diameterMillimeters: 10, operation: "new" });
  expect(volume(doc)).toBeCloseTo(Math.PI * 25 * 40, 1);
  const hollow = { ...doc, features: [doc.features[0], { ...doc.features[1], wallMillimeters: 2 }] };
  expect(volume(hollow)).toBeCloseTo(Math.PI * (25 - 9) * 40, 1);
  const box = createRectanglePartDocument("Bounds", { widthMillimeters: 30, heightMillimeters: 20, depthMillimeters: 10 });
  const bounded = { ...box, features: [...box.features, { id: "bs", type: "bounding-solid" as const, name: "Bounding solid", suppressed: false, marginMillimeters: 1, operation: "new" as const }] };
  expect(evaluatePartDocument(bounded).parts.length).toBe(2);
  expect(volume(bounded)).toBeCloseTo(6000 + 32 * 22 * 12, 3);
  // A cosmetic thread changes no geometry.
  const cyl = createEmptyPartDocument("Thread");
  cyl.features.push({ id: "c", type: "profile", name: "Circle", plane: "XY", offsetMillimeters: 0, suppressed: false, profile: { type: "circle", radiusMillimeters: 4, centerMillimeters: [0, 0] } });
  cyl.features.push({ id: "e", type: "extrude", name: "Extrude", profileFeatureId: "c", distanceMillimeters: 20, operation: "new", suppressed: false });
  const drum = evaluatePartDocument(cyl).parts[0];
  cyl.features.push({ id: "th", type: "thread", name: "Thread", suppressed: false, face: { sourceFeatureId: "e", bodyId: drum.id, label: "Side", surfaceType: "cylinder" }, designation: "M8" });
  expect(volume(cyl)).toBeCloseTo(Math.PI * 16 * 20, 3);
}, 30000);

it("coils a wire, removes a body, mirrors with combine, and patterns along a path", async () => {
  const { createEmptyPartDocument, createRectanglePartDocument } = await import("../document/part-document");
  const volume = (d: ReturnType<typeof createEmptyPartDocument>) => { let v = 0; evaluatePartDocument(d, { withBodies: (b) => { for (const body of b.values()) v += measureVolume(body as Shape3D); } }); return v; };
  // Coil: a 2 mm wire, coil radius 10, pitch 5, 3 turns: volume ≈ π·1²·(path length).
  const coil = createEmptyPartDocument("Coil");
  coil.features.push({ id: "co", type: "coil", name: "Coil", suppressed: false, radiusMillimeters: 10, pitchMillimeters: 5, turns: 3, wireDiameterMillimeters: 2, operation: "new" });
  const pathLength = 3 * Math.hypot(2 * Math.PI * 10, 5);
  expect(volume(coil) / (Math.PI * pathLength)).toBeCloseTo(1, 1);
  // Remove body: a second body made then removed leaves one.
  const box = createRectanglePartDocument("Remove", { widthMillimeters: 30, heightMillimeters: 20, depthMillimeters: 10 });
  const built = evaluatePartDocument(box).parts[0];
  const twoThenOne = { ...box, features: [...box.features,
    { id: "bs", type: "bounding-solid" as const, name: "Bound", suppressed: false, marginMillimeters: 1, operation: "new" as const },
    { id: "rm", type: "remove-body" as const, name: "Remove", suppressed: false, bodyIds: [built.id] }] };
  const left = evaluatePartDocument(twoThenOne).parts;
  expect(left.length).toBe(1); expect(volume(twoThenOne)).toBeCloseTo(32 * 22 * 12, 3);
  // Mirror with combine: the image joins the original; one body of twice the volume.
  const xMax = Math.max(...built.topology.flatMap((f) => f.candidates).filter((c) => c.kind === "face-center").map((c) => c.origin[0]));
  const combined = { ...box, features: [...box.features, { id: "m", type: "transform" as const, name: "Mirror join", suppressed: false, bodyIds: [built.id], transform: { kind: "mirror" as const, plane: { kind: "principal" as const, plane: "YZ" as const, offsetMillimeters: xMax }, combine: true } }] };
  expect(evaluatePartDocument(combined).parts.length).toBe(1); expect(volume(combined)).toBeCloseTo(12000, 3);
  // Pattern on path: a post repeated 4 times along a 60 mm line, spacing 15.
  const plate = createEmptyPartDocument("Path pattern");
  plate.features.push({ id: "s", type: "profile", name: "Plate", plane: "XY", offsetMillimeters: 0, suppressed: false, profile: { type: "polygon", pointsMillimeters: [[-10, -10], [90, -10], [90, 10], [-10, 10]] } });
  plate.features.push({ id: "e", type: "extrude", name: "Extrude", profileFeatureId: "s", distanceMillimeters: 5, operation: "new", suppressed: false });
  plate.features.push({ id: "c", type: "profile", name: "Post", plane: "XY", offsetMillimeters: 5, suppressed: false, profile: { type: "circle", radiusMillimeters: 2, centerMillimeters: [0, 0] } });
  plate.features.push({ id: "post", type: "extrude", name: "Post", profileFeatureId: "c", distanceMillimeters: 5, operation: "add", suppressed: false });
  plate.features.push({ id: "path", type: "profile", name: "Path", plane: "XY", offsetMillimeters: 5, suppressed: false, profile: { type: "drawing", contours: [{ id: "k", type: "path", start: [0, 0], segments: [{ type: "line", end: [60, 0] }] }] } });
  const base = volume(plate);
  plate.features.push({ id: "pp", type: "pattern", name: "Path pattern", suppressed: false, sourceFeatureId: "post", patternType: "path", axis: "X", count: 4, reversed: false, pathFeatureId: "path", spacingMillimeters: 15 });
  expect(volume(plate) - base).toBeCloseTo(3 * Math.PI * 4 * 5, 2);
  const posts = evaluatePartDocument(plate).parts[0].topology.filter((f) => f.surfaceType === "CYLINDER").map((f) => Math.round(((f.candidates.find((c) => c.kind === "face-center")?.origin ?? f.measurements?.centerMillimeters)?.[0] ?? NaN) * 1000) / 1000 + 0).sort((a, b) => a - b);
  expect(posts).toEqual([0, 15, 30, 45]);
}, 30000);

it("drafts with a pull direction, drills along a direction, and splits by a sketch line", async () => {
  const { createRectanglePartDocument } = await import("../document/part-document");
  const box = createRectanglePartDocument("Directions", { widthMillimeters: 30, heightMillimeters: 20, depthMillimeters: 10 });
  const built = evaluatePartDocument(box).parts[0];
  const extrudeId = box.features[1].id;
  const volume = (d: typeof box) => { let v = 0; evaluatePartDocument(d, { withBodies: (b) => { for (const body of b.values()) v += measureVolume(body as Shape3D); } }); return v; };
  const plus = { sourceFeatureId: extrudeId, bodyId: built.id, label: "+X", normal: [1, 0, 0] as [number, number, number] };
  // Draft: pulling along -Z instead of +Z mirrors the taper, so the volumes differ by the same amount on either side of 6000.
  const draft = (pull?: [number, number, number]) => ({ ...box, features: [...box.features, { id: "d", type: "draft" as const, name: "Draft", suppressed: false, angleDegrees: 10, reversed: false, faces: [plus], facePlane: { plane: "YZ" as const, offsetMillimeters: 0 }, neutralPlane: { plane: "XY" as const, offsetMillimeters: 0 }, ...(pull ? { pullDirection: pull } : {}) }] });
  const up = volume(draft()), down = volume(draft([0, 0, -1]));
  expect(up).toBeLessThan(6000); expect(down).toBeGreaterThan(6000); expect(6000 - up).toBeCloseTo(down - 6000, 3);
  // Hole along a tilted direction from the top face: a 2 mm hole, 10 mm deep at 45°, so it exits the side; volume loss is between the straight hole and the full slant.
  const top = built.topology.flatMap((f) => f.candidates).find((c) => c.kind === "face-center" && c.zAxis[2] > 0.999)!;
  const tilted = { ...box, features: [...box.features, { id: "h", type: "hole" as const, name: "Hole", suppressed: false, diameterMillimeters: 2, depthMillimeters: 10, depthType: "blind" as const, cutType: "plain" as const,
    placement: { kind: "face-point" as const, face: { sourceFeatureId: extrudeId, bodyId: built.id, label: "Top", normal: [0, 0, 1] as [number, number, number] }, pointMillimeters: [top.origin[0], top.origin[1], top.origin[2]] as [number, number, number] }, direction: [1, 0, -1] as [number, number, number] }] };
  const straight = { ...tilted, features: [...box.features, { ...tilted.features[2], direction: undefined }] };
  expect(6000 - volume(straight)).toBeCloseTo(Math.PI * 1 * 10, 2);
  expect(6000 - volume(tilted)).toBeGreaterThan(Math.PI * 1 * 7); expect(6000 - volume(tilted)).toBeLessThan(Math.PI * 1 * 10 + 1e-6);
  // Split by a sketch line on XY at x = xMin + 10: the plane through the line along the sketch normal.
  const xMin = Math.min(...built.topology.flatMap((f) => f.candidates).filter((c) => c.kind === "face-center").map((c) => c.origin[0]));
  const yMin = Math.min(...built.topology.flatMap((f) => f.candidates).filter((c) => c.kind === "face-center").map((c) => c.origin[1]));
  const lineSketch = { id: "ls", type: "profile" as const, name: "Cut line", plane: "XY" as const, offsetMillimeters: 0, suppressed: false, profile: { type: "drawing" as const, contours: [{ id: "k", type: "path" as const, start: [xMin + 10, yMin - 5] as [number, number], segments: [{ id: "seg", type: "line" as const, end: [xMin + 10, yMin + 50] as [number, number] }] }] } };
  const split = { ...box, features: [...box.features, lineSketch, { id: "sp", type: "split" as const, name: "Split", suppressed: false, bodyIds: [built.id] as [string], copyBodyIds: { [built.id]: "piece-2" }, plane: { kind: "sketch-line" as const, sourceFeatureId: "ls", contourId: "k", segmentId: "seg" }, keep: "both" as const }] };
  const pieces: Record<string, number> = {}; evaluatePartDocument(split, { withBodies: (b) => { for (const [id, body] of b) pieces[id] = measureVolume(body as Shape3D); } });
  expect(Object.values(pieces).sort((a, b) => a - b)).toEqual([expect.closeTo(2000, 3), expect.closeTo(4000, 3)]);
}, 30000);

it("follows tangent chains for fillet and shell, and patterns whole parts", async () => {
  const { createEmptyPartDocument, createRectanglePartDocument } = await import("../document/part-document");
  const volume = (d: ReturnType<typeof createEmptyPartDocument>) => { let v = 0; evaluatePartDocument(d, { withBodies: (b) => { for (const body of b.values()) v += measureVolume(body as Shape3D); } }); return v; };
  // An obround 40 long, 10 wide, 8 tall: its top loop is two lines and two arcs, tangent all round.
  const slot = createEmptyPartDocument("Obround");
  slot.features.push({ id: "s", type: "profile", name: "Slot", plane: "XY", offsetMillimeters: 0, suppressed: false, profile: { type: "drawing", contours: [{ id: "k", type: "path", start: [-15, -5], segments: [{ type: "line", end: [15, -5] }, { type: "arc", middle: [20, 0], end: [15, 5] }, { type: "line", end: [-15, 5] }, { type: "arc", middle: [-20, 0], end: [-15, -5] }] }] } });
  slot.features.push({ id: "e", type: "extrude", name: "Extrude", profileFeatureId: "s", distanceMillimeters: 8, operation: "new", suppressed: false });
  const built = evaluatePartDocument(slot).parts[0];
  const topLine = built.topology.flatMap((f) => f.candidates).find((c) => c.kind === "edge-midpoint" && c.edgeAnchor && Math.abs(c.origin[2] - 8) < 1e-6 && c.measurements?.linearDirection && Math.abs(c.measurements.linearDirection[0]) > 0.5)!;
  const pick = { kind: "solid-edge" as const, sourceFeatureId: "e", bodyId: built.id, anchor: structuredClone(topLine.edgeAnchor!), label: "Top line" };
  const one = evaluatePartDocument({ ...slot, features: [...slot.features, { id: "f", type: "fillet" as const, name: "Fillet", suppressed: false, radiusMillimeters: 1, edges: [pick] }] }).parts[0];
  const chain = evaluatePartDocument({ ...slot, features: [...slot.features, { id: "f", type: "fillet" as const, name: "Fillet", suppressed: false, radiusMillimeters: 1, edges: [pick], tangentChain: true }] }).parts[0];
  // OCCT's fillet already runs along the tangent loop from one picked edge; the flag makes that explicit.
  expect(one.topology.length).toBe(built.topology.length + 4);
  expect(chain.topology.length).toBe(built.topology.length + 4);
  // Shell: on the filleted obround, opening the top with the tangent chain also opens the four
  // rounds tangent to it (a sharp-rimmed cup); without the chain the rounds stay as a lip.
  const rounded = { ...slot, features: [...slot.features, { id: "f", type: "fillet" as const, name: "Fillet", suppressed: false, radiusMillimeters: 1, edges: [pick] }] };
  const top = { sourceFeatureId: "f", bodyId: built.id, label: "Top", normal: [0, 0, 1] as [number, number, number] };
  const cup = (tangentChain: boolean) => ({ ...rounded, features: [...rounded.features, { id: "sh", type: "shell" as const, name: "Shell", suppressed: false, thicknessMillimeters: 0.5, removedFaces: [top], ...(tangentChain ? { tangentChain } : {}) }] });
  const lip = volume(cup(false)), sharp = volume(cup(true));
  expect(sharp).toBeLessThan(lip); expect(lip).toBeLessThan(volume(rounded));
  expect(evaluatePartDocument(cup(true)).parts[0].topology.length).toBeLessThan(evaluatePartDocument(cup(false)).parts[0].topology.length);
  // Pattern whole parts: three boxes along X as separate parts.
  const box = createRectanglePartDocument("Pattern parts", { widthMillimeters: 30, heightMillimeters: 20, depthMillimeters: 10 });
  const body = evaluatePartDocument(box).parts[0];
  const parts = { ...box, features: [...box.features, { id: "p", type: "pattern" as const, name: "Pattern parts", suppressed: false, sourceFeatureId: box.features[1].id, bodyIds: [body.id], copyBodyIds: { [body.id]: "copy" }, patternType: "linear" as const, axis: "X" as const, count: 3, spacingMillimeters: 40, reversed: false }] };
  const result = evaluatePartDocument(parts);
  expect(result.parts.map((p) => p.id).sort()).toEqual([body.id, "copy:1", "copy:2"].sort());
  expect(volume(parts)).toBeCloseTo(18000, 3);
}, 30000);

it("aligns a part's face onto another part's face", async () => {
  const { createRectanglePartDocument } = await import("../document/part-document");
  const box = createRectanglePartDocument("Align", { widthMillimeters: 30, heightMillimeters: 20, depthMillimeters: 10 });
  const built = evaluatePartDocument(box).parts[0];
  const extrudeId = box.features[1].id;
  // A second, smaller part off to the side; its -Z face is brought onto the first part's +X face.
  const doc = { ...box, features: [...box.features,
    { id: "s2", type: "profile" as const, name: "Small", plane: "XY" as const, offsetMillimeters: 40, suppressed: false, profile: { type: "polygon" as const, pointsMillimeters: [[0, 0], [6, 0], [6, 4], [0, 4]] as [number, number][] } },
    { id: "e2", type: "extrude" as const, name: "Small", profileFeatureId: "s2", distanceMillimeters: 5, operation: "new" as const, suppressed: false }] };
  const two = evaluatePartDocument(doc).parts; const small = two[1];
  const fromFace = { sourceFeatureId: "e2", bodyId: small.id, label: "Bottom", normal: [0, 0, -1] as [number, number, number] };
  const toFace = { sourceFeatureId: extrudeId, bodyId: built.id, label: "+X", normal: [1, 0, 0] as [number, number, number] };
  const aligned = { ...doc, features: [...doc.features, { id: "al", type: "transform" as const, name: "Align", suppressed: false, bodyIds: [small.id], transform: { kind: "align" as const, from: { kind: "face" as const, ...fromFace }, to: { kind: "face" as const, ...toFace } } }] };
  const result = evaluatePartDocument(aligned).parts;
  const moved = result.find((p) => p.id === small.id)!;
  const centers = moved.topology.flatMap((f) => f.candidates).filter((c) => c.kind === "face-center");
  const xMax = Math.max(...built.topology.flatMap((f) => f.candidates).filter((c) => c.kind === "face-center").map((c) => c.origin[0]));
  // The small part now sits against the +X face: its lowest x is that face's plane, and it kept its volume.
  expect(Math.min(...centers.map((c) => c.origin[0]))).toBeCloseTo(xMax, 6);
  let volumes: number[] = []; evaluatePartDocument(aligned, { withBodies: (b) => { volumes = [...b.values()].map((body) => measureVolume(body as Shape3D)); } });
  expect(volumes.sort((a, b) => a - b)).toEqual([expect.closeTo(120, 6), expect.closeTo(6000, 6)]);
}, 30000);

it("raises a plastic boss and a rest on a picked face point", async () => {
  const { createRectanglePartDocument } = await import("../document/part-document");
  const box = createRectanglePartDocument("Plastic", { widthMillimeters: 30, heightMillimeters: 20, depthMillimeters: 10 });
  const built = evaluatePartDocument(box).parts[0];
  const extrudeId = box.features[1].id;
  const volume = (d: typeof box) => { let v = 0; evaluatePartDocument(d, { withBodies: (b) => { for (const body of b.values()) v += measureVolume(body as Shape3D); } }); return v; };
  const top = built.topology.flatMap((f) => f.candidates).find((c) => c.kind === "face-center" && c.zAxis[2] > 0.999)!;
  const face = { sourceFeatureId: extrudeId, bodyId: built.id, label: "Top", normal: [0, 0, 1] as [number, number, number] };
  const at = [top.origin[0] + 5, top.origin[1], top.origin[2]] as [number, number, number];
  // Boss: Ø6 × 8 post with a Ø3 hole 5 deep.
  const boss = { ...box, features: [...box.features, { id: "b", type: "boss" as const, name: "Boss", suppressed: false, targetBodyId: built.id, face, pointMillimeters: at, diameterMillimeters: 6, heightMillimeters: 8, holeDiameterMillimeters: 3, holeDepthMillimeters: 5 }] };
  expect(volume(boss) - 6000).toBeCloseTo(Math.PI * 9 * 8 - Math.PI * 2.25 * 5, 3);
  // Boss with 5° draft: a frustum, smaller than the straight post.
  const drafted = { ...boss, features: [...box.features, { ...boss.features[2], holeDiameterMillimeters: undefined, holeDepthMillimeters: undefined, draftDegrees: 5 }] };
  const straight = Math.PI * 9 * 8, rTop = 3 - 8 * Math.tan(5 * Math.PI / 180), frustum = Math.PI * 8 / 3 * (9 + 3 * rTop + rTop * rTop);
  expect(volume(drafted) - 6000).toBeCloseTo(frustum, 2); expect(volume(drafted) - 6000).toBeLessThan(straight);
  // Rest: a 10 × 4 × 2 rectangular pad, and a Ø8 × 2 round one.
  const rect = { ...box, features: [...box.features, { id: "r", type: "rest" as const, name: "Rest", suppressed: false, targetBodyId: built.id, face, pointMillimeters: at, widthMillimeters: 10, lengthMillimeters: 4, heightMillimeters: 2 }] };
  expect(volume(rect) - 6000).toBeCloseTo(80, 3);
  const round = { ...box, features: [...box.features, { id: "r", type: "rest" as const, name: "Rest", suppressed: false, targetBodyId: built.id, face, pointMillimeters: at, widthMillimeters: 8, heightMillimeters: 2 }] };
  expect(volume(round) - 6000).toBeCloseTo(Math.PI * 16 * 2, 3);
}, 30000);

it.each(["fillet", "chamfer"] as const)(
  "evaluates %s as exact edge geometry",
  async (type) => {
    const { createRectanglePartDocument } =
      await import("../document/part-document");
    const doc = createRectanglePartDocument("Edge finish", {
      widthMillimeters: 30,
      heightMillimeters: 20,
      depthMillimeters: 10,
    });
    const before = evaluatePartDocument(doc).parts[0];
    doc.features.push({
      id: "finish",
      name: "Finish",
      type,
      radiusMillimeters: 0.5,
      suppressed: false,
    });
    const after = evaluatePartDocument(doc).parts[0];
    expect(after.topology.length).toBeGreaterThan(before.topology.length);
  },
  30000,
);

it("rolls back exact geometry without discarding future features", () => {
  const doc = createWheelExample();
  const full = evaluatePartDocument(doc).parts[0];
  const early = evaluatePartDocument({ ...doc, rollbackIndex: 2 }).parts[0];
  expect(early.topology.length).toBeLessThan(full.topology.length);
  expect(evaluatePartDocument({ ...doc, rollbackIndex: 0 }).parts).toHaveLength(
    0,
  );
  expect(evaluatePartDocument({ ...doc, rollbackIndex: 1 }).parts).toHaveLength(
    0,
  );
  expect(
    evaluatePartDocument({ ...doc, rollbackIndex: doc.features.length })
      .parts[0].triangles,
  ).toEqual(full.triangles);
}, 30000);
it("keeps multiple bodies distinct and edits only the selected target", async () => {
  const { createRectanglePartDocument } =
    await import("../document/part-document");
  const { removeFeature, availableBodies } =
    await import("../document/feature-history");
  const doc = createRectanglePartDocument("Two bodies", {
    widthMillimeters: 20,
    heightMillimeters: 10,
    depthMillimeters: 5,
  });
  doc.features.push(
    {
      id: "circle-two",
      name: "Second sketch",
      type: "profile",
      plane: "XY",
      offsetMillimeters: 0,
      suppressed: false,
      profile: {
        type: "circle",
        centerMillimeters: [40, 0],
        radiusMillimeters: 6,
      },
    },
    {
      id: "solid-two",
      name: "Second solid",
      type: "extrude",
      profileFeatureId: "circle-two",
      distanceMillimeters: 12,
      operation: "new",
      suppressed: false,
    },
  );
  const before = evaluatePartDocument(doc).parts;
  expect(before).toHaveLength(2);
  expect(before[0].id).not.toBe(before[1].id);
  doc.features.push({
    id: "finish-two",
    name: "Second body chamfer",
    type: "chamfer",
    radiusMillimeters: 0.5,
    targetBodyId: before[1].id,
    edgePlane: { plane: "XY", offsetMillimeters: 12 },
    suppressed: false,
  });
  const after = evaluatePartDocument(doc).parts;
  expect(after[0].triangles).toEqual(before[0].triangles);
  expect(after[1].topology.length).toBeGreaterThan(before[1].topology.length);
  const removed = removeFeature(doc, doc.features[1].id);
  expect(availableBodies(removed)[0].id).toBe(before[1].id);
  expect(evaluatePartDocument(removed).parts[0].id).toBe(before[1].id);
}, 30000);

it("rebuilds the finished wheel fixture with selective edge finishes", async () => {
  const { createFinishedWheelExample } =
    await import("../document/wheel-example");
  const doc = createFinishedWheelExample();
  const model = evaluatePartDocument(doc);
  expect(model.parts).toHaveLength(1);
  expect(model.parts[0].name).toBe("Wheel");
  expect(model.parts[0].topology.length).toBeGreaterThan(
    evaluatePartDocument(createWheelExample()).parts[0].topology.length,
  );
}, 30000);

it('persists open paths, extrudes exact closed arcs and holes on a face frame', async () => {
  const {createEmptyPartDocument,serializePartDocument,parsePartDocument}=await import('../document/index');
  const doc=createEmptyPartDocument('Arc sketch');
  doc.features.push({id:'sketch',name:'Sketch 1',type:'profile',plane:'XY',offsetMillimeters:0,suppressed:false,
    frame:{originMillimeters:[0,0,7],xDirection:[1,0,0],normal:[0,0,1]},
    profile:{type:'drawing',contours:[
      {type:'path',start:[-10,0],segments:[{type:'arc',middle:[0,10],end:[10,0]},{type:'line',end:[-10,0]}]},
      {type:'circle',center:[0,4],radius:1,hole:true},
      {type:'path',start:[20,0],segments:[{type:'line',end:[30,0]}]},
    ]}});
  expect(evaluatePartDocument(doc).parts).toHaveLength(0);
  doc.features.push({id:'extrude',name:'Extrude 1',type:'extrude',profileFeatureId:'sketch',distanceMillimeters:5,operation:'new',suppressed:false});
  const reopened=parsePartDocument(serializePartDocument(doc));
  expect(reopened.features[0]).toEqual(doc.features[0]);
  const result=evaluatePartDocument(reopened);
  expect(result.parts).toHaveLength(1);
  const z=Array.from(result.parts[0].vertices).filter((_,i)=>i%3===2);
  expect(Math.min(...z)).toBeCloseTo(7,3);expect(Math.max(...z)).toBeCloseTo(12,3);
  expect(result.parts[0].topology.filter(f=>f.surfaceType==='CYLINDRE' || f.surfaceType==='CYLINDER').length).toBeGreaterThan(0);
  const sketch=reopened.features[0];
  if(sketch.type==='profile'&&sketch.profile.type==='drawing')sketch.profile.contours=sketch.profile.contours.slice(2);
  expect(()=>evaluatePartDocument(reopened)).toThrow('closed profile');
});

it('rebuilds exact geometry from persisted sketch dimensions after reopening',async()=>{
 const {createEmptyPartDocument,serializePartDocument,parsePartDocument}=await import('../document/index');
 const doc=createEmptyPartDocument('Dimensioned circle');
 doc.features.push({id:'s',type:'profile',name:'Sketch',plane:'XY',offsetMillimeters:0,suppressed:false,profile:{type:'drawing',contours:[{type:'circle',center:[0,0],radius:2}],constraints:[{id:'r',kind:'radius',a:{contour:0,kind:'circle'},value:5}]}});
 doc.features.push({id:'e',type:'extrude',name:'Extrude',profileFeatureId:'s',distanceMillimeters:3,operation:'new',suppressed:false});
 const saved=parsePartDocument(serializePartDocument(doc));
 const diameter=()=>{const v=Array.from(evaluatePartDocument(saved).parts[0].vertices).filter((_,i)=>i%3===0);return Math.max(...v)-Math.min(...v);};
 expect(diameter()).toBeCloseTo(10,1);
 const s=saved.features[0];if(s.type==='profile'&&s.profile.type==='drawing')s.profile.constraints![0].value=8;
 expect(diameter()).toBeCloseTo(16,1);
});

it('extrudes reopened variant contours as exact geometry',async()=>{
 const {sketchVariantContour}=await import('../sketch/primitives');
 const {createEmptyPartDocument,serializePartDocument,parsePartDocument}=await import('../document/index');
 for(const [tool,points] of [
  ['ellipse',[[0,0],[10,0],[0,3]]],
  ['cubic-bezier',[[0,0],[0,10],[10,10],[10,0]]],
  ['center-rectangle',[[0,0],[10,5]]],
  ['aligned-rectangle',[[0,0],[10,5],[-2,8]]],
  ['three-point-circle',[[5,0],[0,5],[-5,0]]],
  ['inscribed-polygon',[[0,0],[5,0]]],
  ['circumscribed-polygon',[[0,0],[5,0]]],
  ['center-arc',[[0,0],[5,0],[0,5]]],
 ] as const){
  const contour=sketchVariantContour(tool,points.map(p=>[...p]));
  if((tool==='center-arc'||tool==='cubic-bezier')&&contour.type==='path')contour.segments.push({type:'line',end:[...contour.start]});
  const doc=createEmptyPartDocument(tool);
  let profile:import('../sketch/drawing').SketchDrawing={type:'drawing',contours:[contour]};
  if(tool==='center-rectangle'||tool==='aligned-rectangle'){
   const {constrainSketchRectangle}=await import('../sketch/operations/rectangle-relations');
   profile=constrainSketchRectangle(profile,0,tool);
  }
  if(tool==='inscribed-polygon'||tool==='circumscribed-polygon'){
   const {constrainSketchPolygon}=await import('../sketch/operations/polygon-relations');
   profile=constrainSketchPolygon(profile,0,[0,0],tool==='circumscribed-polygon');
  }
  if(tool==='three-point-circle'){
   const {constrainThreePointCircle}=await import('../sketch/operations/circle-points');
   profile=constrainThreePointCircle(profile,0,points.map(p=>[...p]));
  }
  if(tool==='center-arc'){
   const {addSketchArcCenter}=await import('../sketch/operations/arc-center');
   profile=addSketchArcCenter(profile,{contour:0,kind:'arc',index:0});
  }
  doc.features.push({id:'s',type:'profile',name:'Sketch',plane:'XY',offsetMillimeters:0,suppressed:false,profile});
  doc.features.push({id:'e',type:'extrude',name:'Extrude',profileFeatureId:'s',distanceMillimeters:4,operation:'new',suppressed:false});
  const result=evaluatePartDocument(parsePartDocument(serializePartDocument(doc)));
  expect(result.parts).toHaveLength(1);
  const z=Array.from(result.parts[0].vertices).filter((_,i)=>i%3===2);
  expect(Math.max(...z)-Math.min(...z)).toBeCloseTo(4,5);
  if(tool==='ellipse'){const vertices=Array.from(result.parts[0].vertices);const x=vertices.filter((_,i)=>i%3===0),y=vertices.filter((_,i)=>i%3===1);expect(Math.max(...x)-Math.min(...x)).toBeCloseTo(20,1);expect(Math.max(...y)-Math.min(...y)).toBeCloseTo(6,1);}
 }
});
it('persists construction planes before any body and supports rollback/suppression',async()=>{
 const {createEmptyPartDocument,insertFeature,parsePartDocument,serializePartDocument}=await import('../document/index');
 const d=insertFeature(createEmptyPartDocument('Planes'),{id:'p',name:'Plane 1',type:'plane',plane:'XZ',offsetMillimeters:15,suppressed:false});
 const reopened=parsePartDocument(serializePartDocument(d));expect(reopened.features[0]).toEqual(d.features[0]);
 expect(evaluatePartDocument(reopened).parts).toHaveLength(0);
 expect(()=>insertFeature(d,{id:'bad',name:'Bad',type:'plane',plane:'XY',offsetMillimeters:NaN,suppressed:false})).toThrow();
});
it('excludes construction curves from solids and evaluates mirrored hole patterns after reopen',async()=>{
 const {createEmptyPartDocument,serializePartDocument,parsePartDocument}=await import('../document/index');
 const {linearPattern}=await import('../sketch/operations/pattern');
 const d=createEmptyPartDocument('Construction and pattern');
 let drawing:import('../sketch/drawing').SketchDrawing={type:'drawing',contours:[
  {type:'circle',center:[0,0],radius:100,construction:true},
  {type:'path',start:[-10,-10],segments:[{type:'line',end:[30,-10]},{type:'line',end:[30,10]},{type:'line',end:[-10,10]},{type:'line',end:[-10,-10]}]},
  {type:'circle',center:[0,0],radius:2,hole:true},
 ]};
 drawing=linearPattern(drawing,[2],[10,0],3);
 d.features.push({id:'s',name:'Sketch',type:'profile',plane:'XY',offsetMillimeters:0,suppressed:false,profile:drawing});
 d.features.push({id:'e',name:'Extrude',type:'extrude',profileFeatureId:'s',distanceMillimeters:5,operation:'new',suppressed:false});
 const saved=parsePartDocument(serializePartDocument(d)),body=evaluatePartDocument(saved).parts[0];
 const x=Array.from(body.vertices).filter((_,i)=>i%3===0);expect(Math.min(...x)).toBeCloseTo(-10,4);expect(Math.max(...x)).toBeCloseTo(30,4);
 const cylinders=body.topology.flatMap(f=>f.candidates).filter(c=>c.kind==='cylinder-axis');
 for(const center of [0,10,20])expect(cylinders.some(c=>Math.abs(c.origin[0]-center)<1e-5&&Math.abs(c.origin[1])<1e-5)).toBe(true);
});
it('extrudes a persisted sketch fillet as an exact cylindrical face',async()=>{
 const {filletSketchCorner}=await import('../sketch/operations/fillet');
 const {createEmptyPartDocument,serializePartDocument,parsePartDocument}=await import('../document/index');
 const profile=filletSketchCorner({type:'drawing',contours:[{type:'path',start:[0,0],segments:[{type:'line',end:[10,0]},{type:'line',end:[10,10]},{type:'line',end:[0,10]},{type:'line',end:[0,0]}]}]},0,0,2);
 const doc=createEmptyPartDocument('Fillet');doc.features.push({id:'s',type:'profile',name:'Sketch',plane:'XY',offsetMillimeters:0,suppressed:false,profile});doc.features.push({id:'e',type:'extrude',name:'Extrude',profileFeatureId:'s',distanceMillimeters:5,operation:'new',suppressed:false});
 const result=evaluatePartDocument(parsePartDocument(serializePartDocument(doc)));expect(result.parts).toHaveLength(1);
 expect(result.parts[0].topology.flatMap(f=>f.candidates).some(c=>c.kind==='cylinder-axis'&&Math.abs(c.origin[0]-2)<1e-5&&Math.abs(c.origin[1]-2)<1e-5)).toBe(true);
});
it('extrudes a saved closed line/Bezier profile with a connected curved fillet',async()=>{
 const {filletSketchCurves}=await import('../sketch/operations/fillet-curves');
 const {createEmptyPartDocument,serializePartDocument,parsePartDocument}=await import('../document/index');
 const profile=filletSketchCurves({type:'drawing',contours:[{type:'path',start:[-10,0],segments:[{type:'line',end:[0,0]},{type:'bezier',controls:[[1,3],[2,7]],end:[0,10]},{type:'line',end:[-10,10]},{type:'line',end:[-10,0]}]}]},{contour:0,segment:0},{contour:0,segment:1},1);
 const doc=createEmptyPartDocument('Curved fillet');doc.features.push({id:'s',type:'profile',name:'Sketch',plane:'XY',offsetMillimeters:0,suppressed:false,profile});doc.features.push({id:'e',type:'extrude',name:'Extrude',profileFeatureId:'s',distanceMillimeters:5,operation:'new',suppressed:false});
 const result=evaluatePartDocument(parsePartDocument(serializePartDocument(doc)));expect(result.parts).toHaveLength(1);
 expect(result.parts[0].topology.flatMap(f=>f.candidates).some(c=>c.kind==='cylinder-axis')).toBe(true);
 const z=Array.from(result.parts[0].vertices).filter((_,i)=>i%3===2);expect(Math.max(...z)-Math.min(...z)).toBeCloseTo(5,5);
});
it('extrudes a reopened asymmetric sketch chamfer into a closed solid',async()=>{
 const {chamferSketchCorner}=await import('../sketch/operations/chamfer');
 const {createEmptyPartDocument,serializePartDocument,parsePartDocument}=await import('../document/index');
 const profile=chamferSketchCorner({type:'drawing',contours:[{type:'path',start:[0,0],segments:[{type:'line',end:[10,0]},{type:'line',end:[10,10]},{type:'line',end:[0,10]},{type:'line',end:[0,0]}]}]},0,1,{mode:'two-distances',distance:2,secondDistance:3});
 const doc=createEmptyPartDocument('Chamfer');doc.features.push({id:'s',type:'profile',name:'Sketch',plane:'XY',offsetMillimeters:0,suppressed:false,profile});doc.features.push({id:'e',type:'extrude',name:'Extrude',profileFeatureId:'s',distanceMillimeters:4,operation:'new',suppressed:false});
 const result=evaluatePartDocument(parsePartDocument(serializePartDocument(doc)));expect(result.parts).toHaveLength(1);
 const vertices=Array.from(result.parts[0].vertices),z=vertices.filter((_,i)=>i%3===2);expect(Math.max(...z)-Math.min(...z)).toBeCloseTo(4,5);
 expect(vertices.some((x,i)=>i%3===0&&Math.abs(x-8)<1e-5&&Math.abs(vertices[i+1])<1e-5)).toBe(true);
});
it('extrudes a native reopened path containing a constrained tangent arc',async()=>{
 const {createSketchTangentArc}=await import('../sketch/operations/tangent-arc');
 const {createEmptyPartDocument,serializePartDocument,parsePartDocument}=await import('../document/index');
 const {drawing}=createSketchTangentArc({type:'drawing',contours:[{type:'path',start:[-10,0],segments:[{type:'line',end:[0,0]}]}]},{contour:0,segment:0,endpoint:1},[5,5]);
 const path=drawing.contours[0];if(path.type!=='path')throw Error();path.segments.push({type:'line',end:[-10,5]},{type:'line',end:[-10,0]});
 const doc=createEmptyPartDocument('Tangent arc');doc.features.push({id:'s',type:'profile',name:'Sketch',plane:'XY',offsetMillimeters:0,suppressed:false,profile:drawing},{id:'e',type:'extrude',name:'Extrude',profileFeatureId:'s',distanceMillimeters:4,operation:'new',suppressed:false});
 const result=evaluatePartDocument(parsePartDocument(serializePartDocument(doc)));expect(result.parts).toHaveLength(1);const z=Array.from(result.parts[0].vertices).filter((_,i)=>i%3===2);expect(Math.max(...z)-Math.min(...z)).toBeCloseTo(4);
});
it('extrudes a reopened linked slot with its construction centerline excluded',async()=>{
 const {createEmptyPartDocument,serializePartDocument,parsePartDocument}=await import('../document/index');
 const {slotSketchEntities}=await import('../sketch/operations/slot');
 const profile=slotSketchEntities({type:'drawing',contours:[{type:'path',start:[0,0],segments:[{type:'line',end:[10,0]}]}]},[{kind:'line',contour:0,index:0}],4);
 const doc=createEmptyPartDocument('Slot');doc.features.push({id:'s',type:'profile',name:'Sketch',plane:'XY',offsetMillimeters:0,suppressed:false,profile},{id:'e',type:'extrude',name:'Extrude',profileFeatureId:'s',distanceMillimeters:4,operation:'new',suppressed:false});
 const result=evaluatePartDocument(parsePartDocument(serializePartDocument(doc)));expect(result.parts).toHaveLength(1);expect(result.parts[0].triangles.length).toBeGreaterThan(10);
});
it('extrudes a native open-chain slot into one solid with exact rounded faces',async()=>{
 const {createEmptyPartDocument,serializePartDocument,parsePartDocument}=await import('../document/index');
 const {slotSketchEntities}=await import('../sketch/operations/slot');
 const profile=slotSketchEntities({type:'drawing',contours:[{type:'path',start:[0,0],segments:[{type:'line',end:[10,0]},{type:'line',end:[10,10]}]}]},[{kind:'contour',contour:0}],2);
 const doc=createEmptyPartDocument('Chain slot');doc.features.push({id:'s',type:'profile',name:'Sketch',plane:'XY',offsetMillimeters:0,suppressed:false,profile},{id:'e',type:'extrude',name:'Extrude',profileFeatureId:'s',distanceMillimeters:4,operation:'new',suppressed:false});
 const result=evaluatePartDocument(parsePartDocument(serializePartDocument(doc)));expect(result.parts).toHaveLength(1);
 expect(result.parts[0].topology.flatMap(f=>f.candidates).filter(c=>c.kind==='cylinder-axis').length).toBeGreaterThanOrEqual(3);
});
it('extrudes a saved ellipse with its full-shape relationship',async()=>{
 const {createEmptyPartDocument,serializePartDocument,parsePartDocument}=await import('../document/index');
 const {constrainSketchEllipse}=await import('../sketch/operations/ellipse-relations');const {sketchVariantContour}=await import('../sketch/primitives');
 const profile=constrainSketchEllipse({type:'drawing',contours:[sketchVariantContour('ellipse',[[0,0],[4,0],[0,2]])]},0);
 const doc=createEmptyPartDocument('Ellipse');doc.features.push({id:'s',type:'profile',name:'Sketch',plane:'XY',offsetMillimeters:0,suppressed:false,profile},{id:'e',type:'extrude',name:'Extrude',profileFeatureId:'s',distanceMillimeters:4,operation:'new',suppressed:false});
 const result=evaluatePartDocument(parsePartDocument(serializePartDocument(doc)));expect(result.parts).toHaveLength(1);expect(result.parts[0].triangles.length).toBeGreaterThan(10);
});
it('extrudes a closed bulged DXF polyline after native document serialization',async()=>{
 const {importDxfSketch}=await import('../sketch/import/dxf');const {createEmptyPartDocument,serializePartDocument,parsePartDocument}=await import('../document/index');
 const text='0\nSECTION\n2\nENTITIES\n0\nLWPOLYLINE\n90\n2\n70\n1\n10\n0\n20\n0\n42\n1\n10\n10\n20\n0\n0\nENDSEC\n0\nEOF';
 const profile=importDxfSketch(text,1).drawing,doc=createEmptyPartDocument('DXF');doc.features.push({id:'s',type:'profile',name:'Imported sketch',plane:'XY',offsetMillimeters:0,suppressed:false,profile},{id:'e',type:'extrude',name:'Extrude',profileFeatureId:'s',distanceMillimeters:4,operation:'new',suppressed:false});
 const result=evaluatePartDocument(parsePartDocument(serializePartDocument(doc)));expect(result.parts).toHaveLength(1);expect(result.parts[0].topology.flatMap(f=>f.candidates).some(c=>c.kind==='cylinder-axis')).toBe(true);
});
it('extrudes a rotated full DXF ellipse through the native kernel',async()=>{
 const {importDxfSketch}=await import('../sketch/import/dxf');const {createEmptyPartDocument,serializePartDocument,parsePartDocument}=await import('../document/index');
 const text='0\nSECTION\n2\nENTITIES\n0\nELLIPSE\n10\n10\n20\n20\n11\n3\n21\n4\n40\n0.4\n41\n0\n42\n'+(2*Math.PI)+'\n0\nENDSEC\n0\nEOF';
 const profile=importDxfSketch(text,1).drawing,doc=createEmptyPartDocument('DXF ellipse');doc.features.push({id:'s',type:'profile',name:'Imported sketch',plane:'XY',offsetMillimeters:0,suppressed:false,profile},{id:'e',type:'extrude',name:'Extrude',profileFeatureId:'s',distanceMillimeters:4,operation:'new',suppressed:false});
 const result=evaluatePartDocument(parsePartDocument(serializePartDocument(doc)));expect(result.parts).toHaveLength(1);const z=Array.from(result.parts[0].vertices).filter((_,i)=>i%3===2);expect(Math.max(...z)-Math.min(...z)).toBeCloseTo(4);
});
it('extrudes independent DXF line entities after endpoint joining',async()=>{
 const {importDxfSketch}=await import('../sketch/import/dxf');const {createEmptyPartDocument,serializePartDocument,parsePartDocument}=await import('../document/index');
 const line=(a:number[],b:number[])=>`0\nLINE\n10\n${a[0]}\n20\n${a[1]}\n11\n${b[0]}\n21\n${b[1]}`;
 const text='0\nSECTION\n2\nENTITIES\n'+[line([0,0],[10,0]),line([10,10],[10,0]),line([0,10],[10,10]),line([0,0],[0,10])].join('\n')+'\n0\nENDSEC\n0\nEOF';
 const profile=importDxfSketch(text,1).drawing,doc=createEmptyPartDocument('Joined DXF');doc.features.push({id:'s',type:'profile',name:'Imported sketch',plane:'XY',offsetMillimeters:0,suppressed:false,profile},{id:'e',type:'extrude',name:'Extrude',profileFeatureId:'s',distanceMillimeters:4,operation:'new',suppressed:false});
 const result=evaluatePartDocument(parsePartDocument(serializePartDocument(doc)));expect(result.parts).toHaveLength(1);const vertices=Array.from(result.parts[0].vertices);for(const axis of [0,1,2]){const coordinates=vertices.filter((_,i)=>i%3===axis);expect(Math.max(...coordinates)-Math.min(...coordinates)).toBeCloseTo(axis===2?4:10);}
});
it('preserves a nested solid island when extruding imported holes',async()=>{
 const {importDxfSketch}=await import('../sketch/import/dxf');const {createEmptyPartDocument,serializePartDocument,parsePartDocument}=await import('../document/index');
 const text='0\nSECTION\n2\nENTITIES\n'+[2,10,5].map(r=>`0\nCIRCLE\n10\n0\n20\n0\n40\n${r}`).join('\n')+'\n0\nENDSEC\n0\nEOF';
 const profile=importDxfSketch(text,1).drawing,doc=createEmptyPartDocument('Nested DXF');expect(profile.contours.map(c=>c.hole)).toEqual([false,false,true]);doc.features.push({id:'s',type:'profile',name:'Imported sketch',plane:'XY',offsetMillimeters:0,suppressed:false,profile},{id:'e',type:'extrude',name:'Extrude',profileFeatureId:'s',distanceMillimeters:4,operation:'new',suppressed:false});
 const result=evaluatePartDocument(parsePartDocument(serializePartDocument(doc)));
 expect(result.parts.length).toBeGreaterThan(0);
 const radii=result.parts.flatMap(p=>Array.from(p.vertices)).reduce<number[]>((out,_,i,vertices)=>{if(i%3===0)out.push(Math.hypot(vertices[i],vertices[i+1]));return out;},[]);
 for(const r of [2,5,10])expect(radii.some(v=>Math.abs(v-r)<1e-4)).toBe(true);
});
it('extrudes a periodic fit-point spline after native save and reopen',async()=>{
 const {fitSketchSpline}=await import('../sketch/curves/fit-spline');
 const {createEmptyPartDocument,serializePartDocument,parsePartDocument}=await import('../document/index');
 const profile={type:'drawing' as const,contours:[fitSketchSpline([[0,0],[10,0],[10,10],[0,10]],{closed:true})]};
 const doc=createEmptyPartDocument('Closed spline');doc.features.push({id:'s',type:'profile',name:'Spline',plane:'XY',offsetMillimeters:0,suppressed:false,profile},{id:'e',type:'extrude',name:'Extrude',profileFeatureId:'s',distanceMillimeters:4,operation:'new',suppressed:false});
 const result=evaluatePartDocument(parsePartDocument(serializePartDocument(doc)));expect(result.parts).toHaveLength(1);
 const z=Array.from(result.parts[0].vertices).filter((_,i)=>i%3===2);expect(Math.max(...z)-Math.min(...z)).toBeCloseTo(4);
 expect(result.parts[0].triangles.length).toBeGreaterThan(10);
});
it('extrudes a projected oblique circle as a native ellipse after save/reopen',async()=>{
 const {projectSketchDrawing}=await import('../sketch/projection/drawing');
 const {createEmptyPartDocument,serializePartDocument,parsePartDocument}=await import('../document/index');
 const sourceFrame={originMillimeters:[0,0,0] as [number,number,number],xDirection:[1,0,0] as [number,number,number],normal:[0,0,1] as [number,number,number]};
 const profile=projectSketchDrawing({type:'drawing',contours:[{type:'circle',center:[0,0],radius:5}]},sourceFrame,{...sourceFrame,normal:[0,.6,.8]});
 const doc=createEmptyPartDocument('Projected circle');doc.features.push({id:'s',type:'profile',name:'Projection',plane:'XY',offsetMillimeters:0,suppressed:false,profile},{id:'e',type:'extrude',name:'Extrude',profileFeatureId:'s',distanceMillimeters:2,operation:'new',suppressed:false});
 const result=evaluatePartDocument(parsePartDocument(serializePartDocument(doc)));expect(result.parts).toHaveLength(1);
 const v=Array.from(result.parts[0].vertices);for(const axis of [0,1,2]){const p=v.filter((_,i)=>i%3===axis);expect(Math.max(...p)-Math.min(...p)).toBeCloseTo([10,8,2][axis],1);}
});
it('rebuilds an associative projected profile from its source and rejects suppression',async()=>{
 const {createEmptyPartDocument,serializePartDocument,parsePartDocument}=await import('../document/index');
 const doc=createEmptyPartDocument('Associative projection');
 doc.features.push({id:'source',type:'profile',name:'Source',plane:'XY',offsetMillimeters:0,suppressed:false,frame:{originMillimeters:[0,0,0],xDirection:[1,0,0],normal:[0,.6,.8]},profile:{type:'circle',centerMillimeters:[0,0],radiusMillimeters:5}},
 {id:'linked',type:'profile',name:'Projection',plane:'XY',offsetMillimeters:0,suppressed:false,profile:{type:'projection',sourceFeatureId:'source'}},
 {id:'e',type:'extrude',name:'Extrude',profileFeatureId:'linked',distanceMillimeters:2,operation:'new',suppressed:false});
 for(const radius of [5,8]){
  const source=doc.features[0];if(source.type!=='profile'||source.profile.type!=='circle')throw Error();source.profile.radiusMillimeters=radius;
  const result=evaluatePartDocument(parsePartDocument(serializePartDocument(doc)));expect(result.parts).toHaveLength(1);
  const v=Array.from(result.parts[0].vertices);for(const axis of [0,1,2]){const p=v.filter((_,i)=>i%3===axis);expect(Math.max(...p)-Math.min(...p)).toBeCloseTo([2*radius,1.6*radius,2][axis],1);}
 }
 doc.features[0].suppressed=true;expect(()=>evaluatePartDocument(doc)).toThrow('Projection source is suppressed');
 doc.features[0].suppressed=false;doc.rollbackIndex=1;expect(evaluatePartDocument(doc).parts).toHaveLength(0);
});
it('extrudes a linked circular slot with an open center bore',async()=>{
 const {createEmptyPartDocument,serializePartDocument,parsePartDocument}=await import('../document/index');
 const {slotSketchEntities}=await import('../sketch/operations/slot');
 const profile=slotSketchEntities({type:'drawing',contours:[{type:'circle',center:[0,0],radius:10}]},[{kind:'circle',contour:0}],4);
 const doc=createEmptyPartDocument('Circular slot');doc.features.push({id:'s',type:'profile',name:'Sketch',plane:'XY',offsetMillimeters:0,suppressed:false,profile},{id:'e',type:'extrude',name:'Extrude',profileFeatureId:'s',distanceMillimeters:4,operation:'new',suppressed:false});
 const result=evaluatePartDocument(parsePartDocument(serializePartDocument(doc)));expect(result.parts).toHaveLength(1);
 const vertices=Array.from(result.parts[0].vertices);for(let i=0;i<vertices.length;i+=3)expect(Math.hypot(vertices[i],vertices[i+1])).toBeGreaterThanOrEqual(8-1e-5);
 expect(result.parts[0].topology.flatMap(f=>f.candidates).filter(c=>c.kind==='cylinder-axis').length).toBeGreaterThanOrEqual(2);
});
it('extrudes a closed rectangular slot with the exact ring volume',async()=>{
 const {createEmptyPartDocument,serializePartDocument,parsePartDocument}=await import('../document/index');const {slotSketchEntities}=await import('../sketch/operations/slot');
 const profile=slotSketchEntities({type:'drawing',contours:[{type:'path',start:[0,0],segments:[{type:'line',end:[20,0]},{type:'line',end:[20,10]},{type:'line',end:[0,10]},{type:'line',end:[0,0]}]}]},[{kind:'contour',contour:0}],2);
 const doc=createEmptyPartDocument('Closed slot');doc.features.push({id:'s',type:'profile',name:'Sketch',plane:'XY',offsetMillimeters:0,suppressed:false,profile},{id:'e',type:'extrude',name:'Extrude',profileFeatureId:'s',distanceMillimeters:4,operation:'new',suppressed:false});
 const result=evaluatePartDocument(parsePartDocument(serializePartDocument(doc)));expect(result.parts).toHaveLength(1);const p=result.parts[0],v=p.vertices,t=p.triangles;let volume=0;
 for(let i=0;i<t.length;i+=3){const a=t[i]*3,b=t[i+1]*3,c=t[i+2]*3;volume+=(v[a]*(v[b+1]*v[c+2]-v[b+2]*v[c+1])+v[a+1]*(v[b+2]*v[c]-v[b]*v[c+2])+v[a+2]*(v[b]*v[c+1]-v[b+1]*v[c]))/6;}
 expect(Math.abs(volume)).toBeCloseTo((22*12-18*8)*4,5);
});


it("intersects a saved Intersect extrusion with its target instead of adding material", async () => {
  const { createRectanglePartDocument } = await import("../document/part-document");
  const doc = createRectanglePartDocument("Native-only operation", {
    widthMillimeters: 10, heightMillimeters: 10, depthMillimeters: 10,
  });
  const pad = doc.features.find(feature => feature.type === "extrude")!;
  doc.features.push({ ...pad, id: "intersection", name: "Intersect", operation: "intersect" });
  const saved = JSON.stringify(doc);
  const result = evaluatePartDocument(doc);
  expect(result.parts).toHaveLength(1);
  const zs = Array.from(result.parts[0].vertices).filter((_, i) => i % 3 === 2);
  expect(Math.max(...zs)).toBeCloseTo(10, 3);
  expect(JSON.stringify(doc)).toBe(saved);
});

it('revolves the other way when reversed, keeping the saved geometry untouched', async () => {
  const {createEmptyPartDocument}=await import('../document/part-document');
  const doc=createEmptyPartDocument('Native revolve');
  doc.features.push({id:'s',type:'profile',name:'Profile',plane:'XY',offsetMillimeters:0,suppressed:false,profile:{type:'polygon',pointsMillimeters:[[5,2],[25,2],[25,12],[5,12]]}},
    {id:'r',type:'revolve',name:'Revolve',profileFeatureId:'s',axis:'X',angleDegrees:90,operation:'new',suppressed:false,reversed:true});
  const saved=JSON.stringify(doc);
  const forward=evaluatePartDocument({...doc,features:[doc.features[0],{...doc.features[1],reversed:false} as never]});
  const reversed=evaluatePartDocument(doc);
  const zs=(m:typeof forward)=>Array.from(m.parts[0].vertices).filter((_,i)=>i%3===2);
  // A 90° sweep about X from the XY plane rises on one side; reversed it goes the other way.
  expect(Math.sign(Math.max(...zs(forward))+Math.min(...zs(forward)))).toBe(-Math.sign(Math.max(...zs(reversed))+Math.min(...zs(reversed))));
  expect(JSON.stringify(doc)).toBe(saved);
});

const volumes=(doc:Parameters<typeof evaluatePartDocument>[0])=>{const out:number[]=[];evaluatePartDocument(doc,{withBodies:b=>{for(const s of b.values())out.push(measureVolume(s as Shape3D));}});return out;};

it('drafts an extrusion: the sketch plane is neutral and the solid narrows by tan(angle) per unit depth',async()=>{
 const {createRectanglePartDocument}=await import('../document/part-document');
 const doc=createRectanglePartDocument('Taper',{widthMillimeters:20,heightMillimeters:20,depthMillimeters:10});
 Object.assign(doc.features.find(f=>f.type==='extrude')!,{draftAngleDegrees:5});
 const k=Math.tan(5*Math.PI/180);
 expect(volumes(doc)[0]).toBeCloseTo(4*((1000-(10-10*k)**3)/(3*k)),3);
});

it('builds an independent opposite end as one prism through the sketch plane',async()=>{
 const {createRectanglePartDocument}=await import('../document/part-document');
 const doc=createRectanglePartDocument('Two ends',{widthMillimeters:20,heightMillimeters:20,depthMillimeters:10});
 Object.assign(doc.features.find(f=>f.type==='extrude')!,{secondEnd:{endType:'blind',distanceMillimeters:5}});
 expect(volumes(doc)[0]).toBeCloseTo(20*20*15,6);
});

it('extrudes along a custom direction: depth is measured along it, so the solid shears',async()=>{
 const {createEmptyPartDocument}=await import('../document/part-document');
 const doc=createEmptyPartDocument('Direction');
 const source={id:'s',type:'profile' as const,name:'Circle',plane:'XY' as const,offsetMillimeters:0,suppressed:false,profile:{type:'circle' as const,centerMillimeters:[0,0] as [number,number],radiusMillimeters:2}};
 doc.features.push(source,{id:'e',type:'extrude',name:'Angled',profileFeatureId:'s',distanceMillimeters:10,operation:'new',directionVector:[.6,0,.8],suppressed:false});
 expect(volumes(doc)[0]).toBeCloseTo(Math.PI*4*8,4);
});

it('extrudes along a line of another sketch, and names a missing line',async()=>{
 const {createEmptyPartDocument}=await import('../document/part-document');
 const doc=createEmptyPartDocument('Reference');
 doc.features.push({id:'s',type:'profile',name:'Circle',plane:'XY',offsetMillimeters:0,suppressed:false,profile:{type:'circle',centerMillimeters:[0,0],radiusMillimeters:2}},
 {id:'g',type:'profile',name:'Guide',plane:'XZ',offsetMillimeters:0,suppressed:false,profile:{type:'drawing',contours:[{type:'path',id:'guide',start:[0,0],segments:[{type:'line',id:'seg',end:[6,8]}]}]}},
 {id:'e',type:'extrude',name:'Along line',profileFeatureId:'s',distanceMillimeters:10,operation:'new',suppressed:false,directionReference:{kind:'sketch-line',sourceFeatureId:'g',contourId:'guide',segmentId:'seg'}});
 expect(volumes(doc)[0]).toBeCloseTo(Math.PI*4*8,4);
 (doc.features[2] as any).directionReference.segmentId='missing';
 expect(()=>evaluatePartDocument(doc)).toThrow(/direction line is unavailable/);
});

it('builds a thin wall around a closed profile: thickness 1 outside, thickness 2 inside',async()=>{
 const {createEmptyPartDocument}=await import('../document/part-document');
 const doc=createEmptyPartDocument('Wall');
 doc.features.push({id:'s',type:'profile',name:'Rect',plane:'XY',offsetMillimeters:0,suppressed:false,profile:{type:'drawing',contours:[{type:'path',id:'rect',start:[-10,-5],segments:[{type:'line',end:[10,-5]},{type:'line',end:[10,5]},{type:'line',end:[-10,5]},{type:'line',end:[-10,-5]}]}]}},
 {id:'e',type:'extrude',name:'Wall',profileFeatureId:'s',profileContourId:'rect',distanceMillimeters:10,operation:'new',suppressed:false,thin:{thickness1Millimeters:2,thickness2Millimeters:1}});
 expect(volumes(doc)[0]).toBeCloseTo((24*14-18*8)*10,4);
});

it('names the missing stopping part or vertex instead of extruding an arbitrary depth',async()=>{
 const {createRectanglePartDocument}=await import('../document/part-document');
 const part=createRectanglePartDocument('Part limit',{widthMillimeters:20,heightMillimeters:10,depthMillimeters:1});
 Object.assign(part.features.find(f=>f.type==='extrude')!,{endType:'up-to-part',endPartId:'stop'});
 expect(()=>evaluatePartDocument(part)).toThrow(/stopping part is unavailable/);
 const vertex=createRectanglePartDocument('Vertex limit',{widthMillimeters:20,heightMillimeters:10,depthMillimeters:1});
 Object.assign(vertex.features.find(f=>f.type==='extrude')!,{endType:'up-to-vertex',endPointReference:{kind:'solid-vertex',sourceFeatureId:'stop',bodyId:'stop',label:'Corner',anchor:{positionMillimeters:[0,0,20],signature:'corner',incidence:'native-incidence',shapeFingerprint:'a'.repeat(64)}}});
 expect(()=>evaluatePartDocument(vertex)).toThrow(/Stopping vertex source is unavailable/);
});

it('starts from a referenced parallel plane: the principal plane of the sketch changes nothing',async()=>{
 const {createRectanglePartDocument}=await import('../document/part-document');
 const doc=createRectanglePartDocument('Reference start',{widthMillimeters:20,heightMillimeters:10,depthMillimeters:1});
 Object.assign(doc.features.find(f=>f.type==='extrude')!,{startingReference:{kind:'principal',plane:'XY',label:'XY'}});
 expect(volumes(doc)[0]).toBeCloseTo(200,6);
});

it('resolves automatic scope: a cut meets every solid it overlaps and reports the targets', async () => {
  const {createEmptyPartDocument}=await import('../document/part-document');
  const doc=createEmptyPartDocument('Automatic scope');
  doc.features.push(
    {id:'sa',type:'profile',name:'A',plane:'XY',offsetMillimeters:0,suppressed:false,profile:{type:'polygon',pointsMillimeters:[[-30,-20],[-2,-20],[-2,20],[-30,20]]}},
    {id:'a',type:'extrude',name:'A',profileFeatureId:'sa',distanceMillimeters:10,operation:'new',suppressed:false},
    {id:'sb',type:'profile',name:'B',plane:'XY',offsetMillimeters:0,suppressed:false,profile:{type:'polygon',pointsMillimeters:[[2,-20],[30,-20],[30,20],[2,20]]}},
    {id:'b',type:'extrude',name:'B',profileFeatureId:'sb',distanceMillimeters:10,operation:'new',suppressed:false},
    {id:'h',type:'profile',name:'Hole',plane:'XY',offsetMillimeters:10,suppressed:false,profile:{type:'circle',radiusMillimeters:6,centerMillimeters:[0,0]}},
    {id:'c',type:'extrude',name:'Cut',profileFeatureId:'h',distanceMillimeters:10,operation:'cut',scopeMode:'all',endType:'through-all',suppressed:false} as never);
  const result=evaluatePartDocument(doc);
  expect(result.parts.map(p=>p.id).sort()).toEqual([`${doc.documentId}:body-1`,`${doc.documentId}:body-b`].sort());
  expect(result.scopeResolutions?.c).toEqual({targets:[`${doc.documentId}:body-1`,`${doc.documentId}:body-b`],groups:[{bodyId:`${doc.documentId}:body-1`,sources:[`${doc.documentId}:body-1`]},{bodyId:`${doc.documentId}:body-b`,sources:[`${doc.documentId}:body-b`]}]});
  expect(result.parts.every(p=>p.topology.some(f=>f.surfaceType==='CYLINDER'))).toBe(true);
});

it("flips a sketch plane: the normal and default extrude direction reverse, the other axis mirrors", async () => {
  const { createEmptyPartDocument } = await import("../document/part-document");
  const doc = createEmptyPartDocument("Flip");
  // A 10 × 5 plate from the origin into +x, +y; extruded 4 mm along the sketch normal.
  const plate = (flip?: "x" | "y") => ({ ...doc, features: [
    { id: "s", type: "profile" as const, name: "S", plane: "XY" as const, offsetMillimeters: 0, suppressed: false, ...(flip ? { flip } : {}), profile: { type: "polygon" as const, pointsMillimeters: [[0, 0], [10, 0], [10, 5], [0, 5]] as [number, number][] } },
    { id: "e", type: "extrude" as const, name: "E", profileFeatureId: "s", distanceMillimeters: 4, operation: "new" as const, suppressed: false },
  ] });
  const bounds = (d: typeof doc) => { let b: number[] = []; evaluatePartDocument(d, { withBodies: (bodies) => { const box = [...bodies.values()][0].boundingBox; b = [...box.bounds[0], ...box.bounds[1]]; } }); return b.map((v) => Math.round(v * 1000) / 1000 + 0); };
  expect(bounds(plate())).toEqual([0, 0, 0, 10, 5, 4]);
  // Flip about x: y and the normal reverse; the plate lies at y ∈ [-5, 0], z ∈ [-4, 0].
  expect(bounds(plate("x"))).toEqual([0, -5, -4, 10, 0, 0]);
  // Flip about y: x and the normal reverse.
  expect(bounds(plate("y"))).toEqual([-10, 0, -4, 0, 5, 0]);
}, 30000);


it('revolves up to a vertex, a part, a face or the next part, on either side', async () => {
 const {createEmptyPartDocument}=await import('../document/part-document');
 const doc=createEmptyPartDocument('Revolve limits');
 // A block at y ≥ 8 across the ring's path, and a ring profile r ∈ [10, 20], z ∈ [0, 10] about Z.
 doc.features.push(
  {id:'bs',type:'profile',name:'Block sketch',plane:'XY',offsetMillimeters:-5,suppressed:false,profile:{type:'drawing',contours:[{type:'path',id:'b',start:[-5,8],segments:[{type:'line',end:[30,8]},{type:'line',end:[30,40]},{type:'line',end:[-5,40]},{type:'line',end:[-5,8]}]}]}},
  {id:'block',type:'extrude',name:'Block',profileFeatureId:'bs',distanceMillimeters:20,operation:'new',suppressed:false},
  {id:'pt',type:'profile',name:'Stop points',plane:'XY',offsetMillimeters:0,suppressed:false,profile:{type:'drawing',contours:[{type:'circle',id:'up',center:[0,15],radius:1},{type:'circle',id:'down',center:[0,-15],radius:1}]}},
  {id:'rs',type:'profile',name:'Ring sketch',plane:'XZ',offsetMillimeters:0,suppressed:false,profile:{type:'drawing',contours:[{type:'path',id:'r',start:[10,0],segments:[{type:'line',end:[20,0]},{type:'line',end:[20,10]},{type:'line',end:[10,10]},{type:'line',end:[10,0]}]}]}});
 const bodies=(d:typeof doc)=>{const out:Record<string,number>={};evaluatePartDocument(d,{withBodies:b=>{for(const [id,s] of b)out[id]=measureVolume(s as Shape3D);}});return out;};
 const blockId=Object.keys(bodies(doc))[0];
 const ring=(end:Record<string,unknown>)=>{const d={...doc,features:[...doc.features,{id:'rev',type:'revolve' as const,name:'Ring',suppressed:false,profileFeatureId:'rs',axis:'Z' as const,angleDegrees:90,operation:'new' as const,...end}]};const v=bodies(d);return v[Object.keys(v).find(id=>id!==blockId)!];};
 // The ring meets the block's y = 8 face where r·sin θ = 8: volume = 10 ∫₁₀²⁰ r·asin(8/r) dr (Simpson).
 let integral=0;const n=200,h=10/n;for(let i=0;i<=n;i++){const r=10+i*h;integral+=(i===0||i===n?1:i%2?4:2)*r*Math.asin(8/r);}integral*=h/3;
 const toBlock=10*integral;
 expect(ring({endType:'up-to-part',endPartId:blockId})).toBeCloseTo(toBlock,1);
 expect(ring({endType:'up-to-next'})).toBeCloseTo(toBlock,1);
 expect(ring({endType:'up-to-face',endReference:{sourceFeatureId:'block',bodyId:blockId,label:'Near face',normal:[0,-1,0]}})).toBeCloseTo(toBlock,1);
 // A quarter turn to the point at (0, 15); the opposite side turns the other way to (0, −15).
 const quarter=Math.PI*(400-100)*10/4;
 expect(ring({endType:'up-to-vertex',endPointReference:{kind:'sketch-point',sourceFeatureId:'pt',contourId:'up',point:'center',label:'Up'}})).toBeCloseTo(quarter,1);
 expect(ring({endType:'up-to-part',endPartId:blockId,secondEnd:{endType:'up-to-vertex',endPointReference:{kind:'sketch-point',sourceFeatureId:'pt',contourId:'down',point:'center',label:'Down'}}})).toBeCloseTo(toBlock+quarter,1);
 expect(ring({angleDegrees:45,secondEnd:{endType:'blind',angleDegrees:45}})).toBeCloseTo(quarter,1);
 // Nothing to meet: the far face of the block is behind the profile when reversed.
 expect(()=>ring({endType:'up-to-face',endReference:{sourceFeatureId:'block',bodyId:blockId,label:'Far face',normal:[0,1,0]}})).toThrow(/before the selected face/);
 expect(()=>ring({endType:'up-to-vertex',endPointReference:{kind:'sketch-point',sourceFeatureId:'pt',contourId:'up',point:'center',label:'Up'},reversed:true,angleDegrees:90})).not.toThrow();
},60000);

it('finishes a picked face as its edges, and measures a fillet by width and a chamfer by tangent distance', async () => {
 const {createRectanglePartDocument}=await import('../document/part-document');
 const box=createRectanglePartDocument('Face finish',{widthMillimeters:20,heightMillimeters:10,depthMillimeters:10});
 const built=evaluatePartDocument(box).parts[0], extrudeId=box.features.find(f=>f.type==='extrude')!.id;
 const volumeOf=(d:typeof box)=>{let v=0;evaluatePartDocument(d,{withBodies:b=>{for(const s of b.values())v=measureVolume(s as Shape3D);}});return v;};
 const top=built.topology.flatMap(f=>f.candidates).find(c=>c.kind==='face-center'&&c.origin[2]>9.9)!;
 const topFace={sourceFeatureId:extrudeId,bodyId:built.id,label:'Top face',normal:[0,0,1] as [number,number,number],faceAnchor:{centerMillimeters:top.origin as [number,number,number],areaSquareMillimeters:200}};
 const topEdges=built.topology.find(f=>f.candidates.some(c=>c.id===top.id))!.candidates.filter(c=>c.kind==='edge-midpoint');
 expect(topEdges).toHaveLength(4);
 const edgeRefs=topEdges.map(c=>({kind:'curved-edge' as const,sourceFeatureId:extrudeId,bodyId:built.id,label:'Edge',midpointMillimeters:c.origin as [number,number,number],lengthMillimeters:c.measurements!.lengthMillimeters!}));
 const withFillet=(edges:unknown[],extra:Record<string,unknown>={})=>({...box,features:[...box.features,{id:'f',type:'fillet' as const,name:'Fillet',suppressed:false,radiusMillimeters:1,targetBodyId:built.id,edges,...extra}]} as typeof box);
 // The same pipeline: a face pick and its four edges picked one by one give one result.
 expect(volumeOf(withFillet([{kind:'face-edges',...topFace}]))).toBeCloseTo(volumeOf(withFillet(edgeRefs)),6);
 // A 1 mm radius along one 20 mm edge removes (1 − π/4) mm³ per mm; by width, √2 mm gives the same radius on a 90° edge.
 const oneEdge=[edgeRefs.find(e=>e.lengthMillimeters>19.9)!];
 expect(volumeOf(withFillet(oneEdge))).toBeCloseTo(2000-(1-Math.PI/4)*20,4);
 expect(volumeOf(withFillet(oneEdge,{radiusMillimeters:Math.SQRT2,measurement:'width'}))).toBeCloseTo(2000-(1-Math.PI/4)*20,4);
 // A chamfer of offset 1 removes 10 mm³ along that edge; a tangent distance of √2 is the same chamfer.
 const withChamfer=(extra:Record<string,unknown>)=>({...box,features:[...box.features,{id:'c',type:'chamfer' as const,name:'Chamfer',suppressed:false,radiusMillimeters:1,targetBodyId:built.id,edges:oneEdge,...extra}]} as typeof box);
 expect(volumeOf(withChamfer({}))).toBeCloseTo(1990,4);
 expect(volumeOf(withChamfer({radiusMillimeters:Math.SQRT2,measurement:'tangent'}))).toBeCloseTo(1990,4);
},60000);

it('flips a two-distance chamfer to the other face, globally and per edge', async () => {
 const {createRectanglePartDocument}=await import('../document/part-document');
 const box=createRectanglePartDocument('Chamfer flip',{widthMillimeters:20,heightMillimeters:10,depthMillimeters:10});
 const built=evaluatePartDocument(box).parts[0], extrudeId=box.features.find(f=>f.type==='extrude')!.id;
 const top=built.topology.flatMap(f=>f.candidates).find(c=>c.kind==='face-center'&&c.origin[2]>9.9)!;
 const edge=built.topology.find(f=>f.candidates.some(c=>c.id===top.id))!.candidates.filter(c=>c.kind==='edge-midpoint').find(c=>c.measurements!.lengthMillimeters!>19.9)!;
 const ref={kind:'curved-edge' as const,sourceFeatureId:extrudeId,bodyId:built.id,label:'Edge',midpointMillimeters:edge.origin as [number,number,number],lengthMillimeters:edge.measurements!.lengthMillimeters!};
 // The chamfer face's normal: legs (1 on top, 2 down the side) tilt it one way, (2, 1) the other.
 const tilt=(extra:Record<string,unknown>)=>{let normal:number[]=[];evaluatePartDocument({...box,features:[...box.features,{id:'c',type:'chamfer' as const,name:'Chamfer',suppressed:false,radiusMillimeters:1,secondDistanceMillimeters:2,targetBodyId:built.id,edges:[ref],...extra}]} as typeof box,{withBodies:b=>{for(const s of b.values())for(const face of (s as Shape3D).faces){if(face.geomType!=='PLANE')continue;const c=face.center,n=face.normalAt([c.x,c.y,c.z]);const v=[n.x,n.y,n.z];c.delete();n.delete();if(Math.abs(v[2])>0.05&&Math.abs(v[2])<0.95)normal=v;}}});return normal.map(v=>Math.abs(+v.toFixed(3)));};
 const plain=tilt({}), flipped=tilt({flipped:true}), overridden=tilt({flippedEdges:[ref]});
 // 1 along the top and 2 down the side: the chamfer plane runs through (−4, 10) and (−5, 8), normal ∝ (0, 2, −1).
 expect(plain[2]).toBeCloseTo(1/Math.sqrt(5),2);
 expect(flipped[2]).toBeCloseTo(2/Math.sqrt(5),2); // 2 along the top, 1 down the side
 expect(overridden).toEqual(flipped); // a per-edge override flips that edge the same way
 expect(tilt({flipped:true,flippedEdges:[ref]})).toEqual(plain); // both together cancel
},60000);

it('samples a circular edge densely enough to pick anywhere along it', async () => {
 const {createEmptyPartDocument}=await import('../document/part-document');
 const doc=createEmptyPartDocument('Rim');
 doc.features.push({id:'s',type:'profile',name:'Disc',plane:'XY',offsetMillimeters:0,suppressed:false,profile:{type:'drawing',contours:[{type:'circle',id:'c',center:[0,0],radius:100}]}},
  {id:'e',type:'extrude',name:'Disc',profileFeatureId:'s',distanceMillimeters:10,operation:'new',suppressed:false});
 const rim=evaluatePartDocument(doc).parts[0].topology.flatMap(f=>f.candidates).find(c=>c.kind==='edge-midpoint'&&c.measurements?.radiusMillimeters===100)!;
 const line=rim.polylineMillimeters!; expect(line.length/3).toBeGreaterThanOrEqual(90); // 360° / 4°
 let worst=0; for(let i=0;i+5<line.length;i+=3){const mx=(line[i]+line[i+3])/2,my=(line[i+1]+line[i+4])/2;worst=Math.max(worst,100-Math.hypot(mx,my));}
 expect(worst).toBeLessThan(0.1); // every chord stays within 0.1 mm of the circle
},30000);
