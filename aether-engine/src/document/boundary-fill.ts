/** Boundary Fill (SolidCraft's solid.boundary_fill): tool bodies divide space into cells; the
 *  cells picked by a point inside each become a solid: inside the tools that contain the point,
 *  outside the rest. The result is a new body or joins, cuts or intersects a target. */
type V3 = [number, number, number];
export interface BoundaryFillFeature {
  id: string; type: "boundary-fill"; name: string; suppressed: boolean;
  toolBodyIds: string[];
  /** A point inside each cell to fill, mm. */
  cellPointsMillimeters: V3[];
  operation: "new" | "add" | "cut" | "intersect";
  targetBodyId?: string;
  bodyId?: string;
  /** Remove the tool bodies afterwards. */
  removeTools?: boolean;
}
export function validateBoundaryFill(feature: BoundaryFillFeature): void {
  if (!Array.isArray(feature.toolBodyIds) || !feature.toolBodyIds.length || feature.toolBodyIds.some((id) => typeof id !== "string")) throw new Error("Boundary fill needs tool bodies.");
  if (new Set(feature.toolBodyIds).size !== feature.toolBodyIds.length) throw new Error("A tool body is listed twice.");
  if (!Array.isArray(feature.cellPointsMillimeters) || !feature.cellPointsMillimeters.length || !feature.cellPointsMillimeters.every((p) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite))) throw new Error("Boundary fill needs a point inside each cell to fill.");
  if (!["new", "add", "cut", "intersect"].includes(feature.operation)) throw new Error("Boundary fill makes a new body, or joins, cuts or intersects one.");
  if (feature.operation !== "new" && feature.removeTools && feature.targetBodyId && feature.toolBodyIds.includes(feature.targetBodyId)) throw new Error("The target cannot be a tool that is removed.");
}
