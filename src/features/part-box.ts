/** A pick box of parts (bodies) filled from the viewport or tree selection, like Onshape's
 *  "Tools" / "Entities to pattern" boxes: no list to choose from, picks add chips, chips remove. */
import { cadSelection } from "../cad-selection-store";
import type { Control, FeatureEditorContext } from "./shared";

export function mountPartBox(context: FeatureEditorContext, control: Control, title: string, choices: { id: string; name: string }[], exclude: () => string = () => "", options: { single?: boolean; scalar?: boolean; isActive?: () => boolean } = {}) {
  const { win, form } = context;
  control.closest("label")?.remove(); control.hidden = true; control.setAttribute("form", form.id); form.append(control);
  const box = win.entitiesBox(title);
  // One part box takes the picks at a time (Onshape's focused field): the first mounted, or the one last clicked.
  const panel = win.panel as HTMLElement & { dataset: DOMStringMap };
  if (!panel.dataset.activePartBox) panel.dataset.activePartBox = title;
  box.element.addEventListener("pointerdown", () => { panel.dataset.activePartBox = title; });
  const active = () => !box.element.closest('[hidden]') && (options.isActive ? options.isActive() : panel.dataset.activePartBox === title);
  // `scalar`: the control holds one bare id (Extrude's stopping part), not a JSON list.
  const read = (): string[] => options.scalar ? (control.value ? [control.value] : []) : JSON.parse(control.value || "[]");
  const update = (ids: string[]) => { control.value = options.scalar ? (ids[0] ?? "") : JSON.stringify(ids); render(); control.dispatchEvent(new Event("change")); };
  const render = () => box.render(read().map((id) => ({ label: choices.find((body) => body.id === id)?.name ?? "Unavailable part", onRemove: () => update(read().filter((other) => other !== id)) })));
  let seen = cadSelection.snapshot().items;
  const unsubscribe = cadSelection.subscribe(() => {
    const items = cadSelection.snapshot().items; if (items === seen) return; seen = items;
    if (!win.panel.isConnected || !active()) return;
    const ids = read(), picked = [...new Set(items.map((item) => item.partId))].filter((id) => id && id !== exclude() && choices.some((body) => body.id === id) && !ids.includes(id));
    if (picked.length) update(options.single ? [picked[picked.length - 1]] : [...ids, ...picked]);
  });
  const observer = new window.MutationObserver(() => { if (win.panel.isConnected) return; observer.disconnect(); unsubscribe(); });
  observer.observe(document.body, { childList: true, subtree: true });
  render();
  return { element: box.element, read, update };
}
