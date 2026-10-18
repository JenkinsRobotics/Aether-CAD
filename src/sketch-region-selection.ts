/** The sketch region the user picked, handed to the solid feature that uses it.
 *
 *  One producer (the sketch workspace) and one consumer (a feature editor), so
 *  this is a channel rather than a store: the feature takes the pick, which
 *  clears it, and a stale region can never seed a later dialog.
 */
export interface PickedSketchRegion {
  /** The profile feature the region belongs to. */
  featureId: string;
  /** Its position in that sketch's contours, which is what the picker lists. */
  contourIndex: number;
  /** A just-finished sketch with no explicit face pick hands all its regions
   * to editors supporting multiple profiles. This is transient selection only. */
  contourIndices?: number[];
}

let picked: PickedSketchRegion | null = null;

export function setPickedSketchRegion(region: PickedSketchRegion | null): void {
  picked = region;
}

/** Read and clear. A feature dialog seeds itself from this exactly once. */
export function takePickedSketchRegion(): PickedSketchRegion | null {
  const region = picked;
  picked = null;
  return region;
}
