/** Standard parts (SolidCraft's parts.library / parts.insert / parts.fastener / parts.resize):
 *  ISO metric fasteners, dowel pins and deep-groove ball bearings. Each size generates an
 *  ordinary part document (sketch profiles and extrusions on +Z), so it evaluates, exports
 *  and edits like any other part. Threads are not modelled; the shank is the nominal
 *  diameter. Fasteners stand on the XY plane with the axis along +Z: bolts and screws have
 *  the shank tip at the origin and the underside of the head at z = length. Cuts are
 *  drawn on the top face they start from: a cut extrudes into the material, toward −Z. */
import { createEmptyPartDocument, type PartDocument, type PartFeature } from "./part-document";

export type StandardPartFamily = "socket_head_cap_screw" | "hex_bolt" | "hex_nut" | "washer" | "set_screw" | "dowel_pin" | "bearing";
interface FamilySpec {
  name: string; standard: string; lengths?: number[];
  /** Per size: the dimensions in mm the generator reads. */
  sizes: Record<string, Record<string, number>>;
}
const metric = ["M3", "M4", "M5", "M6", "M8", "M10", "M12"];
const zip = (keys: string[], rows: number[][]) => Object.fromEntries(metric.map((m, i) => [m, Object.fromEntries(keys.map((k, j) => [k, rows[i][j]]))]));
export const STANDARD_PARTS: Readonly<Record<StandardPartFamily, FamilySpec>> = Object.freeze({
  socket_head_cap_screw: { name: "Socket head cap screw", standard: "ISO 4762", lengths: [6, 8, 10, 12, 16, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 100],
    sizes: zip(["d", "dk", "k", "s", "t"], [[3, 5.5, 3, 2.5, 1.3], [4, 7, 4, 3, 2], [5, 8.5, 5, 4, 2.5], [6, 10, 6, 5, 3], [8, 13, 8, 6, 4], [10, 16, 10, 8, 5], [12, 18, 12, 10, 6]]) },
  hex_bolt: { name: "Hex head bolt", standard: "ISO 4017", lengths: [6, 8, 10, 12, 16, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 100],
    sizes: zip(["d", "s", "k"], [[3, 5.5, 2], [4, 7, 2.8], [5, 8, 3.5], [6, 10, 4], [8, 13, 5.3], [10, 16, 6.4], [12, 18, 7.5]]) },
  hex_nut: { name: "Hex nut", standard: "ISO 4032",
    sizes: zip(["d", "s", "m"], [[3, 5.5, 2.4], [4, 7, 3.2], [5, 8, 4.7], [6, 10, 5.2], [8, 13, 6.8], [10, 16, 8.4], [12, 18, 10.8]]) },
  washer: { name: "Plain washer", standard: "ISO 7089",
    sizes: zip(["d1", "d2", "h"], [[3.2, 7, 0.5], [4.3, 9, 0.8], [5.3, 10, 1], [6.4, 12, 1.6], [8.4, 16, 1.6], [10.5, 20, 2], [13, 24, 2.5]]) },
  set_screw: { name: "Hex socket set screw, flat point", standard: "ISO 4026", lengths: [3, 4, 5, 6, 8, 10, 12, 16, 20, 25],
    sizes: zip(["d", "s", "t"], [[3, 1.5, 1.2], [4, 2, 1.5], [5, 2.5, 2], [6, 3, 2], [8, 4, 3], [10, 5, 4], [12, 6, 4.8]]) },
  dowel_pin: { name: "Dowel pin", standard: "ISO 8734", lengths: [6, 8, 10, 12, 16, 20, 24, 30, 40, 50],
    sizes: Object.fromEntries([3, 4, 5, 6, 8, 10, 12].map((d) => [`${d}`, { d }])) },
  bearing: { name: "Deep groove ball bearing", standard: "ISO 15",
    sizes: { "623": { d: 3, D: 10, B: 4 }, "625": { d: 5, D: 16, B: 5 }, "608": { d: 8, D: 22, B: 7 }, "6000": { d: 10, D: 26, B: 8 }, "6001": { d: 12, D: 28, B: 8 }, "6200": { d: 10, D: 30, B: 9 }, "6201": { d: 12, D: 32, B: 10 }, "6202": { d: 15, D: 35, B: 11 }, "6203": { d: 17, D: 40, B: 12 } } },
});
const needsLength = (family: StandardPartFamily) => Boolean(STANDARD_PARTS[family].lengths);

export interface StandardPartRequest { family: StandardPartFamily; size: string; length?: number }
export function standardPartIssues(request: StandardPartRequest): string[] {
  const spec = STANDARD_PARTS[request.family];
  if (!spec) return [`No standard part family ${String(request.family)}.`];
  if (!spec.sizes[request.size]) return [`${spec.name} comes in ${Object.keys(spec.sizes).join(", ")}.`];
  if (needsLength(request.family) && !(Number.isFinite(request.length) && (request.length as number) > 0 && (request.length as number) <= 500)) return [`${spec.name} needs a length between 0 and 500 mm.`];
  return [];
}
/** The catalogue, as parts.library lists it. */
export function standardPartLibrary(family?: StandardPartFamily) {
  const entries = (Object.entries(STANDARD_PARTS) as [StandardPartFamily, FamilySpec][]).filter(([id]) => !family || id === family);
  return entries.map(([id, spec]) => ({ family: id, name: spec.name, standard: spec.standard, sizes: Object.keys(spec.sizes), lengths: spec.lengths ?? null, ...(family ? { dimensions: spec.sizes } : {}) }));
}
export const standardPartLabel = (r: StandardPartRequest) => `${STANDARD_PARTS[r.family].standard} ${r.family === "dowel_pin" ? `Ø${r.size}` : r.size}${needsLength(r.family) ? ` × ${r.length}` : ""}`;

const hexagon = (s: number): [number, number][] => { const R = s / Math.sqrt(3); return Array.from({ length: 6 }, (_, i) => [R * Math.cos((i * Math.PI) / 3), R * Math.sin((i * Math.PI) / 3)] as [number, number]); };
/** Volume in mm³ from the same dimensions (for the BOM mass at steel's 7850 kg/m³). */
export function standardPartVolume(r: StandardPartRequest): number {
  const v = STANDARD_PARTS[r.family].sizes[r.size], L = r.length ?? 0, hex = (s: number) => (Math.sqrt(3) / 2) * s * s, disc = (d: number) => Math.PI * d * d / 4;
  switch (r.family) {
    case "socket_head_cap_screw": return disc(v.d) * L + disc(v.dk) * v.k - hex(v.s) * v.t;
    case "hex_bolt": return disc(v.d) * L + hex(v.s) * v.k;
    case "hex_nut": return (hex(v.s) - disc(v.d)) * v.m;
    case "washer": return (disc(v.d2) - disc(v.d1)) * v.h;
    case "set_screw": return disc(v.d) * L - hex(v.s) * v.t;
    case "dowel_pin": return disc(v.d) * L;
    case "bearing": return (disc(v.D) - disc(v.d)) * v.B;
  }
}
/** The part document for a standard part. */
export function standardPartDocument(r: StandardPartRequest): PartDocument {
  const issues = standardPartIssues(r);
  if (issues.length) throw new Error(issues.join(" "));
  const v = STANDARD_PARTS[r.family].sizes[r.size], L = r.length ?? 0;
  const doc = createEmptyPartDocument(standardPartLabel(r));
  let n = 0;
  const profile = (name: string, at: number, shape: { type: "circle"; d: number } | { type: "hex"; s: number }) => {
    const id = `${r.family}-p${++n}`;
    doc.features.push({ id, type: "profile", name, plane: "XY", offsetMillimeters: at, suppressed: false,
      profile: shape.type === "circle" ? { type: "circle", radiusMillimeters: shape.d / 2, centerMillimeters: [0, 0] } : { type: "polygon", pointsMillimeters: hexagon(shape.s) } } as PartFeature);
    return id;
  };
  const extrude = (name: string, profileId: string, distance: number, operation: "new" | "add" | "cut") =>
    doc.features.push({ id: `${r.family}-e${++n}`, type: "extrude", name, profileFeatureId: profileId, distanceMillimeters: distance, operation, suppressed: false } as PartFeature);
  switch (r.family) {
    case "socket_head_cap_screw":
      extrude("Shank", profile("Shank", 0, { type: "circle", d: v.d }), L, "new");
      extrude("Head", profile("Head", L, { type: "circle", d: v.dk }), v.k, "add");
      extrude("Socket", profile("Socket", L + v.k, { type: "hex", s: v.s }), v.t, "cut");
      break;
    case "hex_bolt":
      extrude("Shank", profile("Shank", 0, { type: "circle", d: v.d }), L, "new");
      extrude("Head", profile("Head", L, { type: "hex", s: v.s }), v.k, "add");
      break;
    case "hex_nut":
      extrude("Body", profile("Body", 0, { type: "hex", s: v.s }), v.m, "new");
      extrude("Bore", profile("Bore", v.m, { type: "circle", d: v.d }), v.m, "cut");
      break;
    case "washer":
      extrude("Disc", profile("Disc", 0, { type: "circle", d: v.d2 }), v.h, "new");
      extrude("Bore", profile("Bore", v.h, { type: "circle", d: v.d1 }), v.h, "cut");
      break;
    case "set_screw":
      extrude("Body", profile("Body", 0, { type: "circle", d: v.d }), L, "new");
      extrude("Socket", profile("Socket", L, { type: "hex", s: v.s }), v.t, "cut");
      break;
    case "dowel_pin":
      extrude("Pin", profile("Pin", 0, { type: "circle", d: v.d }), L, "new");
      break;
    case "bearing":
      extrude("Outer ring", profile("Outer", 0, { type: "circle", d: v.D }), v.B, "new");
      extrude("Bore", profile("Bore", v.B, { type: "circle", d: v.d }), v.B, "cut");
      break;
  }
  return doc;
}
/** Custom properties that mark an inserted part as standard, so it can be resized. */
export const standardPartProperties = (r: StandardPartRequest) => [
  { key: "standard_part_family", value: r.family }, { key: "standard_part_size", value: r.size },
  ...(r.length !== undefined && needsLength(r.family) ? [{ key: "standard_part_length", value: String(r.length) }] : []),
];
export function standardPartFromProperties(properties: readonly { key: string; value: string }[]): StandardPartRequest | null {
  const get = (k: string) => properties.find((p) => p.key === k)?.value;
  const family = get("standard_part_family") as StandardPartFamily | undefined, size = get("standard_part_size"), length = get("standard_part_length");
  return family && size && STANDARD_PARTS[family] ? { family, size, ...(length ? { length: Number(length) } : {}) } : null;
}
