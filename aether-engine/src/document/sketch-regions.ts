/** The regions of a sketch a solid feature can be built on, as the pickers list
 *  them: one per closed contour (or the sole profile), plus the closed regions
 *  several open curves enclose together. The engine's evaluator keys its own
 *  regions the same way (the contour id, or the sketch id for a sole region),
 *  so a pick here names the region it builds. */
import { resolveProfileDrawing } from "./profile-projection";
import { sketchFaceRegions } from "../sketch/reference/connected-sketch-regions";
import type { SketchContour, SketchDrawing } from "../sketch/drawing";
import type { PartFeature } from "./part-document";

export interface SketchRegion {
  /** The id the region is built under: the sketch id for a sole region, `sketch#index` otherwise. */
  engineId: string;
  /** The contour's own stable id, when it has one. */
  contourId?: string;
  /** Where the contour sits in the sketch. */
  contourIndex: number;
  /** A region enclosed by several open curves references its sources. */
  sourceContourIndices?: number[];
  sourceContourIds?: string[];
  previewContour?: SketchContour;
  /** The circle a hole can be centred on. */
  circle?: boolean;
  /** What to call it in a picker. */
  label: string;
  closed?: boolean;
}

export function sketchRegions(feature: PartFeature, includeOpen = false, history?: readonly PartFeature[]): SketchRegion[] {
  if (feature.type !== "profile" && feature.type !== "sketch") return [];
  // External relationships may move an otherwise unchanged saved contour:
  // region listing and the rebuild must read the same resolved drawing.
  const resolved = feature.type === "profile" && history ? { ...feature, profile: resolveProfileDrawing(history, feature.id) } : feature;
  if (!history && feature.type === "profile") {
    const drawing = feature.profile.type === "drawing" ? feature.profile : feature.profile.type === "projection" ? feature.profile.authored : undefined;
    if (drawing?.constraints?.some((c) => c.kind === "pierce")) throw Error("Resolve this sketch in its document before selecting regions.");
  }
  const profile = (resolved as { profile?: Record<string, unknown> }).profile;
  if (!profile || typeof profile !== "object") return [];
  const sole = (circle = false): SketchRegion[] => [{ engineId: feature.id, contourIndex: 0, label: "Region 1", ...(circle ? { circle } : {}) }];
  if (profile.type === "circle") return Number(profile.radiusMillimeters) > 0 ? sole(true) : [];
  if (profile.type === "center-rectangle") return Number(profile.widthMillimeters) > 0 && Number(profile.heightMillimeters) > 0 && !profile.construction ? sole() : [];
  if (profile.type === "polygon") return ((profile.pointsMillimeters as unknown[]) ?? []).length >= 3 ? sole() : [];
  if (profile.type !== "drawing") return [];
  const drawing = profile as unknown as SketchDrawing;
  const contours = drawing.contours ?? [];
  const regions: SketchRegion[] = [];
  contours.forEach((contour, index) => {
    if (contour.construction) return;
    const engineId = contours.length === 1 ? feature.id : `${feature.id}#${index}`;
    const label = `Region ${index + 1}`;
    if (contour.type === "circle") {
      if (!(Number.isFinite(contour.radius) && contour.radius > 0)) return;
      regions.push({ engineId, contourId: contour.id, contourIndex: index, label: `${label} · circle`, circle: true });
      return;
    }
    const segments = contour.segments ?? [];
    if (contour.type !== "path" || !contour.start || !segments.length) return;
    if (!segments.every((segment) => ["line", "arc", "bezier", "ellipse", "conic"].includes(segment.type))) return;
    if (segments.some((segment) => segment.type === "arc" && !Array.isArray(segment.middle))) return;
    const end = segments[segments.length - 1].end;
    const closed = Math.hypot(end[0] - contour.start[0], end[1] - contour.start[1]) < 1e-6;
    const straight = closed && segments.every((segment) => segment.type === "line") && segments.length >= 3;
    regions.push({ engineId, contourId: contour.id, contourIndex: index, closed, label: straight ? `${label} · ${segments.length} sides` : `${label} · ${closed ? "curved" : "open path"}` });
  });
  for (const boundary of sketchFaceRegions(drawing)) {
    if (boundary.sourceContourIndices.length < 2) continue;
    const sources = boundary.sourceContourIndices.map((index) => regions.find((region) => region.contourIndex === index && !region.sourceContourIndices));
    if (sources.some((source) => !source || source.closed !== false)) continue;
    regions.push({
      engineId: `${feature.id}#joined#${boundary.contourIndex}`, contourIndex: boundary.contourIndex,
      sourceContourIndices: boundary.sourceContourIndices, sourceContourIds: boundary.sourceContourIds,
      previewContour: boundary.contour, closed: true,
      label: `Region ${boundary.contourIndex + 1} · ${sources.length} connected curves`,
    });
  }
  return regions.filter((region) => (includeOpen ? !region.sourceContourIndices : region.closed !== false));
}
