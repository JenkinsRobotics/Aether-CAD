/** Thread and clearance-hole standards for the Hole feature (FreeCAD's Hole
 *  profiles as the specification). Pure data and arithmetic: no geometry.
 *
 *  Tapped holes use the tap drill; clearance holes use ISO 273 / ASME B18.2.8
 *  fits; counterbores and countersinks default to ISO 4762 cap screws and
 *  ISO 10642 countersunk screws. Values are millimetres. */

export type HoleThreadStandard = "iso-metric-coarse" | "iso-metric-fine" | "unc" | "unf" | "bsp" | "npt";
export type HoleClearanceFit = "close" | "normal" | "loose";

export interface ThreadSpecification {
  standard: HoleThreadStandard;
  designation: string;
  majorDiameterMillimeters: number;
  pitchMillimeters: number;
  /** Drill before tapping (≈ 75 % thread engagement). */
  tapDrillMillimeters: number;
  /** Internal minor diameter D1 of the finished thread. */
  minorDiameterMillimeters: number;
  clearanceMillimeters: Record<HoleClearanceFit, number>;
  /** Pipe threads seal on the thread; they have no clearance-hole use. */
  tappedOnly?: true;
}

export const HOLE_THREAD_STANDARD_LABELS: Record<HoleThreadStandard, string> = {
  "iso-metric-coarse": "ISO metric coarse",
  "iso-metric-fine": "ISO metric fine",
  unc: "UNC (ASME B1.1)",
  unf: "UNF (ASME B1.1)",
  bsp: "BSP parallel G (ISO 228)",
  npt: "NPT taper (ASME B1.20.1)",
};

// ISO 261 coarse pitch, ISO 2306 tap drill, ISO 273 clearance (fine / medium / coarse series).
const metricCoarse: [size: number, pitch: number, tapDrill: number, close: number, normal: number, loose: number][] = [
  [1.6, 0.35, 1.25, 1.7, 1.8, 2.0], [2, 0.4, 1.6, 2.2, 2.4, 2.6], [2.5, 0.45, 2.05, 2.7, 2.9, 3.1],
  [3, 0.5, 2.5, 3.2, 3.4, 3.6], [4, 0.7, 3.3, 4.3, 4.5, 4.8], [5, 0.8, 4.2, 5.3, 5.5, 5.8],
  [6, 1, 5, 6.4, 6.6, 7], [8, 1.25, 6.8, 8.4, 9, 10], [10, 1.5, 8.5, 10.5, 11, 12],
  [12, 1.75, 10.2, 13, 13.5, 14.5], [14, 2, 12, 15, 15.5, 16.5], [16, 2, 14, 17, 17.5, 18.5],
  [20, 2.5, 17.5, 21, 22, 24], [24, 3, 21, 25, 26, 28], [30, 3.5, 26.5, 31, 33, 35],
  [36, 4, 32, 37, 39, 42], [42, 4.5, 37.5, 43, 45, 48], [48, 5, 43, 50, 52, 56],
  [56, 5.5, 50.5, 58, 62, 66], [64, 6, 58, 66, 70, 74],
];

// ISO 261 fine pitches in common use; the tap drill is D − P as the ISO tables give it.
const metricFine: [size: number, pitch: number][] = [
  [8, 1], [10, 1.25], [10, 1], [12, 1.5], [12, 1.25], [14, 1.5], [16, 1.5], [18, 1.5], [20, 1.5], [20, 2],
  [22, 1.5], [24, 2], [24, 1.5], [27, 2], [30, 2], [30, 1.5], [33, 2], [36, 3], [36, 2], [39, 3], [42, 3], [48, 3],
];

// ASME B1.1 unified threads: nominal inches, threads per inch, tap drill (mm), ASME B18.2.8 clearance (inches).
const unified: Record<"unc" | "unf", [designation: string, inches: number, tpi: number, tapDrillMm: number, close: number, normal: number, loose: number][]> = {
  unc: [
    ["#4-40", 0.112, 40, 2.26, 0.116, 0.1285, 0.1495], ["#6-32", 0.138, 32, 2.71, 0.144, 0.1495, 0.1695],
    ["#8-32", 0.164, 32, 3.45, 0.1695, 0.177, 0.196], ["#10-24", 0.19, 24, 3.8, 0.196, 0.201, 0.221],
    ["1/4-20", 0.25, 20, 5.11, 0.257, 0.266, 0.29], ["5/16-18", 0.3125, 18, 6.53, 0.323, 0.332, 0.358],
    ["3/8-16", 0.375, 16, 7.94, 0.386, 0.397, 0.422], ["7/16-14", 0.4375, 14, 9.35, 0.453, 0.469, 0.484],
    ["1/2-13", 0.5, 13, 10.72, 0.516, 0.531, 0.562], ["5/8-11", 0.625, 11, 13.49, 0.641, 0.656, 0.688],
    ["3/4-10", 0.75, 10, 16.67, 0.766, 0.781, 0.812], ["1-8", 1, 8, 22.23, 1.016, 1.031, 1.062],
  ],
  unf: [
    ["#4-48", 0.112, 48, 2.38, 0.116, 0.1285, 0.1495], ["#6-40", 0.138, 40, 2.87, 0.144, 0.1495, 0.1695],
    ["#8-36", 0.164, 36, 3.58, 0.1695, 0.177, 0.196], ["#10-32", 0.19, 32, 4.04, 0.196, 0.201, 0.221],
    ["1/4-28", 0.25, 28, 5.41, 0.257, 0.266, 0.29], ["5/16-24", 0.3125, 24, 6.91, 0.323, 0.332, 0.358],
    ["3/8-24", 0.375, 24, 8.43, 0.386, 0.397, 0.422], ["7/16-20", 0.4375, 20, 9.9, 0.453, 0.469, 0.484],
    ["1/2-20", 0.5, 20, 11.51, 0.516, 0.531, 0.562], ["5/8-18", 0.625, 18, 14.5, 0.641, 0.656, 0.688],
    ["3/4-16", 0.75, 16, 17.46, 0.766, 0.781, 0.812], ["1-12", 1, 12, 23.42, 1.016, 1.031, 1.062],
  ],
};

// ISO 228-1 G threads: designation, major diameter (mm), threads per inch, tap drill (mm). 55° Whitworth form.
const bsp: [designation: string, major: number, tpi: number, tapDrill: number][] = [
  ["G1/8", 9.728, 28, 8.8], ["G1/4", 13.157, 19, 11.8], ["G3/8", 16.662, 19, 15.25], ["G1/2", 20.955, 14, 19],
  ["G3/4", 26.441, 14, 24.5], ["G1", 33.249, 11, 30.75], ["G1 1/4", 41.91, 11, 39.5], ["G1 1/2", 47.803, 11, 45.25], ["G2", 59.614, 11, 57],
];
// ASME B1.20.1 NPT: designation, outside diameter (inches), threads per inch, tap drill (mm, the usual fractional drill).
// The 1:16 taper is the Hole feature's taper angle (1.79°), set by the author; the table holds the gauge-plane sizes.
const npt: [designation: string, inches: number, tpi: number, tapDrill: number][] = [
  ["1/8-27", 0.405, 27, 8.73], ["1/4-18", 0.54, 18, 11.11], ["3/8-18", 0.675, 18, 14.68], ["1/2-14", 0.84, 14, 18.26],
  ["3/4-14", 1.05, 14, 23.42], ["1-11.5", 1.315, 11.5, 29.37], ["1 1/4-11.5", 1.66, 11.5, 38.1], ["1 1/2-11.5", 1.9, 11.5, 44.05], ["2-11.5", 2.375, 11.5, 56.36],
];

const INCH = 25.4;
const round = (value: number, decimals = 3) => Math.round(value * 10 ** decimals) / 10 ** decimals;
/** ISO 68-1 / ASME B1.1 internal minor diameter for a 60° thread. */
const minorDiameter = (major: number, pitch: number) => round(major - 1.0825 * pitch);
// ISO 273 rows for the intermediate sizes only the fine series uses.
const metricIntermediateClearance: Record<number, [close: number, normal: number, loose: number]> = {
  18: [19, 20, 21], 22: [23, 24, 26], 27: [28, 30, 32], 33: [34, 36, 38], 39: [40, 42, 45],
};
const metricClearance = (size: number): Record<HoleClearanceFit, number> => {
  const row = metricCoarse.find((r) => r[0] === size);
  if (row) return { close: row[3], normal: row[4], loose: row[5] };
  const [close, normal, loose] = metricIntermediateClearance[size];
  return { close, normal, loose };
};

const table = new Map<HoleThreadStandard, ThreadSpecification[]>([
  ["iso-metric-coarse", metricCoarse.map(([size, pitch, tapDrill, close, normal, loose]) => ({
    standard: "iso-metric-coarse" as const, designation: `M${size}`, majorDiameterMillimeters: size, pitchMillimeters: pitch,
    tapDrillMillimeters: tapDrill, minorDiameterMillimeters: minorDiameter(size, pitch), clearanceMillimeters: { close, normal, loose },
  }))],
  ["iso-metric-fine", metricFine.map(([size, pitch]) => ({
    standard: "iso-metric-fine" as const, designation: `M${size}x${pitch}`, majorDiameterMillimeters: size, pitchMillimeters: pitch,
    tapDrillMillimeters: round(size - pitch, 2), minorDiameterMillimeters: minorDiameter(size, pitch), clearanceMillimeters: metricClearance(size),
  }))],
  ...(["unc", "unf"] as const).map((standard) => [standard, unified[standard].map(([designation, inches, tpi, tapDrill, close, normal, loose]) => ({
    standard, designation, majorDiameterMillimeters: round(inches * INCH), pitchMillimeters: round(INCH / tpi),
    tapDrillMillimeters: tapDrill, minorDiameterMillimeters: minorDiameter(round(inches * INCH), round(INCH / tpi)),
    clearanceMillimeters: { close: round(close * INCH, 2), normal: round(normal * INCH, 2), loose: round(loose * INCH, 2) },
  }))] as const),
  // ponytail: clearance columns are filled with the major diameter so the record shape holds; validation refuses clearance use.
  ["bsp", bsp.map(([designation, major, tpi, tapDrill]) => ({
    standard: "bsp" as const, designation, majorDiameterMillimeters: major, pitchMillimeters: round(INCH / tpi), tapDrillMillimeters: tapDrill,
    minorDiameterMillimeters: round(major - 1.2806 * INCH / tpi), clearanceMillimeters: { close: major, normal: major, loose: major }, tappedOnly: true as const,
  }))],
  ["npt", npt.map(([designation, inches, tpi, tapDrill]) => ({
    standard: "npt" as const, designation, majorDiameterMillimeters: round(inches * INCH), pitchMillimeters: round(INCH / tpi), tapDrillMillimeters: tapDrill,
    minorDiameterMillimeters: minorDiameter(round(inches * INCH), round(INCH / tpi)), clearanceMillimeters: { close: round(inches * INCH), normal: round(inches * INCH), loose: round(inches * INCH) }, tappedOnly: true as const,
  }))],
]);

export const HOLE_THREAD_STANDARDS = [...table.keys()] as HoleThreadStandard[];

export function isHoleThreadStandard(value: unknown): value is HoleThreadStandard {
  return typeof value === "string" && table.has(value as HoleThreadStandard);
}

/** Every designation of a standard, in table order (smallest first). */
export function threadDesignations(standard: HoleThreadStandard): string[] {
  return (table.get(standard) ?? []).map((spec) => spec.designation);
}

/** The specification of a designation, matched case-insensitively ("m8", "M8X1"). */
export function threadSpecification(standard: HoleThreadStandard, designation: string): ThreadSpecification | undefined {
  const wanted = designation.trim().toLowerCase().replace(/\s+/g, "");
  return (table.get(standard) ?? []).find((spec) => spec.designation.toLowerCase() === wanted);
}

/** Tolerance classes of an internal thread (FreeCAD's Hole "Class"): ISO 965 grades 4–8 with
 *  fundamental deviation H (zero) or G; unified 1B–3B. Pipe threads carry none. */
export function threadClasses(standard: HoleThreadStandard): string[] {
  if (standard.startsWith("iso-metric")) return ["4H", "5H", "6H", "7H", "8H", "4G", "5G", "6G", "7G", "8G"];
  if (standard === "unc" || standard === "unf") return ["1B", "2B", "3B"];
  return [];
}
/** What the class adds to a tapped hole's diameter: ISO 965-1 EI = 15 + 11·P µm for G classes,
 *  nothing for H and unified B classes (their tolerance lies above the basic minor diameter). */
export function threadClassDeviationMillimeters(spec: ThreadSpecification, threadClass: string | undefined): number {
  if (!threadClass || !threadClasses(spec.standard).includes(threadClass)) return 0;
  return threadClass.endsWith("G") ? (15 + 11 * spec.pitchMillimeters) / 1000 : 0;
}

/** The hole diameter FreeCAD's Hole gives a profile: the tap drill (plus the class's fundamental
 *  deviation) when tapped, else the clearance fit. */
export function standardHoleDiameter(spec: ThreadSpecification, tapped: boolean, fit: HoleClearanceFit = "normal", threadClass?: string): number {
  return tapped ? spec.tapDrillMillimeters + threadClassDeviationMillimeters(spec, threadClass) : spec.clearanceMillimeters[fit];
}

export interface HeadRecess { diameterMillimeters: number; depthMillimeters?: number; angleDegrees?: number }

// ISO 4762 socket head cap screw counterbore (diameter, depth = head height); ISO 10642 countersunk head diameter, 90°.
const capScrewCounterbore: Record<number, [bore: number, depth: number]> = {
  3: [6.5, 3], 4: [8, 4], 5: [10, 5], 6: [11, 6], 8: [15, 8], 10: [18, 10], 12: [20, 12], 14: [24, 14], 16: [26, 16], 20: [33, 20], 24: [40, 24],
};
const countersunkHead: Record<number, number> = { 3: 6.72, 4: 8.96, 5: 11.2, 6: 13.44, 8: 17.92, 10: 22.4, 12: 26.88, 14: 30.8, 16: 33.6, 20: 40.32 };

/** The ISO 4762 counterbore for a metric size (bore diameter and head height), when the standard lists it. */
export function capScrewCounterboreFor(spec: ThreadSpecification): HeadRecess | undefined {
  const row = capScrewCounterbore[spec.majorDiameterMillimeters];
  if (!Array.isArray(row) || !spec.standard.startsWith("iso-metric")) return undefined;
  return { diameterMillimeters: row[0], depthMillimeters: row[1] };
}

/** The ISO 10642 countersink for a metric size: head diameter at the surface, 90° included angle. */
export function countersunkScrewFor(spec: ThreadSpecification): HeadRecess | undefined {
  const diameter = countersunkHead[spec.majorDiameterMillimeters];
  if (diameter === undefined || !spec.standard.startsWith("iso-metric")) return undefined;
  return { diameterMillimeters: diameter, angleDegrees: 90 };
}
