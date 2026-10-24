/** Explicit Part19 reference to one boundary assembled from authored contours.
 * A single contour continues to use the existing profileContourId field.
 *
 * A region of the sketch's arrangement (shapes that overlap, nest or are cut by
 * lines) adds `inside`: the closed contours whose interior holds it, which tells
 * apart the cells two shapes make. `boundary` names directed source spans when
 * several cells share those sets, retaining the chosen side through rotation.
 * Unresolved duplicate boundary signatures are not eligible for new references. */
export interface ProfileRegionReference { contourIds: string[]; inside?: string[]; ordinal?: number; boundary?: string[] }
export interface ProfileRegionSelection {
  profileContourId?: string;
  profileRegion?: ProfileRegionReference;
}
const ids = (list: unknown, min: number) => Array.isArray(list) && list.length >= min && list.length <= 1000 &&
  list.every(id => typeof id === 'string' && !!id.trim() && id.length <= 128) && new Set(list).size === list.length;
export function validateProfileRegionSelection(selection: ProfileRegionSelection): void {
  const value = selection.profileRegion;
  if (value === undefined) return;
  const cell = value && typeof value === 'object' && value.inside !== undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['contourIds', 'inside', 'ordinal', 'boundary'].includes(key)) ||
    !ids(value.contourIds, cell ? 1 : 2) || (cell && !ids(value.inside, 0)) ||
    (value.boundary !== undefined && (!Array.isArray(value.boundary) || !value.boundary.length || value.boundary.length > 10000 || value.boundary.some(s => typeof s !== "string" || s.length > 320) || new Set(value.boundary).size !== value.boundary.length)) ||
    (value.ordinal !== undefined && !(Number.isInteger(value.ordinal) && value.ordinal >= 1 && value.ordinal <= 10000)) ||
    selection.profileContourId !== undefined) throw Error('A connected sketch region needs distinct source contour identities, without a single-contour reference.');
}
export function profileRegionIdentity(selection: ProfileRegionSelection): string {
  const r = selection.profileRegion;
  return JSON.stringify(r ? { contours: [...r.contourIds].sort(), ...(r.inside !== undefined ? { inside: [...r.inside].sort() } : {}), ...(r.ordinal ? { ordinal: r.ordinal } : {}), ...(r.boundary ? { boundary: [...r.boundary].sort() } : {}) } : selection.profileContourId ?? null);
}
export function matchesProfileRegion(selection: ProfileRegionSelection, candidate: { contourId?: string; sourceContourIds?: string[]; insideContourIds?: string[]; ordinal?: number; boundary?: string[] }): boolean {
  // Position-only disambiguation is unsuitable for persistent feature identity.
  if (candidate.ordinal !== undefined) return false;
  return selection.profileRegion
    ? !!candidate.sourceContourIds && profileRegionIdentity(selection) === profileRegionIdentity({ profileRegion: { contourIds: candidate.sourceContourIds, inside: candidate.insideContourIds, ordinal: candidate.ordinal, boundary: candidate.boundary } })
    : selection.profileContourId !== undefined ? candidate.contourId === selection.profileContourId : false;
}
