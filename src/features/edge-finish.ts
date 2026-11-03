/** Shared by Fillet and Chamfer (one file each): the entities box of viewport edge picks, the
 *  Tangent propagation row, the hidden edge-scope fields saved documents may still use
 *  (every edge, or every edge in a plane), and their serialization. */
import type { EdgeFinishEdge } from "@aether/core/document";
import { mountPickedReferences } from "./picked-references";
import { checkRow, type Controls, type FeatureEditorContext } from "./shared";

const identity = (edge: EdgeFinishEdge) => JSON.stringify(edge.kind === "solid-edge" ? [edge.bodyId, edge.anchor.start.signature, edge.anchor.end.signature] : [edge.bodyId, edge.midpointMillimeters, edge.lengthMillimeters]);

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
  checkRow(context, controls.tangentChain, "Tangent propagation");
  if (feature?.edgePlane || (feature && !feature.edges)) {
    const row = (label: string, control: Controls[string], unit?: string) => { control.hidden = false; const el = win.row(label, control, ...(unit ? [Object.assign(document.createElement("span"), { className: "aui-feature-unit", textContent: unit })] : [])); return el; };
    const scope = row("Edges", controls.edgeScope), plane = row("Edge plane", controls.edgePlane), offset = row("Edge plane offset", controls.edgeOffset, lengthUnitLabel);
    const sync = () => { plane.hidden = offset.hidden = controls.edgeScope.value !== "plane"; };
    scope.hidden = false; controls.edgeScope.addEventListener("change", sync); sync();
  }
  mountPickedReferences<EdgeFinishEdge>(context, controls.edges, {
    title, kind: "edge", requestEvent: "aether-finish-edges-request", replyEvent: "aether-finish-edges", replyKey: "edges", identity,
    onChange: (edges) => { if (edges.length) { controls.edgeScope.value = "picked"; controls.edgeScope.dispatchEvent(new Event("change")); } },
  });
}

export function validateEdgeFinish(controls: Controls, verb: string): string | null {
  if (controls.edgeScope.value === "picked" && !JSON.parse(controls.edges.value).length) return `Select the edges to ${verb}.`;
  return null;
}

export function serializeEdgeFinish(values: Record<string, string>) {
  return values.edgeScope === "plane"
    ? { edgePlane: { plane: values.edgePlane, offsetMillimeters: Number(values.edgeOffset) } }
    : values.edgeScope === "picked" ? { edges: JSON.parse(values.edges), ...(values.tangentChain === "yes" ? { tangentChain: true } : {}) } : {};
}
