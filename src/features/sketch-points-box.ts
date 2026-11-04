/** Onshape's "Sketch points to place holes": a box of picked sketch points. Points are added from
 *  the list beside the box or by selecting a sketch in the tree, which takes every point of that
 *  sketch (a contour vertex or a circle centre), as Onshape does when a sketch is clicked.
 *  ponytail: sketch points are not yet pickable in the viewport (solid vertices are); the list
 *  and the tree stand in until the viewer offers sketch points. */
import { cadWorkspace } from "../cad-workspace-store";
import { extrusionSketchPoints } from "../modeling/extrude-point-reference";
import { serializeExtrusionPoint } from "./extrude-point-picker";
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
  // A sketch selected in the tree contributes all of its points.
  const unsubscribe = cadWorkspace.subscribe(() => {
    if (!win.panel.isConnected) return;
    for (const id of cadWorkspace.snapshot().selectedItemIDs) {
      const sketchId = /^feature\/(?:sketch|profile)\/(.+)$/.exec(id)?.[1];
      if (sketchId) add(available().filter((point) => point.sourceFeatureId === sketchId).map(choice));
    }
  });
  const observer = new window.MutationObserver(() => { if (win.panel.isConnected) return; observer.disconnect(); unsubscribe(); });
  observer.observe(document.body, { childList: true, subtree: true });
  const note = document.createElement("p"); note.textContent = "One hole at each sketch point: pick points from the list, or select a sketch in the tree to take all of its points."; win.addHelp(note);
  render();
  return { element, read, update, serialize: () => read().map((ref) => serializeExtrusionPoint(JSON.stringify(ref), context)) };
}
