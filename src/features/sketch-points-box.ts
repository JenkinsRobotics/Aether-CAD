/** Onshape's "Sketch points to place holes": a box of picked sketch points. Points are picked in
 *  the viewport (the sketch's vertices and circle centres), from the list beside the box, or by
 *  selecting a sketch in the tree, which takes every point of that sketch, as Onshape does. */
import { cadWorkspace } from "../cad-workspace-store";
import { extrusionSketchPoints } from "../modeling/extrude-point-reference";
import { serializeExtrusionPoint } from "./extrude-point-picker";
import { referencePickerLifecycle } from "./reference-picker-lifecycle";
import { rowIn, type Control, type FeatureEditorContext } from "./shared";

type Choice = { kind: "sketch-choice"; sourceFeatureId: string; contourIndex: number; index: number; label: string };
type Stored = Choice | { kind: "sketch-point"; sourceFeatureId: string; contourId: string; point: "vertex" | "center"; vertexId?: string; label: string };

export function mountSketchPointsBox(context: FeatureEditorContext, control: Control, title: string) {
  const { win, form, doc, feature } = context;
  control.closest("label")?.remove(); control.hidden = true; control.setAttribute("form", form.id); form.append(control);
  const element = document.createElement("div"), box = win.entitiesBox(title);
  element.append(box.element); win.body.append(element);
  const available = () => extrusionSketchPoints(doc, feature?.id);
  const choice = (point: ReturnType<typeof extrusionSketchPoints>[number]): Choice => ({ kind: "sketch-choice", sourceFeatureId: point.sourceFeatureId, contourIndex: point.contourIndex, index: point.index, label: point.label });
  const key = (ref: Stored) => ref.kind === "sketch-choice" ? `${ref.sourceFeatureId}:${ref.contourIndex}:${ref.index}` : `${ref.sourceFeatureId}:${ref.contourId}:${ref.point}:${ref.vertexId ?? ""}`;
  const read = (): Stored[] => JSON.parse(control.value || "[]");
  const update = (refs: Stored[]) => { control.value = JSON.stringify(refs); render(); control.dispatchEvent(new Event("change")); };
  const add = (refs: Stored[]) => { const known = new Set(read().map(key)); update([...read(), ...refs.filter((ref) => !known.has(key(ref)))]); };
  const render = () => box.render(read().map((ref, index) => ({ label: ref.label, onRemove: () => update(read().filter((_, i) => i !== index)) })));
  // The list of every sketch point in earlier sketches; choosing one adds it.
  const select = document.createElement("select"); select.setAttribute("aria-label", `${title} sketch point`);
  const empty = document.createElement("option"); empty.value = ""; empty.textContent = "Add a sketch point"; select.append(empty);
  for (const point of available()) { const option = document.createElement("option"); option.value = JSON.stringify(choice(point)); option.textContent = point.label; select.append(option); }
  select.onchange = () => { if (select.value) add([JSON.parse(select.value)]); select.value = ""; };
  element.append(rowIn("Sketch point", select));
  // Viewport picks: while this box is the active picker the viewer answers a click on a sketch point.
  let active = false;
  const lifecycle = referencePickerLifecycle("vertex", () => win.panel.isConnected, (value) => { active = value; box.element.dataset.picking = String(value); window.dispatchEvent(new CustomEvent("aether-sketch-point-picking", { detail: value })); });
  box.element.addEventListener("pointerdown", () => lifecycle.setActive(true));
  const receive = (event: Event) => {
    if (!active || !win.panel.isConnected) return;
    const pick = (event as CustomEvent).detail as { sourceFeatureId: string; contourIndex: number; index: number } | undefined;
    const point = pick && available().find((p) => p.sourceFeatureId === pick.sourceFeatureId && p.contourIndex === pick.contourIndex && p.index === pick.index);
    if (point) add([choice(point)]);
  };
  window.addEventListener("aether-sketch-point", receive);
  // A sketch selected in the tree contributes all of its points.
  const unsubscribe = cadWorkspace.subscribe(() => {
    if (!win.panel.isConnected) return;
    for (const id of cadWorkspace.snapshot().selectedItemIDs) {
      const sketchId = /^feature\/(?:sketch|profile)\/(.+)$/.exec(id)?.[1];
      if (sketchId) add(available().filter((point) => point.sourceFeatureId === sketchId).map(choice));
    }
  });
  const observer = new window.MutationObserver(() => { if (win.panel.isConnected) return; observer.disconnect(); unsubscribe(); window.removeEventListener("aether-sketch-point", receive); lifecycle.dispose(); });
  observer.observe(document.body, { childList: true, subtree: true });
  const note = document.createElement("p"); note.textContent = "One hole at each sketch point: click sketch points in the viewport, pick them from the list, or select a sketch in the tree to take all of its points."; win.addHelp(note);
  render(); lifecycle.setActive(true);
  return { element, read, update, serialize: () => read().map((ref) => serializeExtrusionPoint(JSON.stringify(ref), context)) };
}
