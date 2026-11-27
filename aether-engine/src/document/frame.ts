import type { V3 } from "./curve3d";

/** Structural frame profile shapes (SolidCraft's `frame.*` / weldment standard profiles). */
export type FrameProfileKind =
  | "bar"
  | "round-bar"
  | "rect-tube"
  | "round-tube"
  | "angle"
  | "channel"
  | "i-beam";

export interface FrameProfileSpec {
  id: string;
  label: string;
  standard: "ISO" | "EN" | "ANSI" | "Custom";
  kind: FrameProfileKind;
  widthMillimeters: number;
  heightMillimeters: number;
  wallMillimeters?: number;
  flangeMillimeters?: number;
  webMillimeters?: number;
  cornerRadiusMillimeters?: number;
  /** Cross-sectional area in mm² (used for cut-list mass calculation). */
  areaSquareMillimeters: number;
}

/** Standard structural steel & aluminum profile library (`frame.profile.list`). */
export const FRAME_PROFILE_LIBRARY: readonly FrameProfileSpec[] = [
  { id: "shs-20x20x2", label: "SHS 20×20×2", standard: "EN", kind: "rect-tube", widthMillimeters: 20, heightMillimeters: 20, wallMillimeters: 2, areaSquareMillimeters: 144 },
  { id: "shs-30x30x2.5", label: "SHS 30×30×2.5", standard: "EN", kind: "rect-tube", widthMillimeters: 30, heightMillimeters: 30, wallMillimeters: 2.5, areaSquareMillimeters: 275 },
  { id: "shs-40x40x3", label: "SHS 40×40×3", standard: "EN", kind: "rect-tube", widthMillimeters: 40, heightMillimeters: 40, wallMillimeters: 3, areaSquareMillimeters: 444 },
  { id: "shs-50x50x3", label: "SHS 50×50×3", standard: "EN", kind: "rect-tube", widthMillimeters: 50, heightMillimeters: 50, wallMillimeters: 3, areaSquareMillimeters: 564 },
  { id: "rhs-60x40x3", label: "RHS 60×40×3", standard: "EN", kind: "rect-tube", widthMillimeters: 60, heightMillimeters: 40, wallMillimeters: 3, areaSquareMillimeters: 564 },
  { id: "rhs-80x40x4", label: "RHS 80×40×4", standard: "EN", kind: "rect-tube", widthMillimeters: 80, heightMillimeters: 40, wallMillimeters: 4, areaSquareMillimeters: 896 },
  { id: "chs-26.9x2.6", label: "CHS 26.9×2.6", standard: "EN", kind: "round-tube", widthMillimeters: 26.9, heightMillimeters: 26.9, wallMillimeters: 2.6, areaSquareMillimeters: 198.5 },
  { id: "chs-42.4x3.2", label: "CHS 42.4×3.2", standard: "EN", kind: "round-tube", widthMillimeters: 42.4, heightMillimeters: 42.4, wallMillimeters: 3.2, areaSquareMillimeters: 394.1 },
  { id: "rsa-40x40x4", label: "RSA 40×40×4 Angle", standard: "EN", kind: "angle", widthMillimeters: 40, heightMillimeters: 40, wallMillimeters: 4, areaSquareMillimeters: 304 },
  { id: "rsa-50x50x5", label: "RSA 50×50×5 Angle", standard: "EN", kind: "angle", widthMillimeters: 50, heightMillimeters: 50, wallMillimeters: 5, areaSquareMillimeters: 475 },
  { id: "pfc-100x50", label: "PFC 100×50 Channel", standard: "EN", kind: "channel", widthMillimeters: 50, heightMillimeters: 100, webMillimeters: 5, flangeMillimeters: 8.5, areaSquareMillimeters: 1265 },
  { id: "ipe-100", label: "IPE 100 I-Beam", standard: "EN", kind: "i-beam", widthMillimeters: 55, heightMillimeters: 100, webMillimeters: 4.1, flangeMillimeters: 5.7, areaSquareMillimeters: 990 },
  { id: "bar-40x6", label: "Flat Bar 40×6", standard: "ISO", kind: "bar", widthMillimeters: 40, heightMillimeters: 6, areaSquareMillimeters: 240 },
  { id: "round-bar-20", label: "Round Bar Ø20", standard: "ISO", kind: "round-bar", widthMillimeters: 20, heightMillimeters: 20, areaSquareMillimeters: 314.159 },
] as const;

export function findFrameProfile(id: string): FrameProfileSpec | undefined {
  return FRAME_PROFILE_LIBRARY.find((p) => p.id === id);
}

export interface CustomFrameProfile {
  kind: FrameProfileKind;
  widthMillimeters: number;
  heightMillimeters: number;
  wallMillimeters?: number;
  flangeMillimeters?: number;
  webMillimeters?: number;
}

/** Structural Frame Member feature (`frame.member`): sweeps a standard or custom structural
 *  section along 1+ sketch or 3D curve segments, with optional miter/butt corner trimming and weld gap. */
export interface FrameMemberFeature {
  id: string;
  type: "frame-member";
  name: string;
  suppressed: boolean;
  operation: "new";
  bodyId?: string;
  /** Standard library profile ID (e.g. "shs-40x40x3") OR inline custom section. */
  profileId?: string;
  customProfile?: CustomFrameProfile;
  /** Source sketch or 3D curve feature supplying straight path segments. */
  pathFeatureId?: string;
  /** Or explicit 3D segments [[start, end], ...] in world mm. */
  segmentsMillimeters?: [V3, V3][];
  rotationDegrees?: number;
  offsetXMillimeters?: number;
  offsetYMillimeters?: number;
  trimMode?: "none" | "miter" | "butt";
  weldGapMillimeters?: number;
}

/** Frame End Cap (`frame.end_cap`): closes open member ends with a welded plate. */
export interface FrameEndCapFeature {
  id: string;
  type: "frame-end-cap";
  name: string;
  suppressed: boolean;
  operation: "new" | "add";
  bodyId?: string;
  targetBodyId?: string;
  frameFeatureId: string;
  end: "start" | "end" | "both";
  thicknessMillimeters: number;
  insetMillimeters?: number;
}

/** Frame Trim (`frame.trim`): trims one or more structural frame member bodies against
 *  another member body (cope / butt / miter) or a reference plane, with optional weld gap. */
export interface FrameTrimFeature {
  id: string;
  type: "frame-trim";
  name: string;
  suppressed: boolean;
  targetBodyIds: string[];
  toolBodyId?: string;
  plane?: import("./mirror-plane").MirrorPlaneReference;
  mode: "butt" | "cope" | "miter";
  keepPointMillimeters?: V3;
  weldGapMillimeters?: number;
}

/** Frame Gusset (`frame.gusset`): welded triangular or polygonal stiffening plate placed
 *  at the corner between two structural member axes. */
export interface FrameGussetFeature {
  id: string;
  type: "frame-gusset";
  name: string;
  suppressed: boolean;
  operation: "new" | "add";
  bodyId?: string;
  targetBodyId?: string;
  originMillimeters: V3;
  axisA: V3;
  axisB: V3;
  legAMillimeters: number;
  legBMillimeters: number;
  thicknessMillimeters: number;
  chamferMillimeters?: number;
  shape?: "triangle" | "polygon";
}

export interface FrameCutListRow {
  featureId: string;
  name: string;
  profile: string;
  lengthMillimeters: number;
  quantity: number;
  trimMode: string;
  massKilograms: number;
}

const pos = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function resolveFrameProfile(feature: FrameMemberFeature): FrameProfileSpec {
  if (feature.profileId) {
    const found = findFrameProfile(feature.profileId);
    if (!found) throw new Error(`Unknown frame profile "${feature.profileId}".`);
    return found;
  }
  const c = feature.customProfile;
  if (!c) throw new Error("Frame member requires a profileId or customProfile.");
  const w = c.widthMillimeters, h = c.heightMillimeters, t = c.wallMillimeters ?? Math.min(w, h) * 0.1;
  let area = w * h;
  if (c.kind === "round-bar") area = Math.PI * (w / 2) ** 2;
  else if (c.kind === "rect-tube") area = w * h - Math.max(0, w - 2 * t) * Math.max(0, h - 2 * t);
  else if (c.kind === "round-tube") area = Math.PI * ((w / 2) ** 2 - Math.max(0, w / 2 - t) ** 2);
  else if (c.kind === "angle") area = w * t + Math.max(0, h - t) * t;
  else if (c.kind === "channel" || c.kind === "i-beam") {
    const web = c.webMillimeters ?? t, fl = c.flangeMillimeters ?? t;
    area = 2 * w * fl + Math.max(0, h - 2 * fl) * web;
  }
  return {
    id: `custom-${c.kind}`,
    label: `Custom ${c.kind} ${w}×${h}`,
    standard: "Custom",
    kind: c.kind,
    widthMillimeters: w,
    heightMillimeters: h,
    wallMillimeters: c.wallMillimeters,
    flangeMillimeters: c.flangeMillimeters,
    webMillimeters: c.webMillimeters,
    areaSquareMillimeters: area,
  };
}

export function validateFrameMember(
  feature: FrameMemberFeature,
  earlier: ReadonlyMap<string, string>,
  missing: (id: unknown) => boolean = () => false,
): void {
  if (feature.operation !== "new") throw new Error("Frame member always creates a structural body.");
  const spec = resolveFrameProfile(feature);
  if (!pos(spec.widthMillimeters) || !pos(spec.heightMillimeters)) throw new Error("Frame profile dimensions must be positive.");
  if (spec.kind === "rect-tube" || spec.kind === "round-tube" || spec.kind === "angle") {
    const t = spec.wallMillimeters;
    if (!pos(t) || t * 2 >= Math.min(spec.widthMillimeters, spec.heightMillimeters)) {
      throw new Error("Tube/angle wall thickness must be positive and less than half the outer width.");
    }
  }
  if (!feature.pathFeatureId && !feature.segmentsMillimeters?.length) {
    throw new Error("Frame member requires a pathFeatureId (sketch/curve3d) or explicit segmentsMillimeters.");
  }
  if (feature.pathFeatureId && !missing(feature.pathFeatureId) && !["profile", "sketch", "curve3d"].includes(earlier.get(feature.pathFeatureId) ?? "")) {
    throw new Error("Frame path must reference an earlier sketch or 3D curve.");
  }
  if (feature.segmentsMillimeters) {
    for (const seg of feature.segmentsMillimeters) {
      if (!Array.isArray(seg) || seg.length !== 2 || !seg.every((p) => Array.isArray(p) && p.length === 3 && p.every(finite))) {
        throw new Error("Frame segments must be pairs of finite [x, y, z] coordinates.");
      }
      if (Math.hypot(seg[1][0] - seg[0][0], seg[1][1] - seg[0][1], seg[1][2] - seg[0][2]) < 1e-4) {
        throw new Error("Frame member segment must have non-zero length.");
      }
    }
  }
  if (feature.rotationDegrees !== undefined && !finite(feature.rotationDegrees)) throw new Error("Frame rotation must be finite.");
  if (feature.offsetXMillimeters !== undefined && !finite(feature.offsetXMillimeters)) throw new Error("Frame X offset must be finite.");
  if (feature.offsetYMillimeters !== undefined && !finite(feature.offsetYMillimeters)) throw new Error("Frame Y offset must be finite.");
  if (feature.trimMode !== undefined && !["none", "miter", "butt"].includes(feature.trimMode)) throw new Error("Unknown frame trim mode.");
  if (feature.weldGapMillimeters !== undefined && (!finite(feature.weldGapMillimeters) || feature.weldGapMillimeters < 0)) throw new Error("Weld gap must be zero or positive.");
}

export function validateFrameEndCap(
  feature: FrameEndCapFeature,
  earlier: ReadonlyMap<string, string>,
  missing: (id: unknown) => boolean = () => false,
): void {
  if (!missing(feature.frameFeatureId) && earlier.get(feature.frameFeatureId) !== "frame-member") {
    throw new Error("Frame end cap requires an earlier frame-member feature.");
  }
  if (!["start", "end", "both"].includes(feature.end)) throw new Error("Frame end cap end must be start, end, or both.");
  if (!pos(feature.thicknessMillimeters)) throw new Error("End cap thickness must be positive.");
  if (feature.insetMillimeters !== undefined && (!finite(feature.insetMillimeters) || feature.insetMillimeters < 0)) {
    throw new Error("End cap inset must be zero or positive.");
  }
}

export function validateFrameTrim(
  feature: FrameTrimFeature,
  earlier: ReadonlyMap<string, string>,
  missing: (id: unknown) => boolean = () => false,
): void {
  if (!Array.isArray(feature.targetBodyIds) || !feature.targetBodyIds.length || feature.targetBodyIds.some((id) => typeof id !== "string" || !id.trim())) {
    throw new Error("Frame trim requires at least one target member body.");
  }
  if (!["butt", "cope", "miter"].includes(feature.mode)) throw new Error("Frame trim mode must be butt, cope, or miter.");
  if (!feature.toolBodyId && !feature.plane && !(feature.mode === "miter" && feature.targetBodyIds.length >= 2)) {
    throw new Error("Frame trim requires a tool body, a trimming plane, or two bodies to miter.");
  }
  if (feature.plane) {
    if (feature.plane.kind === "feature" && !missing(feature.plane.featureId) && earlier.get(feature.plane.featureId) !== "plane") {
      throw new Error("Frame trim plane must reference an earlier construction plane.");
    }
  }
  if (feature.keepPointMillimeters !== undefined && (!Array.isArray(feature.keepPointMillimeters) || feature.keepPointMillimeters.length !== 3 || !feature.keepPointMillimeters.every(finite))) {
    throw new Error("Frame trim keep point must be a finite [x, y, z] coordinate.");
  }
  if (feature.weldGapMillimeters !== undefined && (!finite(feature.weldGapMillimeters) || feature.weldGapMillimeters < 0)) {
    throw new Error("Frame trim weld gap must be zero or positive.");
  }
}

export function validateFrameGusset(feature: FrameGussetFeature): void {
  if (!["new", "add"].includes(feature.operation)) throw new Error("Frame gusset operation must be new or add.");
  for (const [vec, label] of [[feature.originMillimeters, "origin"], [feature.axisA, "axisA"], [feature.axisB, "axisB"]] as const) {
    if (!Array.isArray(vec) || vec.length !== 3 || !vec.every(finite)) throw new Error(`Frame gusset ${label} must be finite [x, y, z].`);
  }
  const lenA = Math.hypot(...feature.axisA), lenB = Math.hypot(...feature.axisB);
  if (lenA < 1e-9 || lenB < 1e-9) throw new Error("Frame gusset axes must be non-zero.");
  const cx = feature.axisA[1] * feature.axisB[2] - feature.axisA[2] * feature.axisB[1];
  const cy = feature.axisA[2] * feature.axisB[0] - feature.axisA[0] * feature.axisB[2];
  const cz = feature.axisA[0] * feature.axisB[1] - feature.axisA[1] * feature.axisB[0];
  if (Math.hypot(cx, cy, cz) / (lenA * lenB) < 1e-6) throw new Error("Frame gusset axes must not be collinear.");
  if (!pos(feature.legAMillimeters) || !pos(feature.legBMillimeters) || !pos(feature.thicknessMillimeters)) {
    throw new Error("Frame gusset legs and thickness must be positive.");
  }
  if (feature.chamferMillimeters !== undefined) {
    if (!finite(feature.chamferMillimeters) || feature.chamferMillimeters < 0 || feature.chamferMillimeters >= Math.min(feature.legAMillimeters, feature.legBMillimeters)) {
      throw new Error("Frame gusset chamfer must be zero or less than the shorter leg.");
    }
  }
  if (feature.shape !== undefined && !["triangle", "polygon"].includes(feature.shape)) {
    throw new Error("Frame gusset shape must be triangle or polygon.");
  }
}

/** Generate a weldment cut list from all unsuppressed `frame-member` features in a PartDocument. */
export function frameCutList(
  features: readonly { id: string; type: string; name: string; suppressed?: boolean }[],
  densityKgPerM3 = 7850,
): FrameCutListRow[] {
  const rows: FrameCutListRow[] = [];
  for (const f of features) {
    if (f.suppressed || f.type !== "frame-member") continue;
    const member = f as unknown as FrameMemberFeature;
    const spec = resolveFrameProfile(member);
    const segs = member.segmentsMillimeters ?? [];
    const grouped = new Map<number, number>();
    for (const [a, b] of segs) {
      const len = Math.round(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) * 100) / 100;
      grouped.set(len, (grouped.get(len) ?? 0) + 1);
    }
    if (!grouped.size) {
      grouped.set(0, 1);
    }
    for (const [lengthMillimeters, quantity] of grouped) {
      const volM3 = (spec.areaSquareMillimeters * lengthMillimeters * quantity) * 1e-9;
      rows.push({
        featureId: member.id,
        name: member.name,
        profile: spec.label,
        lengthMillimeters,
        quantity,
        trimMode: member.trimMode ?? "none",
        massKilograms: Math.round(volM3 * densityKgPerM3 * 1e6) / 1e6,
      });
    }
  }
  return rows;
}

export function frameCutListCSV(rows: readonly FrameCutListRow[]): string {
  const headers = ["featureId", "name", "profile", "lengthMillimeters", "quantity", "trimMode", "massKilograms"] as const;
  return [headers.join(","), ...rows.map((r) => headers.map((h) => String(r[h])).join(","))].join("\n");
}
