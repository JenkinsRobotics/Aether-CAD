/** Standard parts (SolidCraft's parts.library / parts.insert / parts.fastener / parts.resize / parts.seats):
 *  ISO metric (M2–M30) & ASME/ANSI inch UNC fasteners, dowel pins, and deep-groove ball bearings.
 *  Each size generates an ordinary editable PartDocument (sketch profiles + extrusions on +Z). */
import { createEmptyPartDocument, type PartDocument, type PartFeature } from "./part-document";
import type { FaceTopologyData } from "../contracts/geometry";

export type StandardPartFamily =
  | "socket_head_cap_screw"
  | "button_head_screw"
  | "countersunk_screw"
  | "hex_bolt"
  | "hex_nut"
  | "washer"
  | "set_screw"
  | "dowel_pin"
  | "bearing"
  | "asme_hex_bolt"
  | "asme_socket_screw"
  | "asme_hex_nut"
  | "asme_washer";

interface FamilySpec {
  name: string;
  standard: string;
  lengths?: number[];
  /** Per size: the dimensions in mm the generator reads. */
  sizes: Record<string, Record<string, number>>;
}

const metric = ["M2", "M2.5", "M3", "M4", "M5", "M6", "M8", "M10", "M12", "M14", "M16", "M20", "M24", "M30"];
const zip = (names: string[], keys: string[], rows: number[][]) =>
  Object.fromEntries(names.map((m, i) => [m, Object.fromEntries(keys.map((k, j) => [k, rows[i][j]]))]));

const inchSizes = ["#6-32", "#8-32", "#10-24", "1/4-20", "5/16-18", "3/8-16", "1/2-13"];
const IN = 25.4;

export const STANDARD_PARTS: Readonly<Record<StandardPartFamily, FamilySpec>> = Object.freeze({
  socket_head_cap_screw: {
    name: "Socket head cap screw",
    standard: "ISO 4762",
    lengths: [4, 5, 6, 8, 10, 12, 16, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 100, 120, 150],
    sizes: zip(metric, ["d", "dk", "k", "s", "t"], [
      [2, 3.8, 2, 1.5, 1.0], [2.5, 4.5, 2.5, 2, 1.1], [3, 5.5, 3, 2.5, 1.3], [4, 7, 4, 3, 2],
      [5, 8.5, 5, 4, 2.5], [6, 10, 6, 5, 3], [8, 13, 8, 6, 4], [10, 16, 10, 8, 5],
      [12, 18, 12, 10, 6], [14, 21, 14, 12, 7], [16, 24, 16, 14, 8], [20, 30, 20, 17, 10],
      [24, 36, 24, 19, 12], [30, 45, 30, 22, 15],
    ]),
  },
  button_head_screw: {
    name: "Hex socket button head screw",
    standard: "ISO 7380-1",
    lengths: [4, 5, 6, 8, 10, 12, 16, 20, 25, 30, 35, 40, 50],
    sizes: zip(metric, ["d", "dk", "k", "s", "t"], [
      [2, 3.5, 1.3, 1.3, 0.7], [2.5, 4.5, 1.5, 1.5, 0.8], [3, 5.7, 1.65, 2, 1.04], [4, 7.6, 2.2, 2.5, 1.3],
      [5, 9.5, 2.75, 3, 1.56], [6, 10.5, 3.3, 4, 2.08], [8, 14, 4.4, 5, 2.6], [10, 17.5, 5.5, 6, 3.12],
      [12, 21, 6.6, 8, 4.16], [14, 24.5, 7.7, 10, 5.0], [16, 28, 8.8, 10, 5.2], [20, 35, 11, 12, 6.2],
      [24, 42, 13.2, 14, 7.2], [30, 52, 16.5, 17, 9.0],
    ]),
  },
  countersunk_screw: {
    name: "Hex socket countersunk flat head screw",
    standard: "ISO 10642",
    lengths: [6, 8, 10, 12, 16, 20, 25, 30, 35, 40, 50, 60],
    sizes: zip(metric, ["d", "dk", "k", "s", "t"], [
      [2, 4, 1.2, 1.3, 0.7], [2.5, 5, 1.5, 1.5, 0.9], [3, 6, 1.7, 2, 1.1], [4, 8, 2.3, 2.5, 1.5],
      [5, 10, 2.8, 3, 1.9], [6, 12, 3.3, 4, 2.2], [8, 16, 4.4, 5, 3.0], [10, 20, 5.5, 6, 3.6],
      [12, 24, 6.5, 8, 4.3], [14, 27, 7.0, 10, 4.5], [16, 30, 7.5, 10, 4.8], [20, 36, 8.5, 12, 5.6],
      [24, 39, 10, 14, 6.4], [30, 48, 12, 17, 8.0],
    ]),
  },
  hex_bolt: {
    name: "Hex head bolt",
    standard: "ISO 4017",
    lengths: [6, 8, 10, 12, 16, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 100, 120, 150],
    sizes: zip(metric, ["d", "s", "k"], [
      [2, 4, 1.4], [2.5, 5, 1.7], [3, 5.5, 2], [4, 7, 2.8], [5, 8, 3.5], [6, 10, 4], [8, 13, 5.3],
      [10, 16, 6.4], [12, 18, 7.5], [14, 21, 8.8], [16, 24, 10], [20, 30, 12.5], [24, 36, 15], [30, 46, 18.7],
    ]),
  },
  hex_nut: {
    name: "Hex nut",
    standard: "ISO 4032",
    sizes: zip(metric, ["d", "s", "m"], [
      [2, 4, 1.6], [2.5, 5, 2.0], [3, 5.5, 2.4], [4, 7, 3.2], [5, 8, 4.7], [6, 10, 5.2], [8, 13, 6.8],
      [10, 16, 8.4], [12, 18, 10.8], [14, 21, 12.8], [16, 24, 14.8], [20, 30, 18], [24, 36, 21.5], [30, 46, 25.6],
    ]),
  },
  washer: {
    name: "Plain washer",
    standard: "ISO 7089",
    sizes: zip(metric, ["d1", "d2", "h"], [
      [2.2, 5, 0.3], [2.7, 6, 0.5], [3.2, 7, 0.5], [4.3, 9, 0.8], [5.3, 10, 1], [6.4, 12, 1.6], [8.4, 16, 1.6],
      [10.5, 20, 2], [13, 24, 2.5], [15, 28, 2.5], [17, 30, 3], [21, 37, 3], [25, 44, 4], [31, 56, 4],
    ]),
  },
  set_screw: {
    name: "Hex socket set screw, flat point",
    standard: "ISO 4026",
    lengths: [3, 4, 5, 6, 8, 10, 12, 16, 20, 25, 30],
    sizes: zip(metric, ["d", "s", "t"], [
      [2, 0.9, 0.8], [2.5, 1.3, 1.0], [3, 1.5, 1.2], [4, 2, 1.5], [5, 2.5, 2], [6, 3, 2], [8, 4, 3],
      [10, 5, 4], [12, 6, 4.8], [14, 6, 5.5], [16, 8, 6.4], [20, 10, 8], [24, 12, 10], [30, 14, 12],
    ]),
  },
  dowel_pin: {
    name: "Dowel pin",
    standard: "ISO 8734",
    lengths: [6, 8, 10, 12, 16, 20, 24, 30, 40, 50, 60, 80],
    sizes: Object.fromEntries([2, 2.5, 3, 4, 5, 6, 8, 10, 12, 14, 16, 20, 24, 30].map((d) => [`${d}`, { d }])),
  },
  bearing: {
    name: "Deep groove ball bearing",
    standard: "ISO 15",
    sizes: {
      "623": { d: 3, D: 10, B: 4 }, "625": { d: 5, D: 16, B: 5 }, "608": { d: 8, D: 22, B: 7 },
      "6000": { d: 10, D: 26, B: 8 }, "6001": { d: 12, D: 28, B: 8 }, "6200": { d: 10, D: 30, B: 9 },
      "6201": { d: 12, D: 32, B: 10 }, "6202": { d: 15, D: 35, B: 11 }, "6203": { d: 17, D: 40, B: 12 },
      "6204": { d: 20, D: 47, B: 14 }, "6205": { d: 25, D: 52, B: 15 }, "6206": { d: 30, D: 62, B: 16 },
    },
  },
  asme_hex_bolt: {
    name: "ASME UNC hex cap screw",
    standard: "ASME B18.2.1",
    lengths: [6.35, 9.525, 12.7, 15.875, 19.05, 25.4, 31.75, 38.1, 50.8, 63.5, 76.2],
    sizes: zip(inchSizes, ["d", "s", "k"], [
      [0.138 * IN, 0.25 * IN, 0.094 * IN],
      [0.164 * IN, 0.25 * IN, 0.11 * IN],
      [0.19 * IN, 0.3125 * IN, 0.125 * IN],
      [0.25 * IN, 0.4375 * IN, 0.163 * IN],
      [0.3125 * IN, 0.5 * IN, 0.211 * IN],
      [0.375 * IN, 0.5625 * IN, 0.243 * IN],
      [0.5 * IN, 0.75 * IN, 0.323 * IN],
    ]),
  },
  asme_socket_screw: {
    name: "ASME UNC socket head cap screw",
    standard: "ASME B18.3",
    lengths: [6.35, 9.525, 12.7, 15.875, 19.05, 25.4, 31.75, 38.1, 50.8, 63.5, 76.2],
    sizes: zip(inchSizes, ["d", "dk", "k", "s", "t"], [
      [0.138 * IN, 0.226 * IN, 0.138 * IN, 0.109 * IN, 0.068 * IN],
      [0.164 * IN, 0.27 * IN, 0.164 * IN, 0.141 * IN, 0.08 * IN],
      [0.19 * IN, 0.312 * IN, 0.19 * IN, 0.156 * IN, 0.095 * IN],
      [0.25 * IN, 0.375 * IN, 0.25 * IN, 0.1875 * IN, 0.12 * IN],
      [0.3125 * IN, 0.469 * IN, 0.3125 * IN, 0.25 * IN, 0.151 * IN],
      [0.375 * IN, 0.562 * IN, 0.375 * IN, 0.3125 * IN, 0.182 * IN],
      [0.5 * IN, 0.75 * IN, 0.5 * IN, 0.375 * IN, 0.245 * IN],
    ]),
  },
  asme_hex_nut: {
    name: "ASME UNC hex nut",
    standard: "ASME B18.2.2",
    sizes: zip(inchSizes, ["d", "s", "m"], [
      [0.138 * IN, 0.3125 * IN, 0.114 * IN],
      [0.164 * IN, 0.34375 * IN, 0.13 * IN],
      [0.19 * IN, 0.375 * IN, 0.13 * IN],
      [0.25 * IN, 0.4375 * IN, 0.226 * IN],
      [0.3125 * IN, 0.5 * IN, 0.273 * IN],
      [0.375 * IN, 0.5625 * IN, 0.337 * IN],
      [0.5 * IN, 0.75 * IN, 0.448 * IN],
    ]),
  },
  asme_washer: {
    name: "ASME plain flat washer",
    standard: "ASME B18.21.1",
    sizes: zip(inchSizes, ["d1", "d2", "h"], [
      [0.156 * IN, 0.375 * IN, 0.049 * IN],
      [0.188 * IN, 0.438 * IN, 0.049 * IN],
      [0.219 * IN, 0.5 * IN, 0.049 * IN],
      [0.281 * IN, 0.625 * IN, 0.065 * IN],
      [0.344 * IN, 0.688 * IN, 0.065 * IN],
      [0.406 * IN, 0.812 * IN, 0.065 * IN],
      [0.531 * IN, 1.062 * IN, 0.095 * IN],
    ]),
  },
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

/** The catalogue, as `parts.library` lists it. */
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
    case "socket_head_cap_screw":
    case "button_head_screw":
    case "asme_socket_screw":
      return disc(v.d) * L + disc(v.dk) * v.k - hex(v.s) * v.t;
    case "countersunk_screw": {
      const r1 = v.d / 2, r2 = v.dk / 2;
      const frustum = (Math.PI * v.k / 3) * (r1 * r1 + r1 * r2 + r2 * r2);
      return disc(v.d) * Math.max(0, L - v.k) + frustum - hex(v.s) * v.t;
    }
    case "hex_bolt":
    case "asme_hex_bolt":
      return disc(v.d) * L + hex(v.s) * v.k;
    case "hex_nut":
    case "asme_hex_nut":
      return (hex(v.s) - disc(v.d)) * v.m;
    case "washer":
    case "asme_washer":
      return (disc(v.d2) - disc(v.d1)) * v.h;
    case "set_screw": return disc(v.d) * L - hex(v.s) * v.t;
    case "dowel_pin": return disc(v.d) * L;
    case "bearing": return (disc(v.D) - disc(v.d)) * v.B;
  }
}

/** The editable PartDocument for a standard part. */
export function standardPartDocument(r: StandardPartRequest): PartDocument {
  const issues = standardPartIssues(r);
  if (issues.length) throw new Error(issues.join(" "));
  const v = STANDARD_PARTS[r.family].sizes[r.size], L = r.length ?? 0;
  const doc = createEmptyPartDocument(standardPartLabel(r));
  let n = 0;
  const profile = (name: string, at: number, shape: { type: "circle"; d: number } | { type: "hex"; s: number }) => {
    const id = `${r.family}-p${++n}`;
    doc.features.push({
      id, type: "profile", name, plane: "XY", offsetMillimeters: at, suppressed: false,
      profile: shape.type === "circle" ? { type: "circle", radiusMillimeters: shape.d / 2, centerMillimeters: [0, 0] } : { type: "polygon", pointsMillimeters: hexagon(shape.s) },
    } as PartFeature);
    return id;
  };
  const extrude = (name: string, profileId: string, distance: number, operation: "new" | "add" | "cut") =>
    doc.features.push({ id: `${r.family}-e${++n}`, type: "extrude", name, profileFeatureId: profileId, distanceMillimeters: distance, operation, suppressed: false } as PartFeature);

  switch (r.family) {
    case "socket_head_cap_screw":
    case "button_head_screw":
    case "asme_socket_screw":
      extrude("Shank", profile("Shank", 0, { type: "circle", d: v.d }), L, "new");
      extrude("Head", profile("Head", L, { type: "circle", d: v.dk }), v.k, "add");
      extrude("Socket", profile("Socket", L + v.k, { type: "hex", s: v.s }), v.t, "cut");
      break;
    case "countersunk_screw": {
      const shankL = Math.max(0.5, L - v.k);
      extrude("Shank", profile("Shank", 0, { type: "circle", d: v.d }), shankL, "new");
      const baseP = profile("HeadBase", shankL, { type: "circle", d: v.d });
      const topP = profile("HeadTop", shankL + v.k, { type: "circle", d: v.dk });
      doc.features.push({ id: `${r.family}-l${++n}`, type: "loft", name: "Countersunk Head", sections: [{ profileFeatureId: baseP }, { profileFeatureId: topP }], ruled: true, operation: "add", suppressed: false } as PartFeature);
      extrude("Socket", profile("Socket", shankL + v.k, { type: "hex", s: v.s }), v.t, "cut");
      break;
    }
    case "hex_bolt":
    case "asme_hex_bolt":
      extrude("Shank", profile("Shank", 0, { type: "circle", d: v.d }), L, "new");
      extrude("Head", profile("Head", L, { type: "hex", s: v.s }), v.k, "add");
      break;
    case "hex_nut":
    case "asme_hex_nut":
      extrude("Body", profile("Body", 0, { type: "hex", s: v.s }), v.m, "new");
      extrude("Bore", profile("Bore", v.m, { type: "circle", d: v.d }), v.m, "cut");
      break;
    case "washer":
    case "asme_washer":
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

export interface FastenerSeat {
  faceId: number;
  originMillimeters: [number, number, number];
  axisDirection: [number, number, number];
  boreDiameterMillimeters: number;
  depthMillimeters?: number;
  recommendedMetricSize?: string;
  recommendedInchSize?: string;
}

const METRIC_CLEARANCE_D: readonly [string, number][] = [
  ["M2", 2.0], ["M2.5", 2.5], ["M3", 3.0], ["M4", 4.0], ["M5", 5.0], ["M6", 6.0],
  ["M8", 8.0], ["M10", 10.0], ["M12", 12.0], ["M14", 14.0], ["M16", 16.0], ["M20", 20.0],
  ["M24", 24.0], ["M30", 30.0],
];

const INCH_CLEARANCE_D: readonly [string, number][] = [
  ["#6-32", 0.138 * IN], ["#8-32", 0.164 * IN], ["#10-24", 0.19 * IN],
  ["1/4-20", 0.25 * IN], ["5/16-18", 0.3125 * IN], ["3/8-16", 0.375 * IN], ["1/2-13", 0.5 * IN],
];

function nearestStandardSize(diameterMm: number, table: readonly [string, number][]): string | undefined {
  // Match either tap drill (~0.8*d), nominal d, or standard clearance (~1.12*d)
  let best: { size: string; err: number } | undefined;
  for (const [size, nominal] of table) {
    if (diameterMm >= nominal * 0.72 && diameterMm <= nominal * 1.18) {
      const err = Math.abs(diameterMm - nominal);
      if (!best || err < best.err) best = { size, err };
    }
  }
  return best?.size;
}

/** Detect cylindrical bore fastener seats directly from exact B-rep topology (`parts.seats`). */
export function resolveFastenerSeats(
  topology: readonly FaceTopologyData[],
  options?: { minDiameterMm?: number; maxDiameterMm?: number },
): FastenerSeat[] {
  const minD = options?.minDiameterMm ?? 1.4;
  const maxD = options?.maxDiameterMm ?? 36;
  const seats: FastenerSeat[] = [];

  for (const face of topology) {
    if (face.surfaceType.toUpperCase() !== "CYLINDER") continue;
    const cylAxis = face.candidates.find((c) => c.kind === "cylinder-axis");
    const circles = face.candidates.filter((c) => c.kind === "circle-center");
    const radius = face.measurements?.radiusMillimeters ?? cylAxis?.measurements?.radiusMillimeters ?? circles[0]?.measurements?.radiusMillimeters;
    if (radius === undefined || !Number.isFinite(radius)) continue;
    const diameter = 2 * radius;
    if (diameter < minD || diameter > maxD) continue;

    const axisRaw = cylAxis?.zAxis ?? face.measurements?.axisDirection ?? circles[0]?.zAxis ?? [0, 0, 1];
    const axLen = Math.hypot(axisRaw[0], axisRaw[1], axisRaw[2]) || 1;
    const axis: [number, number, number] = [axisRaw[0] / axLen, axisRaw[1] / axLen, axisRaw[2] / axLen];

    let origin: [number, number, number];
    let depth: number | undefined;
    if (circles.length >= 2) {
      // Pick rim farthest along +axis as seat plane, and distance between rims as bore depth.
      const sorted = [...circles].sort((a, b) =>
        (b.origin[0] * axis[0] + b.origin[1] * axis[1] + b.origin[2] * axis[2]) -
        (a.origin[0] * axis[0] + a.origin[1] * axis[1] + a.origin[2] * axis[2]),
      );
      origin = [...sorted[0].origin] as [number, number, number];
      const p0 = sorted[0].origin, p1 = sorted[sorted.length - 1].origin;
      const d = Math.hypot(p0[0] - p1[0], p0[1] - p1[1], p0[2] - p1[2]);
      if (d > 1e-4) depth = d;
    } else if (circles.length === 1) {
      origin = [...circles[0].origin] as [number, number, number];
    } else if (cylAxis) {
      origin = [...cylAxis.origin] as [number, number, number];
    } else if (face.measurements?.centerMillimeters) {
      origin = [...face.measurements.centerMillimeters] as [number, number, number];
    } else {
      continue;
    }
    if (depth === undefined && face.measurements?.areaSquareMillimeters && radius > 1e-6) {
      const h = face.measurements.areaSquareMillimeters / (2 * Math.PI * radius);
      if (Number.isFinite(h) && h > 1e-4) depth = h;
    }

    seats.push({
      faceId: face.id,
      originMillimeters: origin,
      axisDirection: axis,
      boreDiameterMillimeters: diameter,
      ...(depth !== undefined ? { depthMillimeters: depth } : {}),
      recommendedMetricSize: nearestStandardSize(diameter, METRIC_CLEARANCE_D),
      recommendedInchSize: nearestStandardSize(diameter, INCH_CLEARANCE_D),
    });
  }
  return seats;
}
