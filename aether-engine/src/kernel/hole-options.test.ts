/** FreeCAD Hole options on the Aether engine: standard threads (tap drill or
 *  clearance), counterdrill, drill point, taper and a modelled thread. Volumes
 *  are checked analytically; no reference engine is needed. */
import { beforeAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import init from "replicad-opencascadejs";
import { measureVolume, setOC, type Shape3D } from "replicad";
import { evaluatePartDocument } from "./part-evaluator";
import { createRectanglePartDocument, parsePartDocument, serializePartDocument, type HoleFeature, type PartDocument } from "../document/index";
import { threadSpecification } from "../document/hole-standards";

beforeAll(async () => {
  setOC(await (init as any)({ wasmBinary: readFileSync(new URL("../../node_modules/replicad-opencascadejs/src/replicad_single.wasm", import.meta.url)) }));
}, 30000);

const box = () => createRectanglePartDocument("Hole options", { widthMillimeters: 40, heightMillimeters: 30, depthMillimeters: 20 });
const BOX_VOLUME = 40 * 30 * 20;
const volume = (document: PartDocument) => { let v = 0; evaluatePartDocument(document, { withBodies: (bodies) => { for (const body of bodies.values()) v += measureVolume(body as Shape3D); } }); return v; };
const faces = (document: PartDocument) => evaluatePartDocument(document).parts[0].topology.length;
/** A hole from a sketch circle at the top-face centre; `hole` overrides the defaults. */
const withHole = (hole: Partial<HoleFeature>): PartDocument => {
  const base = box();
  return { ...base, features: [...base.features,
    { id: "c", type: "profile", name: "Centre", plane: "XY", offsetMillimeters: 20, suppressed: false, profile: { type: "circle", radiusMillimeters: 1, centerMillimeters: [0, 0] } },
    { id: "h", type: "hole", name: "Hole", suppressed: false, profileFeatureId: "c", diameterMillimeters: 6.8, depthMillimeters: 12, depthType: "blind", cutType: "plain", ...hole } as HoleFeature,
  ] };
};
const cylinder = (diameter: number, height: number) => Math.PI * (diameter / 2) ** 2 * height;
const cone = (topRadius: number, bottomRadius: number, height: number) => Math.PI * height / 3 * (topRadius ** 2 + topRadius * bottomRadius + bottomRadius ** 2);

it("drills a tapped hole at the tap drill and a clearance hole at the fit, and reopens both", () => {
  const tapped = withHole({ thread: { standard: "iso-metric-coarse", designation: "M8", tapped: true } });
  expect(BOX_VOLUME - volume(tapped)).toBeCloseTo(cylinder(6.8, 12), 3);
  const clearance = withHole({ diameterMillimeters: 9, thread: { standard: "iso-metric-coarse", designation: "M8", tapped: false, fit: "normal" } });
  expect(BOX_VOLUME - volume(clearance)).toBeCloseTo(cylinder(9, 12), 3);
  const reopened = parsePartDocument(serializePartDocument(tapped));
  expect((reopened.features[3] as HoleFeature).thread).toEqual({ standard: "iso-metric-coarse", designation: "M8", tapped: true });
  // A tapped hole drilled at or over the major diameter is refused before any geometry.
  expect(() => parsePartDocument(serializePartDocument(withHole({ diameterMillimeters: 8, thread: { standard: "iso-metric-coarse", designation: "M8", tapped: true } })))).toThrow(/drilled under 8 mm/);
  expect(() => parsePartDocument(serializePartDocument(withHole({ thread: { standard: "unc", designation: "M8", tapped: true } })))).toThrow(/Unknown unc thread size/);
}, 30000);

it("cuts a counterdrill: a counterbore whose floor is the countersink cone", () => {
  const counterdrill = withHole({ cutType: "counterdrill", counterDiameterMillimeters: 12, counterDepthMillimeters: 3, countersinkAngleDegrees: 90 });
  const coneHeight = (12 - 6.8) / 2 / Math.tan(Math.PI / 4);
  const expected = cylinder(6.8, 12) + (cylinder(12, 3) - cylinder(6.8, 3)) + (cone(6, 3.4, coneHeight) - cylinder(6.8, coneHeight));
  expect(BOX_VOLUME - volume(counterdrill)).toBeCloseTo(expected, 3);
}, 30000);

it("adds a drill-point cone under a blind depth and ignores it through all", () => {
  const pointed = withHole({ drillPoint: "angled", drillPointAngleDegrees: 118 });
  const tip = 3.4 / Math.tan((118 / 2) * Math.PI / 180);
  expect(BOX_VOLUME - volume(pointed)).toBeCloseTo(cylinder(6.8, 12) + cone(3.4, 0, tip), 3);
  const through = withHole({ depthType: "through-all", drillPoint: "angled" });
  expect(BOX_VOLUME - volume(through)).toBeCloseTo(cylinder(6.8, 20), 3);
}, 30000);

it("tapers the wall by the half-angle and refuses a taper that closes before the depth", () => {
  const tapered = withHole({ taperAngleDegrees: 5 });
  const bottom = 3.4 - 12 * Math.tan(5 * Math.PI / 180);
  expect(BOX_VOLUME - volume(tapered)).toBeCloseTo(cone(3.4, bottom, 12), 3);
  expect(() => parsePartDocument(serializePartDocument(withHole({ taperAngleDegrees: 20 })))).toThrow(/closes the hole/);
}, 30000);

it("models an M8 thread as a helical groove between the tap drill and the major diameter", () => {
  const plain = withHole({ thread: { standard: "iso-metric-coarse", designation: "M8", tapped: true } });
  const modeled = withHole({ thread: { standard: "iso-metric-coarse", designation: "M8", tapped: true, modeled: true } });
  const removedPlain = BOX_VOLUME - volume(plain), removedModeled = BOX_VOLUME - volume(modeled);
  // The groove removes more than the tap drill alone and less than a hole at the major diameter.
  expect(removedModeled).toBeGreaterThan(removedPlain + 1);
  expect(removedModeled).toBeLessThan(cylinder(8, 12) + 5);
  // Its flanks add faces to the part; the plain hole adds only the wall and floor.
  expect(faces(modeled)).toBeGreaterThan(faces(plain));
  const spec = threadSpecification("iso-metric-coarse", "M8")!;
  expect(spec.pitchMillimeters).toBe(1.25);
  // Half the thread depth threads only the upper half of the hole.
  const shallow = withHole({ thread: { standard: "iso-metric-coarse", designation: "M8", tapped: true, modeled: true, depthMillimeters: 6 } });
  const removedShallow = BOX_VOLUME - volume(shallow);
  expect(removedShallow).toBeGreaterThan(removedPlain + 0.5);
  expect(removedShallow).toBeLessThan(removedModeled);
}, 120000);
