/** Section view: display state only (like Onshape's), never part of the document.
 *  The viewer cuts the parts it applies to; the Section view window edits it. */
import { sectionFrame } from './section-frame';
export type Vec3 = readonly [number, number, number];
export interface SectionPlane { label: string; originMillimeters: Vec3; normal: Vec3 }
export interface SectionItem { id: string; label: string }
export interface SectionCut {
  id: string;
  plane: SectionPlane;
  /** Along the current cut normal from the selected reference face's origin. */
  offsetMillimeters: number;
  /** Keep the opposite half without moving the cutting plane. */
  reversed?: boolean;
  showPlane?: boolean;
  enabled?: boolean;
  rotationDegrees?: readonly [number, number];
  /** In-plane handle position on the zero-offset plane through the reference origin. */
  pivotMillimeters?: Vec3;
}
export interface SectionView {
  planes: readonly SectionCut[];
  activePlaneId: string | null;
  /** Exclude: every part is cut except the listed ones. Include: only the listed ones. */
  mode: "exclude" | "include";
  items: readonly SectionItem[];
  hatch?: boolean;
}

let nextId = 0;
export const newSectionCut = (plane: SectionPlane): SectionCut => ({id:`section-plane-${++nextId}`,plane,offsetMillimeters:0});
export const activeSectionCut = (view: SectionView | null) => view?.planes.find(cut => cut.id === view.activePlaneId) ?? view?.planes[0] ?? null;
export const sectionClipPlanes = (view: SectionView | null) => view?.planes.flatMap(cut => { const plane=sectionClipPlane(cut); return plane ? [plane] : []; }) ?? [];

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
export function sectionClipPlane(view: SectionCut | null): { normal: Vec3; constant: number } | null {
  if (!view?.plane || view.enabled === false) return null;
  const length = Math.hypot(...view.plane.normal);
  if (!Number.isFinite(length) || length < 1e-12 || !Number.isFinite(view.offsetMillimeters) || !view.plane.originMillimeters.every(Number.isFinite)) return null;
  if (view.rotationDegrees?.some(value => !Number.isFinite(value)) || view.pivotMillimeters?.some(value => !Number.isFinite(value))) return null;
  const { normal: n, point } = sectionFrame(view);
  const d = n.reduce((sum, value, axis) => sum + value * point[axis], 0);
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
