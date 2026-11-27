/** Shared by Fillet and Chamfer (one file each): the entities box of viewport edge picks, the
 *  Tangent propagation row, the hidden edge-scope fields saved documents may still use
 *  (every edge, or every edge in a plane), and their serialization. */
import type { EdgeFinishEdge, SolidFaceReference } from "@aether/core/document";
import { faceIdentity, mountPickedReferences } from "./picked-references";
import { checkRow, type Controls, type FeatureEditorContext } from "./shared";

export const edgeIdentity = (edge: EdgeFinishEdge) => edge.kind === "face-edges" ? faceIdentity(edge) : JSON.stringify(edge.kind === "solid-edge" ? [edge.bodyId, edge.anchor.start.signature, edge.anchor.end.signature] : [edge.bodyId, edge.midpointMillimeters, edge.lengthMillimeters]);

export function edgeFinishControls({ field, feature }: FeatureEditorContext): Controls {
  return {
    // Picked edges by default; "all" and "plane" remain for saved documents that use them.
    edgeScope: field("Edges", feature?.edgePlane ? "plane" : feature && !feature.edges ? "all" : "picked", ["picked", "all", "plane"]),
    edgePlane: field("Edge plane", feature?.edgePlane?.plane ?? "XY", ["XY", "XZ", "YZ"]),
    edgeOffset: field("Edge plane offset (mm)", String(feature?.edgePlane?.offsetMillimeters ?? 0)),
    edges: field("Picked edges", JSON.stringify(feature?.edges ?? [])),
    tangentChain: field("Tangent propagation", feature ? (feature.tangentChain ? "yes" : "no") : "yes", ["no", "yes"]),
  };
}

/** The entities box (prepended to the window) and Tangent propagation; legacy scope rows for saved documents. */
export function layoutEdgeFinish(context: FeatureEditorContext, controls: Controls, title: string) {
  const { win, form, feature, lengthUnitLabel } = context;
  for (const key of ["edges", "edgeScope", "edgePlane", "edgeOffset"] as const) { const control = controls[key]; control.closest("label")?.remove(); control.hidden = true; control.setAttribute("form", form.id); form.append(control); }
  const tangent = checkRow(context, controls.tangentChain, "Tangent propagation");
  if (feature?.edgePlane || (feature && !feature.edges)) {
    const row = (label: string, control: Controls[string], unit?: string) => { control.hidden = false; const el = win.row(label, control, ...(unit ? [Object.assign(document.createElement("span"), { className: "aui-feature-unit", textContent: unit })] : [])); return el; };
    const scope = row("Edges", controls.edgeScope), plane = row("Edge plane", controls.edgePlane), offset = row("Edge plane offset", controls.edgeOffset, lengthUnitLabel);
    const sync = () => { plane.hidden = offset.hidden = controls.edgeScope.value !== "plane"; };
    scope.hidden = false; controls.edgeScope.addEventListener("change", sync); sync();
  }
  // Faces and edges in one box: a face stands for every edge of that face (the kernel expands it).
  const entities = mountPickedReferences<EdgeFinishEdge>(context, controls.edges, {
    title, kind: "entity", requestEvent: "aether-finish-edges-request", replyEvent: "aether-finish-edges", replyKey: "edges", identity: edgeIdentity,
    faceToRef: (face) => ({ kind: "face-edges", ...(face as SolidFaceReference) }),
    onChange: (edges) => { if (edges.length) { controls.edgeScope.value = "picked"; controls.edgeScope.dispatchEvent(new Event("change")); } },
  });
  return { entities: entities.element, tangent };
}

export function validateEdgeFinish(controls: Controls, verb: string): string | null {
  if (controls.edgeScope.value === "picked" && !JSON.parse(controls.edges.value).length) return `Select the faces or edges to ${verb}.`;
  return null;
}

export function serializeEdgeFinish(values: Record<string, string>) {
  return values.edgeScope === "plane"
    ? { edgePlane: { plane: values.edgePlane, offsetMillimeters: Number(values.edgeOffset) } }
    : values.edgeScope === "picked" ? { edges: JSON.parse(values.edges), ...(values.tangentChain === "yes" ? { tangentChain: true } : {}) } : {};
}
