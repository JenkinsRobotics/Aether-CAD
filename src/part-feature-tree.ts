import { errorsForDocument, renderableDocument } from "./modeling/feature-errors";
import { availableBodies, rollbackPosition } from "@aether/core/document";
import type { PartDocument, PartFeature } from "@aether/core/document";
import { sketchConstraintState } from "@aether/core/sketch";
import { sketchDefinitionState } from "@aether/core/sketch";
import { isPartPlacementAction } from "./part-history";

export type PartTreeItemKind = "part-document" | PartFeature["type"] | "body";

export interface PartTreeItem {
  id: string;
  name: string;
  kind: PartTreeItemKind;
  detail: string;
  error?: string;
  children: PartTreeItem[];
}

function featureDetail(feature: PartFeature): string {
  if (feature.type === "transform") return `${feature.transform.kind} · ${feature.bodyIds.length} parts${feature.copyBodyIds ? " · copies" : ""}`;
  if (feature.type === "boss") return `Ø${feature.diameterMillimeters} × ${feature.heightMillimeters} mm${feature.holeDiameterMillimeters ? ` · Ø${feature.holeDiameterMillimeters} hole` : ""}`;
  if (feature.type === "sheet-perforate") return `Ø${feature.diameterMillimeters} at ${feature.pitchMillimeters} mm · ${feature.pattern ?? "staggered"}`;
  if (feature.type === "surface-trim") return `at ${feature.plane.kind === "principal" ? `${feature.plane.plane} ${feature.plane.offsetMillimeters} mm` : "a plane"}`;
  if (feature.type === "split-face") return `${feature.faces.length} face${feature.faces.length === 1 ? "" : "s"} split`;
  if (feature.type === "boundary-fill") return `${feature.cellPointsMillimeters.length} cell${feature.cellPointsMillimeters.length === 1 ? "" : "s"} of ${feature.toolBodyIds.length} tools · ${feature.operation}`;
  if (feature.type === "lip") return `${feature.shape} ${feature.side} · ${feature.widthMillimeters} × ${feature.heightMillimeters} mm`;
  if (feature.type === "snap-fit") return `${feature.lengthMillimeters} × ${feature.thicknessMillimeters} × ${feature.widthMillimeters} mm · catch ${feature.catchDepthMillimeters}`;
  if (feature.type === "rest") return `${feature.widthMillimeters}${feature.lengthMillimeters ? ` × ${feature.lengthMillimeters}` : " Ø"} × ${feature.heightMillimeters} mm`;
  if (feature.type === "coil") return `R${feature.radiusMillimeters} · pitch ${feature.pitchMillimeters} · ${feature.turns} turns`;
  if (feature.type === "remove-body") return `${feature.bodyIds.length} parts removed`;
  if (feature.type === "pipe") return `Ø${feature.diameterMillimeters} mm${feature.wallMillimeters ? ` · ${feature.wallMillimeters} mm wall` : ""}`;
  if (feature.type === "bounding-solid") return `${feature.marginMillimeters} mm margin`;
  if (feature.type === "shape-binder") return feature.faces?.length ? `${feature.faces.length} faces of ${feature.sourceBodyId}` : `copy of ${feature.sourceBodyId}`;
  if (feature.type === "thread") return `${feature.designation}${feature.threadClass ? ` ${feature.threadClass}` : ""} cosmetic`;
  if (feature.type === "curve3d") return feature.kind === "point" ? "3D point" : `3D ${feature.kind} · ${feature.pointsMillimeters.length} points`;
  if (feature.type === "split") return `keep ${feature.keep} · ${feature.plane.kind === "principal" ? feature.plane.plane : feature.plane.kind}`;
  if (feature.type === "delete-face") return `${feature.faces.length} faces removed`;
  if (feature.type === "offset-face") return feature.replaceWith ? `replace ${feature.faces.length} faces` : `${feature.distanceMillimeters} mm · ${feature.faces.length} faces`;
  if (feature.type === "face-extrude") return `${feature.distanceMillimeters} mm · ${feature.faceLabel}`;
  if (feature.type === "boolean") return `${feature.operation} · ${feature.toolBodyIds.length} tools${feature.keepTools ? " · keep tools" : ""}`;
  if (feature.type === "pattern") return `${feature.patternType} · ${feature.count} occurrences · ${feature.axis}`;
  if (feature.type === "draft") return `${feature.angleDegrees}° · ${feature.facePlane.plane} · ${feature.reversed ? "reverse" : "normal"}`;
  if (feature.type === "loft") return `${feature.sections.length} sections · ${feature.operation} · ${feature.ruled ? "ruled" : "smooth"}`;
  if (feature.type === "hole") {
    const thread = feature.thread ? `${feature.thread.designation} ${feature.thread.tapped ? (feature.thread.modeled ? "modelled thread" : "tapped") : `${feature.thread.fit ?? "normal"} clearance`} · ` : "";
    return `${thread}${feature.diameterMillimeters} mm · ${feature.cutType} · ${feature.depthType}`;
  }
  if (feature.type === "import-cad") return `${feature.format.toUpperCase()} · ${feature.meshMode === "reference" ? "Mesh reference · " : ""}${feature.sourceName}`;
  if (feature.type === "import-step") return `STEP · ${feature.sourceName}`;
  if (feature.type === "sketch") {
    const state = sketchDefinitionState(feature);
    return `${feature.plane} · ${feature.profile.widthMillimeters} × ${feature.profile.heightMillimeters} mm · ${state.label}`;
  }
  if (feature.type === "extrude") {
    const extent = feature.endType === "through-all" ? "Through all"
      : feature.endType === "up-to-face" ? "Up to face"
      : feature.endType === "up-to-next" ? "Up to next"
      : `${feature.distanceMillimeters} mm${feature.endType === "symmetric" ? " symmetric" : ""}`;
    const operation = {new:"New",add:"Add",cut:"Remove",intersect:"Intersect"}[feature.operation];
    return `${extent} · ${operation}${feature.targetBodyIds ? ` · ${feature.targetBodyIds.length} parts` : ""}`;
  }
  if(feature.type === "plane") return `${feature.plane} · ${feature.offsetMillimeters} mm offset`;
  if(feature.type === "point") return ({ vertex: "at vertex", "two-edges": "through two edges", "three-planes": "through three planes", center: "at centre", "edge-plane": "at edge and plane", "along-path": "along path" } as Record<string,string>)[feature.definition.method] ?? "point";
  if(feature.type === "axis") return ({ edge: "through edge", "two-points": "through two points", "normal-to-plane": "normal to plane", "two-planes": "through two planes" } as Record<string,string>)[feature.definition.method] ?? "axis";
  if (feature.type === "profile") {
    if (feature.profile.type === "drawing") {
      const { state } = sketchConstraintState(feature.profile);
      const label = state === "over-constrained" ? "Error" : state === "under-constrained" ? "Under-defined" : state === "fully-constrained" ? "Fully defined" : "Sketch";
      return `${feature.plane} · ${label}`;
    }
    return `${feature.plane} · ${feature.profile.type}`;
  }
  if (feature.type === "revolve")
    return `${feature.angleDegrees}° · ${feature.operation}`;
  if (feature.type === "mirror")
    return `${feature.plane} · ${feature.operation}`;
  if (feature.type === "sweep")
    return `${feature.operation}`;
  if (feature.type === "shell")
    return `${feature.thicknessMillimeters} mm`;
  if (feature.type === "sheet-base") return `${feature.thicknessMillimeters} mm · R${feature.bendRadiusMillimeters} · K ${feature.kFactor}`;
  if (feature.type === "sheet-flange") return `${feature.distanceMillimeters} mm · ${feature.angleDegrees}° · ${feature.edges.length} edges`;
  if (feature.type === "sheet-hem") return `${feature.lengthMillimeters} mm · ${feature.edges.length} edges`;
  if (feature.type === "sheet-fold") return `${feature.angleDegrees}° along a sketch line`;
  if (feature.type === "sheet-unfold") return "flat pattern";
  if (feature.type === "sheet-refold") return "folded";
  if (feature.type === "surface-boundary") return `${feature.edges.length} edges filled`;
  if (feature.type === "surface-blend") return `${feature.from.edges.length} + ${feature.to.edges.length} edges`;
  if (feature.type === "surface-untrim") return "holes removed";
  if (feature.type === "surface-ruled") return `${feature.distanceMillimeters} mm · ${feature.mode} · ${feature.edges.length} edges`;
  if (feature.type === "surface-extend") return `${feature.distanceMillimeters} mm · ${feature.edges.length} edges`;
  if (feature.type === "surface-extrude") return `${feature.distanceMillimeters} mm sheet`;
  if (feature.type === "surface-revolve") return `${feature.angleDegrees}° sheet`;
  if (feature.type === "surface-loft") return `${feature.sections.length} sections · sheet`;
  if (feature.type === "surface-patch") return "planar patch";
  if (feature.type === "surface-sweep") return "swept sheet";
  if (feature.type === "surface-offset") return `${feature.distanceMillimeters} mm offset`;
  if (feature.type === "surface-thicken") return `${feature.thicknessMillimeters} mm · ${feature.operation}`;
  if (feature.type === "surface-stitch") return `${feature.bodyIds.length} sheets sewn`;
  if (feature.type === "surface-unstitch") return "faces apart";
  if (feature.type === "surface-reverse-normal") return "normal reversed";
  if (feature.type === "surface-fair") return `strength ${feature.strength ?? 1}${feature.toleranceMillimeters !== undefined ? ` · ≤ ${feature.toleranceMillimeters} mm` : ""}`;
  if (feature.type === "fillet" && feature.filletType === "full-round") { const n = feature.replacedFaces?.length ?? 0; return `full round · ${n} face${n === 1 ? "" : "s"}`; }
  return `${feature.radiusMillimeters} mm`;
}

/** All saved operations in replay order, including placement actions. */
export function buildPartHistory(document: PartDocument): PartTreeItem[] {
  const errors = errorsForDocument(document);
  return document.features.map((feature, index) => ({
    id: feature.id,
    name: feature.name,
    kind: feature.type,
    error: errors.get(feature.id),
    detail: feature.suppressed
      ? "Suppressed"
      : index >= rollbackPosition(document) ? "Rolled back" : featureDetail(feature),
    children: [],
  }));
}

/** Shape-defining features and bodies; placement actions are available in History. */
export function buildPartFeatureTree(document: PartDocument): PartTreeItem {
  return {
    id: document.documentId,
    name: document.name,
    kind: "part-document",
    detail: "Part Studio",
    children: [
      ...buildPartHistory(document).filter((_, index) => !isPartPlacementAction(document.features[index])),
      ...availableBodies(renderableDocument(document)!).map((body) => ({
        id: body.id,
        name: body.name,
        kind: "body" as const,
        detail: !body.visible ? "Hidden" : document.features.some(f => f.type === "import-cad" && f.bodyId === body.id && f.meshMode === "reference") ? "Mesh reference" : "Solid",
        children: [],
      })),
    ],
  };
}
