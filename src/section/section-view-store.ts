/** Section view: display state only (like Onshape's), never part of the document.
 *  The viewer cuts the parts it applies to; the Section view window edits it. */
export type Vec3 = readonly [number, number, number];
export interface SectionPlane { label: string; originMillimeters: Vec3; normal: Vec3 }
export interface SectionItem { id: string; label: string }
export interface SectionView {
  plane: SectionPlane | null;
  /** Along the plane normal from its origin; negative moves into the part. */
  offsetMillimeters: number;
  /** Keep the opposite half without moving the cutting plane. */
  reversed?: boolean;
  showPlane?: boolean;
  /** Exclude: every part is cut except the listed ones. Include: only the listed ones. */
  mode: "exclude" | "include";
  items: readonly SectionItem[];
}

export const DEFAULT_SECTION_PLANES: readonly SectionPlane[] = [
  { label: "Top", originMillimeters: [0, 0, 0], normal: [0, 0, 1] },
  { label: "Front", originMillimeters: [0, 0, 0], normal: [0, -1, 0] },
  { label: "Right", originMillimeters: [0, 0, 0], normal: [1, 0, 0] },
];

let state: SectionView | null = null, editing = false;
const listeners = new Set<() => void>();
export const sectionView = {
  snapshot: (): SectionView | null => state,
  /** True while the Section view window is open: the plane and handle are shown. */
  editing: (): boolean => editing,
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  set(next: SectionView | null, isEditing = false) { state = next; editing = isEditing; listeners.forEach(listener => listener()); },
};

export function isSectioned(view: SectionView, partId: string): boolean {
  const listed = view.items.some(item => item.id === partId);
  return view.mode === "exclude" ? !listed : listed;
}

/** The kept half-space as a clipping plane (normal · p + constant ≥ 0 is kept):
 *  material on the side the section normal points to is cut away. */
export function sectionClipPlane(view: SectionView | null): { normal: Vec3; constant: number } | null {
  if (!view?.plane) return null;
  const length = Math.hypot(...view.plane.normal);
  if (!Number.isFinite(length) || length < 1e-12 || !Number.isFinite(view.offsetMillimeters)) return null;
  const n = view.plane.normal.map(value => value / length) as unknown as Vec3;
  const d = n.reduce((sum, value, axis) => sum + value * view.plane!.originMillimeters[axis], 0) + view.offsetMillimeters;
  return view.reversed ? { normal: n, constant: -d } : { normal: [-n[0], -n[1], -n[2]], constant: d };
}

/** Parameter t of the point on origin + t·direction nearest a pick ray; null when
 *  the ray runs along the line (no stable answer). Both directions unit length. */
export function lineParameterNearestRay(origin: Vec3, direction: Vec3, rayOrigin: Vec3, rayDirection: Vec3): number | null {
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const w = [rayOrigin[0] - origin[0], rayOrigin[1] - origin[1], rayOrigin[2] - origin[2]] as const;
  const b = dot(direction, rayDirection), denominator = 1 - b * b;
  if (denominator < 1e-6) return null;
  return (dot(w, direction) - dot(w, rayDirection) * b) / denominator;
}
