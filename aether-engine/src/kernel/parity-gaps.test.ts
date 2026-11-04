/** Closed-form checks for the Onshape parity gaps closed after alpha-0.1.98 (ledger:
 *  dev/docs/roadmap/Onshape_Feature_Parity.md): each feature's new control changes the volume by a
 *  number that can be computed by hand. */
import { beforeAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import init from "replicad-opencascadejs";
import { makeBaseBox, measureVolume, setOC, type Shape3D } from "replicad";
import { evaluatePartDocument } from "./part-evaluator";
import { bodyIDForFeature, createEmptyPartDocument, type PartDocument, type PartFeature } from "../document/index";

beforeAll(async () => {
  setOC(await (init as any)({ wasmBinary: readFileSync(new URL("../../node_modules/replicad-opencascadejs/src/replicad_single.wasm", import.meta.url)) }));
}, 30000);

const rect = (id: string, x0: number, y0: number, x1: number, y1: number, offset = 0): PartFeature => ({ id, type: "profile", name: id, plane: "XY", offsetMillimeters: offset, suppressed: false, profile: { type: "polygon", pointsMillimeters: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] } });
const extrude = (id: string, profile: string, distance: number, operation: "new" | "add" | "cut" = "new"): PartFeature => ({ id, type: "extrude", name: id, profileFeatureId: profile, distanceMillimeters: distance, operation, suppressed: false });
// One document identity for every variant: body ids derive from it.
const base = createEmptyPartDocument("Parity");
const doc = (...features: PartFeature[]): PartDocument => ({ ...base, features: [...features] });
const volumes = (d: PartDocument) => { const out: Record<string, number> = {}; evaluatePartDocument(d, { withBodies: (bodies) => { for (const [id, body] of bodies) out[id] = measureVolume(body as Shape3D); } }); return out; };
const total = (d: PartDocument) => Object.values(volumes(d)).reduce((a, b) => a + b, 0);

it("Thicken: Thickness 2 thickens the other side by its own amount, and Keep tools false consumes the sheet", () => {
  const sheet: PartFeature = { id: "p", type: "surface-patch", name: "Sheet", suppressed: false, operation: "new", profileFeatureId: "q" };
  const base = doc(rect("q", 0, 0, 10, 10), sheet);
  const sheetId = bodyIDForFeature(base, sheet);
  const thick: PartFeature = { id: "t", type: "surface-thicken", name: "Thick", suppressed: false, operation: "new", bodyIds: [sheetId], thicknessMillimeters: 2, secondThicknessMillimeters: 3, keepTools: false };
  const d = doc(rect("q", 0, 0, 10, 10), sheet, thick);
  const v = volumes(d);
  // 10 × 10 × (2 + 3), and the sheet is gone.
  expect(v[bodyIDForFeature(d, thick)]).toBeCloseTo(500, 3);
  expect(v[sheetId]).toBeUndefined();
  const kept = doc(rect("q", 0, 0, 10, 10), sheet, { ...thick, keepTools: true } as PartFeature);
  expect(Object.keys(volumes(kept))).toHaveLength(2);
});

it("Boolean: Subtract with an offset leaves a gap of the offset's width around the tool", () => {
  // A 40 × 40 × 40 block and a 10 × 10 × 10 tool through its middle (z 0…10 of the block's 0…40).
  const block = doc(rect("a", 0, 0, 40, 40), extrude("block", "a", 40), rect("b", 15, 15, 25, 25), extrude("tool", "b", 10));
  const blockId = bodyIDForFeature(block, block.features[1]), toolId = bodyIDForFeature(block, block.features[3]);
  const subtract = (offset?: number): PartDocument => doc(...block.features, { id: "s", type: "boolean", name: "Subtract", suppressed: false, operation: "cut", targetBodyId: blockId, toolBodyIds: [toolId], keepTools: false, ...(offset ? { offsetMillimeters: offset } : {}) });
  expect(total(subtract())).toBeCloseTo(64000 - 1000, 2);
  // Grown by 1 mm with rounded joins: a 12 × 12 × 12 box less its rounded edges and corners, clipped to the block (the tool's
  // bottom face lies on the block's). Only the part inside the block counts: z 0…11.
  const grown = 64000 - total(subtract(1));
  expect(grown).toBeGreaterThan(1000);
  expect(grown).toBeLessThan(12 * 12 * 11);
  // Shrunk by 1 mm: an 8 × 8 × 8 cube exactly.
  expect(total(subtract(-1))).toBeCloseTo(64000 - 512, 1);
});

it("Pattern: skipped instances are left out, a part pattern can add its copies to the merge scope, and a cylindrical face gives the axis", () => {
  // A 100 × 100 × 5 plate and a 4 mm post at (30, 0), patterned.
  const plate = doc(rect("s", -50, -50, 50, 50), extrude("e", "s", 5), { id: "c", type: "profile", name: "Post", plane: "XY", offsetMillimeters: 5, suppressed: false, profile: { type: "circle", radiusMillimeters: 2, centerMillimeters: [30, 0] } }, extrude("post", "c", 5, "add"));
  const post = Math.PI * 4 * 5, base = total(plate);
  const pattern = (extra: Record<string, unknown>): PartDocument => doc(...plate.features, { id: "p", type: "pattern", name: "Pattern", suppressed: false, sourceFeatureId: "post", patternType: "linear", axis: "X", count: 4, spacingMillimeters: 10, reversed: false, ...extra } as PartFeature);
  expect(total(pattern({}))).toBeCloseTo(base + 3 * post, 2);
  expect(total(pattern({ skipInstances: [2, 4] }))).toBeCloseTo(base + post, 2);
  // A part pattern of a separate 2 × 2 × 2 cube, added to the plate: one body, three cubes more.
  const cube = doc(...plate.features, rect("k", 10, 10, 12, 12, 5), extrude("cube", "k", 2));
  const plateId = bodyIDForFeature(cube, cube.features[1]), cubeId = bodyIDForFeature(cube, cube.features[5]);
  const added = doc(...cube.features, { id: "p", type: "pattern", name: "Cubes", suppressed: false, sourceFeatureId: "cube", bodyIds: [cubeId], copyBodyIds: { [cubeId]: "copy" }, patternType: "linear", axis: "X", count: 4, spacingMillimeters: 10, reversed: false, resultOperation: "add", targetBodyId: plateId } as PartFeature);
  const v = volumes(added);
  expect(Object.keys(v).sort()).toEqual([cubeId, plateId].sort());
  expect(v[plateId]).toBeCloseTo(base + 3 * 8, 2);
  // Circular about the post's own cylindrical face: four posts on a circle of radius 30 about the origin? No: about the post's axis
  // the copies land on the post itself. Pattern the cube about the post's face instead: four cubes 90° apart around (30, 0).
  const built = evaluatePartDocument(cube).parts.find((p) => p.id === plateId)!;
  const cylinder = built.topology.find((f) => f.surfaceType === "CYLINDER")!;
  const axisFace = { kind: "face" as const, sourceFeatureId: "post", bodyId: plateId, label: "Post face", surfaceType: "cylinder" as const, faceAnchor: { centerMillimeters: cylinder.measurements!.centerMillimeters as [number, number, number], areaSquareMillimeters: cylinder.measurements!.areaSquareMillimeters as number } };
  const polar = doc(...cube.features, { id: "p", type: "pattern", name: "Around", suppressed: false, sourceFeatureId: "cube", bodyIds: [cubeId], copyBodyIds: { [cubeId]: "copy" }, patternType: "polar", axis: "Z", count: 4, angleDegrees: 360, reversed: false, axisReference: axisFace } as PartFeature);
  const parts = evaluatePartDocument(polar).parts;
  expect(parts).toHaveLength(5);
  const centres = parts.filter((p) => p.id.startsWith("copy")).map((p) => { const b = p.topology.flatMap((f) => f.candidates).filter((c) => c.kind === "face-center"); const x = b.reduce((s, c) => s + c.origin[0], 0) / b.length, y = b.reduce((s, c) => s + c.origin[1], 0) / b.length; return [Math.round(x * 100) / 100, Math.round(y * 100) / 100]; }).sort();
  // The cube centre (11, 11) turned 90°, 180° and 270° about (30, 0): (19, −19), (49, −11), (41, 19).
  expect(centres).toEqual([[19, -19], [41, 19], [49, -11]]);
});

it("Transform: Translate by distance moves along the reference line by the typed distance, reversed when asked", () => {
  const block = doc(rect("a", 0, 0, 10, 10), extrude("b", "a", 10), { id: "l", type: "profile", name: "Line", plane: "XY", offsetMillimeters: 0, suppressed: false, profile: { type: "drawing", contours: [{ id: "L", type: "path", start: [0, 20], segments: [{ id: "seg", type: "line", end: [3, 24] }] }] } });
  const id = bodyIDForFeature(block, block.features[1]);
  const moved = (distance: number, reversed = false): PartDocument => doc(...block.features, { id: "t", type: "transform", name: "Move", suppressed: false, bodyIds: [id], transform: { kind: "translate-reference", reference: { kind: "sketch-line", sourceFeatureId: "l", contourId: "L", segmentId: "seg" }, distanceMillimeters: distance, ...(reversed ? { reversed: true } : {}) } } as PartFeature);
  const centre = (d: PartDocument) => { const b = evaluatePartDocument(d).parts[0].topology.flatMap((f) => f.candidates).filter((c) => c.kind === "face-center"); return [0, 1, 2].map((i) => Math.round(b.reduce((s, c) => s + c.origin[i], 0) / b.length * 1000) / 1000); };
  // The line's direction is (3, 4) / 5; 10 mm along it moves the centre by (6, 8).
  expect(centre(moved(10))).toEqual([11, 13, 5]);
  expect(centre(moved(10, true))).toEqual([-1, -3, 5]);
});

it("Mirror: parts mirror to new parts, or add, remove and intersect with the merge scope part", () => {
  // A 10 × 10 × 10 block at x 0…10 and a 4 × 4 × 4 cube at x 2…6, both on z 0…; mirrored about the YZ plane at x = 10.
  const two = doc(rect("a", 0, 0, 10, 10), extrude("block", "a", 10), rect("k", 2, 2, 6, 6), extrude("cube", "k", 4));
  const blockId = bodyIDForFeature(two, two.features[1]), cubeId = bodyIDForFeature(two, two.features[3]);
  const mirror = (extra: Record<string, unknown>): PartDocument => doc(...two.features, { id: "m", type: "mirror", name: "Mirror", suppressed: false, bodyIds: [cubeId], plane: "YZ", offsetMillimeters: 10, ...extra } as PartFeature);
  const fresh = volumes(mirror({ operation: "new", copyBodyIds: { [cubeId]: "image" } }));
  expect(Object.keys(fresh).sort()).toEqual([blockId, cubeId, "image"].sort());
  expect(fresh.image).toBeCloseTo(64, 6);
  // Added to the block: the image (x 14…18) is detached from the block, so Add refuses nothing here but makes two solids; cut instead.
  const removed = volumes(mirror({ operation: "cut", targetBodyId: blockId }));
  expect(removed[blockId]).toBeCloseTo(1000, 6); // the image lies outside the block
  // Mirror about x = 5 instead: the image lands on x 4…8, inside the block, so Remove takes 64 and Intersect keeps 64.
  const inside = (operation: string) => volumes(doc(...two.features, { id: "m", type: "mirror", name: "Mirror", suppressed: false, bodyIds: [cubeId], plane: "YZ", offsetMillimeters: 5, operation, targetBodyId: blockId } as PartFeature))[blockId];
  expect(inside("cut")).toBeCloseTo(1000 - 64, 6);
  expect(inside("intersect")).toBeCloseTo(64, 6);
  // A feature mirror as a new part: the mirrored cube tool alone.
  const asNew = doc(...two.features, { id: "m", type: "mirror", name: "Mirror", suppressed: false, sourceFeatureId: "cube", plane: "YZ", offsetMillimeters: 10, operation: "new" } as PartFeature);
  const v = volumes(asNew);
  expect(Object.keys(v)).toHaveLength(3);
  expect(v[bodyIDForFeature(asNew, asNew.features[4])]).toBeCloseTo(64, 6);
});

it("Split: a cylindrical face splits by its whole surface, and a face trimmed to its boundary splits only where it crosses", () => {
  // A 40 × 40 × 10 plate with a 6 mm post at (20, 20) on top: the post's cylindrical face, extended, cores the plate.
  const plate = doc(rect("a", 0, 0, 40, 40), extrude("plate", "a", 10), { id: "c", type: "profile", name: "Post", plane: "XY", offsetMillimeters: 10, suppressed: false, profile: { type: "circle", radiusMillimeters: 3, centerMillimeters: [20, 20] } }, extrude("post", "c", 5, "add"));
  const plateId = bodyIDForFeature(plate, plate.features[1]);
  const built = evaluatePartDocument(plate).parts[0];
  const cylinder = built.topology.find((f) => f.surfaceType === "CYLINDER")!;
  const face = { kind: "face" as const, sourceFeatureId: "post", bodyId: plateId, label: "Post face", surfaceType: "cylinder" as const, faceAnchor: { centerMillimeters: cylinder.measurements!.centerMillimeters as [number, number, number], areaSquareMillimeters: cylinder.measurements!.areaSquareMillimeters as number } };
  const split = (extra: Record<string, unknown>): PartDocument => doc(...plate.features, { id: "s", type: "split", name: "Split", suppressed: false, bodyIds: [plateId], copyBodyIds: { [plateId]: "outside" }, tool: face, keep: "both", ...extra } as PartFeature);
  const whole = volumes(split({}));
  // Inside the cylinder: the post (π·9·5) plus the plate's core (π·9·10); outside: the rest of the plate.
  expect(whole[plateId]).toBeCloseTo(Math.PI * 9 * 15, 3);
  expect(whole.outside).toBeCloseTo(16000 - Math.PI * 9 * 10, 3);
  // Trimmed to the post's own face (z 10…15): the face crosses nothing of the plate, so one piece: refused, not faked.
  expect(() => volumes(split({ trimToFace: true }))).toThrow(/one piece/);
  // A surface sheet through the plate, trimmed: a 40 × 6 patch standing on x = 10 from z 2 to 8 does not cut through either.
  const sheet: PartFeature = { id: "sh", type: "surface-extrude", name: "Sheet", suppressed: false, operation: "new", profileFeatureId: "line", distanceMillimeters: 30 };
  const withSheet = doc(...plate.features, { id: "line", type: "profile", name: "Line", plane: "XY", offsetMillimeters: -5, suppressed: false, profile: { type: "drawing", contours: [{ id: "L", type: "path", start: [10, -5], segments: [{ id: "seg", type: "line", end: [10, 45] }] }] } }, sheet);
  const sheetId = bodyIDForFeature(withSheet, sheet);
  const sheetFace = evaluatePartDocument(withSheet).parts.find((p) => p.id === sheetId)!.topology[0];
  const tool = { kind: "face" as const, sourceFeatureId: "sh", bodyId: sheetId, label: "Sheet", normal: sheetFace.measurements!.planarNormal as [number, number, number], faceAnchor: { centerMillimeters: sheetFace.measurements!.centerMillimeters as [number, number, number], areaSquareMillimeters: sheetFace.measurements!.areaSquareMillimeters as number } };
  const bySheet = doc(...withSheet.features, { id: "s", type: "split", name: "Split", suppressed: false, bodyIds: [plateId], copyBodyIds: { [plateId]: "half" }, tool, trimToFace: true, keepTools: false, keep: "both" } as PartFeature);
  const v = volumes(bySheet);
  // The sheet spans z −5…25 and y −5…45 at x = 10: it cuts the plate (and post) into x 0…10 and x 10…40; the sheet is consumed.
  expect(Object.keys(v).sort()).toEqual([plateId, "half"].sort());
  expect(v[plateId] + v.half).toBeCloseTo(16000 + Math.PI * 9 * 5, 3);
  expect(Math.min(v[plateId], v.half)).toBeCloseTo(4000, 3);
});

it("Hole: Up to next drills through the first wall, Up to entity stops at a face, Start from part and a start plane move the start", () => {
  // Two 40 × 40 slabs: z 0…10 and z 20…30 (one part), a sketch point above at z 40.
  const slabs = doc(rect("a", 0, 0, 40, 40), extrude("lower", "a", 10), rect("b", 0, 0, 40, 40, 20), extrude("upper", "b", 10, "add"), { id: "pt", type: "profile", name: "Point", plane: "XY", offsetMillimeters: 40, suppressed: false, profile: { type: "drawing", contours: [{ type: "circle", id: "circle", center: [20, 20], radius: 1 }] } });
  const id = bodyIDForFeature(slabs, slabs.features[1]);
  const hole = (extra: Record<string, unknown>): PartDocument => doc(...slabs.features, { id: "h", type: "hole", name: "Hole", suppressed: false, targetBodyId: id, placement: { kind: "sketch-points", points: [{ kind: "sketch-point", sourceFeatureId: "pt", contourId: "circle", point: "center", label: "Centre" }] }, diameterMillimeters: 4, depthMillimeters: 10, depthType: "blind", cutType: "plain", ...extra } as PartFeature);
  const bore = Math.PI * 4; // per mm of depth
  const base = total(slabs);
  // Blind 10 mm from the sketch at z 40 reaches nothing: refused as before.
  expect(() => total(hole({}))).toThrow(/removes no material/);
  // Up to next from the sketch: through the upper slab only (z 30…20).
  expect(total(hole({ depthType: "up-to-next" }))).toBeCloseTo(base - 10 * bore, 3);
  // Start from part, blind 15: starts at z 30, ends at z 15: the upper slab only.
  expect(total(hole({ startFrom: "part", depthMillimeters: 15 }))).toBeCloseTo(base - 10 * bore, 3);
  // Start from part, blind 25: z 30…5: the upper slab and 5 of the lower.
  expect(total(hole({ startFrom: "part", depthMillimeters: 25 }))).toBeCloseTo(base - 15 * bore, 3);
  // Through all from the sketch: both slabs.
  expect(total(hole({ depthType: "through-all" }))).toBeCloseTo(base - 20 * bore, 3);
  // Up to entity: the lower slab's top face (z = 10): both slabs down to z 10, so the upper slab only.
  const built = evaluatePartDocument(slabs).parts[0];
  const top = built.topology.find((f) => f.surfaceType === "PLANE" && f.measurements?.planarNormal?.[2] === 1 && Math.abs((f.measurements?.centerMillimeters?.[2] ?? 0) - 10) < 1e-6)!;
  const face = { sourceFeatureId: "lower", bodyId: id, label: "Lower top", normal: [0, 0, 1] as [number, number, number], faceAnchor: { centerMillimeters: top.measurements!.centerMillimeters as [number, number, number], areaSquareMillimeters: top.measurements!.areaSquareMillimeters as number } };
  expect(total(hole({ depthType: "up-to-face", endReference: face }))).toBeCloseTo(base - 10 * bore, 3);
  // Start from a selected plane at z 25, blind 10: z 25…15: 5 mm of the upper slab.
  expect(total(hole({ startFrom: { kind: "plane", plane: { kind: "principal", plane: "XY", offsetMillimeters: 25 } } }))).toBeCloseTo(base - 5 * bore, 3);
});

it("Revolve: an end offset stops the sweep short of its entity", () => {
  // A 10 × 10 square at x 10…20 on XZ revolved about Z up to a block whose near face is y = 8 (the ring meets it where r·sinθ = 8), with and without an offset.
  const d = doc(
    { id: "bs", type: "profile", name: "Block sketch", plane: "XY", offsetMillimeters: -5, suppressed: false, profile: { type: "drawing", contours: [{ type: "path", id: "b", start: [-5, 8], segments: [{ type: "line", end: [30, 8] }, { type: "line", end: [30, 40] }, { type: "line", end: [-5, 40] }, { type: "line", end: [-5, 8] }] }] } },
    extrude("block", "bs", 20),
    { id: "rs", type: "profile", name: "Ring sketch", plane: "XZ", offsetMillimeters: 0, suppressed: false, profile: { type: "drawing", contours: [{ type: "path", id: "r", start: [10, 0], segments: [{ type: "line", end: [20, 0] }, { type: "line", end: [20, 10] }, { type: "line", end: [10, 10] }, { type: "line", end: [10, 0] }] }] } },
    { id: "pt", type: "profile", name: "Stop point", plane: "XY", offsetMillimeters: 0, suppressed: false, profile: { type: "drawing", contours: [{ type: "circle", id: "up", center: [0, 15], radius: 1 }] } });
  const blockId = bodyIDForFeature(d, d.features[1]);
  const ring = (end: Record<string, unknown>) => { const v = volumes(doc(...d.features, { id: "rev", type: "revolve", name: "Ring", suppressed: false, profileFeatureId: "rs", axis: "Z", angleDegrees: 90, operation: "new", ...end } as PartFeature)); return v[Object.keys(v).find((id) => id !== blockId)!]; };
  const toBlock = ring({ endType: "up-to-part", endPartId: blockId });
  // Offset 2 mm: the block grown by 2 stops the ring where r·sinθ = 6 instead of 8: less volume; a negative offset reaches further.
  const short = ring({ endType: "up-to-part", endPartId: blockId, endOffsetMillimeters: 2 }), long = ring({ endType: "up-to-part", endPartId: blockId, endOffsetMillimeters: -2 });
  expect(short).toBeLessThan(toBlock - 10); expect(long).toBeGreaterThan(toBlock + 10);
  // Up to vertex at (0, 15): a quarter turn; offset 3 mm along that point's arc (radius 15) is 11.46° less.
  const quarter = ring({ endType: "up-to-vertex", endPointReference: { kind: "sketch-point", sourceFeatureId: "pt", contourId: "up", point: "center", label: "Up" } });
  const less = ring({ endType: "up-to-vertex", endPointReference: { kind: "sketch-point", sourceFeatureId: "pt", contourId: "up", point: "center", label: "Up" }, endOffsetMillimeters: 3 });
  expect(less / quarter).toBeCloseTo((90 - 3 / 15 * 180 / Math.PI) / 90, 4);
});

it("Sweep: the path flips to run from its other end, and a thin sweep is a wall around the profile", () => {
  // A 5 mm circle on XY swept along a 40 mm line on XZ from (0,0) up to (0,40); the profile sits at the path's start.
  const d = doc(
    { id: "c", type: "profile", name: "Circle", plane: "XY", offsetMillimeters: 0, suppressed: false, profile: { type: "drawing", contours: [{ type: "circle", id: "k", center: [0, 0], radius: 5 }] } },
    { id: "path", type: "profile", name: "Path", plane: "XZ", offsetMillimeters: 0, suppressed: false, profile: { type: "drawing", contours: [{ id: "p", type: "path", start: [0, 0], segments: [{ type: "line", end: [0, 40] }] }] } });
  // The section radius in a 1 mm slab at the bottom and at the top, from the slab's volume.
  const sweep = (extra: Record<string, unknown>) => { const sd = doc(...d.features, { id: "sw", type: "sweep", name: "Sweep", profileFeatureId: "c", profileContourId: "k", pathFeatureId: "path", operation: "new", suppressed: false, ...extra } as PartFeature); let radii: number[] = []; evaluatePartDocument(sd, { withBodies: (bodies) => { for (const body of bodies.values()) radii = [0.5, 39.5].map((z) => { const slab = (body as Shape3D).intersect(makeBaseBox(200, 200, 1).translate(0, 0, z - 0.5)); return Math.sqrt(measureVolume(slab as Shape3D) / Math.PI); }); } }); return { volume: total(sd), radii }; };
  const plain = sweep({});
  expect(plain.volume).toBeCloseTo(Math.PI * 25 * 40, 1);
  // The scale law runs from the path's start: 5 at the bottom, 10 at the top; reversed, the path starts at the top.
  expect(sweep({ endScale: 2 }).radii.map((r) => Math.round(r * 100) / 100)).toEqual([5.06, 9.94]);
  expect(sweep({ endScale: 2, reversedPath: true }).radii.map((r) => Math.round(r * 100) / 100)).toEqual([9.94, 5.06]);
  // Thin, 1 outside and 2 inside: an annulus 6 … 3 swept 40.
  expect(sweep({ thin: { thickness1Millimeters: 1, thickness2Millimeters: 2 } }).volume).toBeCloseTo(Math.PI * (36 - 9) * 40, 1);
  // Mid plane 2: 6 … 4.
  expect(sweep({ thin: { thickness1Millimeters: 0, thickness2Millimeters: 0, midplane: true, midplaneThicknessMillimeters: 2 } }).volume).toBeCloseTo(Math.PI * (36 - 16) * 40, 1);
});

it("Draft: a parting line keeps its edge and tilts the face below it; a draft carries across tangent faces", () => {
  // A 20 mm cube. Parting line: the top edge at x = 20, pull +Z, flipped to the side face: it pivots about
  // that edge by 10°, so the bottom moves in by 20·tan 10°: a wedge of ½·20·20 tan10° × 20 leaves.
  const cube = doc(rect("a", 0, 0, 20, 20), extrude("cube", "a", 20));
  const id = bodyIDForFeature(cube, cube.features[1]);
  const edge = { kind: "curved-edge" as const, sourceFeatureId: "cube", bodyId: id, label: "Top edge at +X", midpointMillimeters: [20, 10, 20] as [number, number, number], lengthMillimeters: 20 };
  const parting = (extra: Record<string, unknown>) => total(doc(...cube.features, { id: "d", type: "draft", name: "Draft", suppressed: false, mode: "parting-line", pullPlane: { kind: "principal", plane: "XY", offsetMillimeters: 0 }, partingEdges: [edge], angleDegrees: 10, reversed: true, targetBodyId: id, ...extra } as PartFeature));
  const wedge = 0.5 * 20 * 20 * Math.tan(10 * Math.PI / 180) * 20;
  expect(parting({})).toBeCloseTo(8000 - wedge, 2);
  // Two sided with 20° on the far side: the top face would be the far side here, square to the pull, so the kernel refuses rather than guessing.
  expect(() => parting({ sides: "two", secondAngleDegrees: 20 })).toThrow();
  // Tangent propagation (always on in OCCT): a 5 mm fillet on the vertical edge at (20, 20); drafting the +X face
  // about the bottom carries the fillet and the +Y face with it, so more leaves than the +X wedge alone.
  const rounded = doc(...cube.features, { id: "f", type: "fillet", name: "Fillet", suppressed: false, radiusMillimeters: 5, targetBodyId: id, edges: [{ kind: "curved-edge", sourceFeatureId: "cube", bodyId: id, label: "Vertical edge", midpointMillimeters: [20, 20, 10], lengthMillimeters: 20 }] } as PartFeature);
  const built = evaluatePartDocument(rounded).parts[0];
  const plusX = built.topology.find((f) => f.surfaceType === "PLANE" && f.measurements?.planarNormal?.[0] === 1)!;
  const face = { sourceFeatureId: "cube", bodyId: id, label: "+X", normal: [1, 0, 0] as [number, number, number], faceAnchor: { centerMillimeters: plusX.measurements!.centerMillimeters as [number, number, number], areaSquareMillimeters: plusX.measurements!.areaSquareMillimeters as number } };
  const drafted = total(doc(...rounded.features, { id: "d", type: "draft", name: "Draft", suppressed: false, faces: [face], facePlane: { plane: "YZ", offsetMillimeters: 20 }, neutralPlane: { plane: "XY", offsetMillimeters: 0 }, angleDegrees: 10, reversed: false, targetBodyId: id } as PartFeature));
  expect(total(rounded) - drafted).toBeGreaterThan(wedge + 100);
});

it("Loft: sections follow a path, and connections pair the sections' vertices", () => {
  // Two 10 mm squares 30 apart along Z, lofted straight and along a straight path: the same prism.
  const squares = doc(rect("a", -5, -5, 5, 5), rect("b", -5, -5, 5, 5, 30), { id: "path", type: "profile", name: "Path", plane: "XZ", offsetMillimeters: 0, suppressed: false, profile: { type: "drawing", contours: [{ id: "p", type: "path", start: [0, 0], segments: [{ type: "line", end: [0, 30] }] }] } });
  const loftOf = (extra: Record<string, unknown>) => total(doc(...squares.features, { id: "l", type: "loft", name: "Loft", suppressed: false, operation: "new", ruled: false, sections: [{ profileFeatureId: "a" }, { profileFeatureId: "b" }], ...extra } as PartFeature));
  expect(loftOf({})).toBeCloseTo(3000, 1);
  expect(loftOf({ path: { pathFeatureId: "path" } })).toBeCloseTo(3000, 1);
  // Connections pair vertices: drawn squares with vertex ids; pairing each corner with the one above keeps the
  // prism, pairing it with the next corner round twists the loft (a hyperbolic paraboloid skin), losing volume.
  const square = (id: string, z: number): PartFeature => ({ id, type: "profile", name: id, plane: "XY", offsetMillimeters: z, suppressed: false, profile: { type: "drawing", contours: [{ id: `${id}c`, type: "path", start: [-5, -5], startVertexId: `${id}0`, segments: [{ type: "line", end: [5, -5], endVertexId: `${id}1` }, { type: "line", end: [5, 5], endVertexId: `${id}2` }, { type: "line", end: [-5, 5], endVertexId: `${id}3` }, { type: "line", end: [-5, -5], endVertexId: `${id}0` }] }] } });
  const drawn = doc(square("a", 0), square("b", 30));
  const corner = (id: string, i: number) => ({ kind: "sketch-point" as const, sourceFeatureId: id, contourId: `${id}c`, point: "vertex" as const, vertexId: `${id}${i}`, label: `${id}${i}` });
  const lofted = (pairs?: [number, number][]) => total(doc(...drawn.features, { id: "l", type: "loft", name: "Loft", suppressed: false, operation: "new", ruled: true, sections: [{ profileFeatureId: "a", profileContourId: "ac" }, { profileFeatureId: "b", profileContourId: "bc" }], ...(pairs ? { connections: pairs.map(([i, j]) => [corner("a", i), corner("b", j)]) } : {}) } as PartFeature));
  expect(lofted()).toBeCloseTo(3000, 1);
  expect(lofted([[0, 0]])).toBeCloseTo(3000, 1);
  expect(lofted([[0, 1]])).toBeLessThan(2990);
});

it("Sweep: a twist turns the profile about the path", () => {
  // A 10 mm square swept 40 mm along Z with an eighth of a turn: the top section sits at 45°, so a 1 mm slab there spans 10√2 in x.
  const d = doc(rect("sq", -5, -5, 5, 5), { id: "path", type: "profile", name: "Path", plane: "XZ", offsetMillimeters: 0, suppressed: false, profile: { type: "drawing", contours: [{ id: "p", type: "path", start: [0, 0], segments: [{ type: "line", end: [0, 40] }] }] } });
  // The x span of the mesh vertices on the bottom and top faces.
  const spans = (extra: Record<string, unknown>) => { const sd = doc(...d.features, { id: "sw", type: "sweep", name: "Sweep", profileFeatureId: "sq", pathFeatureId: "path", operation: "new", suppressed: false, ...extra } as PartFeature); const v = evaluatePartDocument(sd).parts[0].vertices; const span = (z: number) => { const xs: number[] = []; for (let i = 0; i < v.length; i += 3) if (Math.abs(v[i + 2] - z) < 1e-3) xs.push(v[i]); return Math.max(...xs) - Math.min(...xs); }; return { spans: [span(0), span(40)], volume: total(sd) }; };
  const twisted = spans({ twist: { turns: 0.125 } });
  expect(twisted.volume).toBeCloseTo(4000, 0);
  expect(twisted.spans[0]).toBeCloseTo(10, 1);
  expect(twisted.spans[1]).toBeCloseTo(10 * Math.SQRT2, 1);
});

it("Fillet: points on the edge shape the radius law between the ends", () => {
  // A 40 × 20 × 20 block; the top edge along x at y = 20 filleted 2 mm at both ends and 6 mm in the middle:
  // more material leaves than a constant 2 mm fillet, less than a constant 6 mm one.
  const block = doc(rect("a", 0, 0, 40, 20), extrude("b", "a", 20));
  const id = bodyIDForFeature(block, block.features[1]);
  const edge = { kind: "curved-edge" as const, sourceFeatureId: "b", bodyId: id, label: "Top edge", midpointMillimeters: [20, 20, 20] as [number, number, number], lengthMillimeters: 40 };
  const filleted = (extra: Record<string, unknown>) => total(doc(...block.features, { id: "f", type: "fillet", name: "Fillet", suppressed: false, radiusMillimeters: 2, targetBodyId: id, edges: [edge], ...extra } as PartFeature));
  const two = filleted({}), six = filleted({ radiusMillimeters: 6 }), law = filleted({ endRadiusMillimeters: 2, points: [{ position: 0.5, radiusMillimeters: 6 }] });
  expect(law).toBeLessThan(two - 10);
  expect(law).toBeGreaterThan(six + 10);
});


it("Rib: an open curve becomes a centred wall square to its sketch, up to the part", () => {
  // A 40 × 40 × 5 plate with a 20 mm wall on x = 10…30 at y = 20 (a sketch line 10 above the plate): the rib runs down to the plate.
  const plate = doc(rect("a", 0, 0, 40, 40), extrude("plate", "a", 5), { id: "s", type: "profile", name: "Rib sketch", plane: "XY", offsetMillimeters: 15, suppressed: false, profile: { type: "drawing", contours: [{ id: "L", type: "path", start: [10, 20], segments: [{ id: "seg", type: "line", end: [30, 20] }] }] } });
  const id = bodyIDForFeature(plate, plate.features[1]);
  const ribbed = doc(...plate.features, { id: "r", type: "rib", name: "Rib", suppressed: false, profileFeatureId: "s", targetBodyId: id, thicknessMillimeters: 2, reversed: true } as PartFeature);
  // 20 long × 2 thick × 10 tall, merged into the plate.
  expect(total(ribbed)).toBeCloseTo(8000 + 400, 2);
  expect(evaluatePartDocument(ribbed).parts).toHaveLength(1);
  // The other way there is no part to meet: refused.
  expect(() => total(doc(...plate.features, { id: "r", type: "rib", name: "Rib", suppressed: false, profileFeatureId: "s", targetBodyId: id, thicknessMillimeters: 2 } as PartFeature))).toThrow();
});

it("Thread: the chamfer, undercut and split face change the cylinder; the size can come from its diameter", () => {
  // A Ø10 × 30 post standing on a 40 × 40 × 5 plate: the thread face is the post's cylinder, starting at its free top end.
  const d = doc(rect("a", 0, 0, 40, 40), extrude("plate", "a", 5), { id: "c", type: "profile", name: "Post", plane: "XY", offsetMillimeters: 5, suppressed: false, profile: { type: "circle", radiusMillimeters: 5, centerMillimeters: [20, 20] } }, extrude("post", "c", 30, "add"));
  const id = bodyIDForFeature(d, d.features[1]);
  const built = evaluatePartDocument(d).parts[0];
  const cylinder = built.topology.find((f) => f.surfaceType === "CYLINDER")!;
  const face = { sourceFeatureId: "post", bodyId: id, label: "Post face", surfaceType: "cylinder" as const, faceAnchor: { centerMillimeters: cylinder.measurements!.centerMillimeters as [number, number, number], areaSquareMillimeters: cylinder.measurements!.areaSquareMillimeters as number } };
  const base = total(d);
  const thread = (extra: Record<string, unknown>) => doc(...d.features, { id: "t", type: "thread", name: "Thread", suppressed: false, face, standard: "iso-metric-coarse", designation: "M10", lengthMillimeters: 20, targetBodyId: id, ...extra } as PartFeature);
  // Cosmetic: nothing changes.
  expect(total(thread({}))).toBeCloseTo(base, 6);
  // A 1 mm × 45° chamfer on the top rim takes a ring of triangular section: 2π·(5 − 1/3)·(1·1/2).
  expect(base - total(thread({ chamfer: { distanceMillimeters: 1, angleDegrees: 45 } }))).toBeCloseTo(2 * Math.PI * (5 - 1 / 3) * 0.5, 2);
  // An undercut to Ø8 over 2 mm at the thread's end (20 down from the top): π(25 − 16)·2.
  expect(base - total(thread({ undercut: { diameterMillimeters: 8, lengthMillimeters: 2 } }))).toBeCloseTo(Math.PI * 9 * 2, 2);
  // The split face adds a face without changing the volume.
  const split = evaluatePartDocument(thread({ splitFace: true })).parts[0];
  expect(total(thread({ splitFace: true }))).toBeCloseTo(base, 6);
  expect(split.topology.filter((f) => f.surfaceType === "CYLINDER").length).toBe(2);
  // Size from the face: the window resolves the designation; the record stays cosmetic.
  expect(total(thread({ sizeFromFace: true }))).toBeCloseTo(base, 6);
});
