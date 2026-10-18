import { errorsForDocument, renderableDocument } from "./modeling/feature-errors";
import { availableBodies, rollbackPosition } from "@aether/core/document";
import type { PartDocument, PartFeature } from "./part-document";
import { sketchConstraintState } from "@aether/core/sketch";
import { sketchDefinitionState } from "./sketch-constraints";

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
  if (feature.type === "offset-face") return `${feature.distanceMillimeters} mm · ${feature.faces.length} faces`;
  if (feature.type === "face-extrude") return `${feature.distanceMillimeters} mm · ${feature.faceLabel}`;
  if (feature.type === "boolean") return `${feature.operation} · ${feature.toolBodyIds.length} tools${feature.keepTools ? " · keep tools" : ""}`;
  if (feature.type === "pattern") return `${feature.patternType} · ${feature.count} occurrences · ${feature.axis}`;
  if (feature.type === "draft") return `${feature.angleDegrees}° · ${feature.facePlane.plane} · ${feature.reversed ? "reverse" : "normal"}`;
  if (feature.type === "loft") return `${feature.sections.length} sections · ${feature.operation} · ${feature.ruled ? "ruled" : "smooth"}`;
  if (feature.type === "hole") return `${feature.diameterMillimeters} mm · ${feature.cutType} · ${feature.depthType}`;
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
  return `${feature.radiusMillimeters} mm`;
}

/** Projects editable feature history into the Items browser without duplicating CAD state. */
export function buildPartFeatureTree(document: PartDocument): PartTreeItem {
  const errors = errorsForDocument(document);
  return {
    id: document.documentId,
    name: document.name,
    kind: "part-document",
    detail: ".acpart",
    children: [
      ...document.features.map((feature) => ({
        id: feature.id,
        name: feature.name,
        kind: feature.type,
        error: errors.get(feature.id),
        detail: feature.suppressed
          ? "Suppressed"
          : document.features.indexOf(feature) >= rollbackPosition(document)
            ? "Rolled back"
            : featureDetail(feature),
        children: [],
      })),
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
