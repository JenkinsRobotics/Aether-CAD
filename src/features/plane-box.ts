/** One pick box for a plane (Onshape's "Mirror plane" / "Entity to split with"): filled by a
 *  tree click on Top, Front, Right or a Plane feature, a planar face picked in the viewport, or
 *  a straight sketch line (the plane through it along the sketch's normal). The control holds a
 *  MirrorPlaneReference as JSON; a chip shows the pick and removes it. */
import type { MirrorPlaneReference, SolidFaceReference } from "@aether/core/document";
import { cadSelection } from "../cad-selection-store";
import { cadWorkspace } from "../cad-workspace-store";
import { sketchDirectionLines } from "../modeling/extrude-direction-reference";
import { referencePickerLifecycle } from "./reference-picker-lifecycle";
import type { Control, FeatureEditorContext } from "./shared";

const PLANE_ROWS: Record<string, { plane: "XY" | "XZ" | "YZ"; label: string }> = { "top-plane": { plane: "XY", label: "Top Plane" }, "front-plane": { plane: "XZ", label: "Front Plane" }, "right-plane": { plane: "YZ", label: "Right Plane" } };

export function mountPlaneBox(context: FeatureEditorContext, control: Control, title: string, options: { sketchLines?: boolean } = {}) {
  const { win, form, doc, feature } = context;
  control.closest("label")?.remove(); control.hidden = true; control.setAttribute("form", form.id); form.append(control);
  const box = win.entitiesBox(title); win.body.append(box.element);
  const read = (): MirrorPlaneReference | null => (control.value ? JSON.parse(control.value) : null);
  const label = (ref: MirrorPlaneReference): string => ref.kind === "principal" ? (Object.values(PLANE_ROWS).find((row) => row.plane === ref.plane)?.label ?? ref.plane) + (ref.offsetMillimeters ? ` + ${ref.offsetMillimeters} mm` : "")
    : ref.kind === "feature" ? doc.features.find((f) => f.id === ref.featureId)?.name ?? "Unavailable plane"
    : ref.kind === "face" ? ref.label
    : sketchDirectionLines(doc, feature?.id).find((line) => line.sourceFeatureId === ref.sourceFeatureId && line.contourId === ref.contourId && line.segmentId === ref.segmentId)?.label ?? "Unavailable sketch line";
  const set = (ref: MirrorPlaneReference | null) => { control.value = ref ? JSON.stringify(ref) : ""; render(); control.dispatchEvent(new Event("change")); };
  const render = () => { const ref = read(); box.render(ref ? [{ label: label(ref), onRemove: () => { cadSelection.dispatch({ type: "clear" }); set(null); } }] : []); };
  const connected = () => win.panel.isConnected;
  // Planar faces come from the viewer's exact references, never manufactured here.
  let active = false;
  const lifecycle = referencePickerLifecycle("face", connected, (value) => { active = value; box.element.dataset.picking = String(value); window.dispatchEvent(new CustomEvent("aether-source-face-picking", { detail: value })); });
  box.element.addEventListener("pointerdown", () => lifecycle.setActive(true));
  const receiveFace = (event: Event) => {
    if (!active || !connected()) return;
    const face = ((event as CustomEvent).detail?.faces as SolidFaceReference[] | undefined)?.[0];
    if (face) set({ kind: "face", ...face });
  };
  window.addEventListener("aether-offset-faces", receiveFace);
  let seen = cadSelection.snapshot().items;
  const unsubscribeSelection = cadSelection.subscribe(() => {
    const items = cadSelection.snapshot().items; if (items === seen) return; seen = items;
    if (active && connected() && items.length === 1 && items[0].kind === "face") window.dispatchEvent(new CustomEvent("aether-offset-faces-request", { detail: { beforeFeatureId: feature?.id } }));
  });
  const unsubscribeTree = cadWorkspace.subscribe(() => {
    if (!connected()) return;
    for (const id of cadWorkspace.snapshot().selectedItemIDs) {
      // Tree rows are "reference/top-plane" (the Default geometry folder) or "feature/plane/<id>".
      const row = PLANE_ROWS[id.replace(/^reference\//, "")], planeFeature = /^feature\/plane\/(.+)$/.exec(id)?.[1];
      const next: MirrorPlaneReference | null = row ? { kind: "principal", plane: row.plane, offsetMillimeters: 0 } : planeFeature ? { kind: "feature", featureId: planeFeature } : null;
      if (next && control.value !== JSON.stringify(next)) set(next);
    }
  });
  // A principal plane clicked in the tree arrives as the sketch-plane pick (main.ts selectReference).
  const onPlane = (event: Event) => {
    const plane = (event as CustomEvent).detail;
    if (connected() && (plane === "XY" || plane === "XZ" || plane === "YZ")) set({ kind: "principal", plane, offsetMillimeters: 0 });
  };
  window.addEventListener("aether-sketch-plane", onPlane);
  const onCurve = (event: Event) => {
    if (!options.sketchLines || !connected()) return;
    const picked = (event as CustomEvent).detail as { sourceFeatureId: string; contourId: string; segmentId: string };
    if (!sketchDirectionLines(doc, feature?.id).some((line) => line.sourceFeatureId === picked.sourceFeatureId && line.contourId === picked.contourId && line.segmentId === picked.segmentId)) return;
    event.preventDefault(); set({ kind: "sketch-line", sourceFeatureId: picked.sourceFeatureId, contourId: picked.contourId, segmentId: picked.segmentId });
  };
  window.addEventListener("aether-sketch-curve-picked", onCurve);
  const observer = new window.MutationObserver(() => { if (connected()) return; observer.disconnect(); unsubscribeSelection(); unsubscribeTree(); window.removeEventListener("aether-offset-faces", receiveFace); window.removeEventListener("aether-sketch-plane", onPlane); window.removeEventListener("aether-sketch-curve-picked", onCurve); lifecycle.dispose(); });
  observer.observe(document.body, { childList: true, subtree: true });
  render();
  return { element: box.element, read, set };
}
