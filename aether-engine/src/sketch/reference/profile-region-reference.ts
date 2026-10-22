/** Explicit Part19 reference to one boundary assembled from authored contours.
 * A single contour continues to use the existing profileContourId field. */
export interface ProfileRegionReference { contourIds: string[] }
export interface ProfileRegionSelection {
  profileContourId?: string;
  profileRegion?: ProfileRegionReference;
}
export function validateProfileRegionSelection(selection: ProfileRegionSelection): void {
  const value = selection.profileRegion;
  if (value === undefined) return;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => key !== 'contourIds') ||
    !Array.isArray(value.contourIds) || value.contourIds.length < 2 || value.contourIds.length > 1000 ||
    value.contourIds.some(id => typeof id !== 'string' || !id.trim() || id.length > 128) || new Set(value.contourIds).size !== value.contourIds.length ||
    selection.profileContourId !== undefined) throw Error('A connected sketch region needs distinct source contour identities, without a single-contour reference.');
}
export function profileRegionIdentity(selection: ProfileRegionSelection): string {
  return JSON.stringify(selection.profileRegion ? { contours: [...selection.profileRegion.contourIds].sort() } : selection.profileContourId ?? null);
}
export function matchesProfileRegion(selection: ProfileRegionSelection, candidate: { contourId?: string; sourceContourIds?: string[] }): boolean {
  return selection.profileRegion
    ? !!candidate.sourceContourIds && profileRegionIdentity(selection) === profileRegionIdentity({ profileRegion: { contourIds: candidate.sourceContourIds } })
    : selection.profileContourId !== undefined ? candidate.contourId === selection.profileContourId : false;
}
