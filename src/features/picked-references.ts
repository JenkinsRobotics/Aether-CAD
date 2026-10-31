/** A list of viewport picks in a feature window: faces or edges, added from the
 *  current selection through a main-thread request (the viewer builds the exact
 *  references, the dialog never manufactures identities). Shared by every tool
 *  that takes individual faces or edges, SolidCraft's `faces: [...]` / `edges: [...]`. */
import { cadSelection } from "../cad-selection-store";
import { referencePickerLifecycle } from "./reference-picker-lifecycle";
import type { Control, FeatureEditorContext } from "./shared";

export interface PickedReferencesOptions<T> {
  title: string;
  kind: "face" | "edge";
  /** Main-thread request and reply events; the reply carries `{[replyKey]: T[]}` or `{error}`. */
  requestEvent: string;
  replyEvent: string;
  replyKey: string;
  identity: (ref: T) => string;
  note?: string;
  /** Called after the list changes (to flip a scope select, for instance). */
  onChange?: (refs: T[]) => void;
}

export function mountPickedReferences<T extends { label: string }>(context: FeatureEditorContext, control: Control, options: PickedReferencesOptions<T>) {
  const { win, form, feature } = context;
  control.closest("label")?.remove(); control.hidden = true; control.setAttribute("form", form.id); form.append(control);
  const box = win.entitiesBox(options.title); win.body.prepend(box.element);
  const read = (): T[] => JSON.parse(control.value || "[]");
  const update = (refs: T[]) => { control.value = JSON.stringify(refs); options.onChange?.(refs); render(); control.dispatchEvent(new Event("change")); };
  const render = () => box.render(read().map((ref, index) => ({ label: ref.label, onRemove: () => { cadSelection.dispatch({ type: "clear" }); update(read().filter((_, i) => i !== index)); } })));
  // Selecting in the viewport fills the list (the subscription below); each row removes itself. No Add/Clear buttons: the gallery's editors have none.
  let active = false;
  const lifecycle = referencePickerLifecycle(options.kind, () => win.panel.isConnected, (value) => { active = value; box.element.dataset.picking = String(value); window.dispatchEvent(new CustomEvent(`aether-source-${options.kind}-picking`, { detail: value })); });
  const request = () => { if (!active || !win.panel.isConnected) return; window.dispatchEvent(new CustomEvent(options.requestEvent, { detail: { beforeFeatureId: feature?.id } })); };
  box.element.addEventListener("pointerdown", () => { lifecycle.setActive(true); request(); });
  const receive = (event: Event) => {
    if (!active || !win.panel.isConnected) return;
    const reply = (event as CustomEvent).detail;
    const picked = reply?.[options.replyKey] as T[] | undefined;
    if (!picked?.length) { win.setError(reply?.error ?? `Select one or more ${options.kind}s.`); return; }
    const refs = read(), known = new Set(refs.map(options.identity));
    for (const ref of picked) if (!known.has(options.identity(ref))) { refs.push(ref); known.add(options.identity(ref)); }
    update(refs);
  };
  window.addEventListener(options.replyEvent, receive);
  let selected = cadSelection.snapshot().items;
  const unsubscribe = cadSelection.subscribe(() => { const next = cadSelection.snapshot().items; if (next === selected) return; selected = next; if (next.length && next.every((item) => item.kind === options.kind)) request(); });
  if (options.note) { const note = document.createElement("p");  note.textContent = options.note; win.addHelp(note); }
  const observer = new window.MutationObserver(() => { if (win.panel.isConnected) return; observer.disconnect(); unsubscribe(); window.removeEventListener(options.replyEvent, receive); lifecycle.dispose(); });
  observer.observe(document.body, { childList: true, subtree: true }); render(); lifecycle.setActive(true);
  if (!feature && selected.length && selected.every((item) => item.kind === options.kind)) queueMicrotask(request);
  return { read, update };
}

export const faceIdentity = (face: { sourceFeatureId: string; bodyId: string; normal?: unknown; surfaceType?: unknown; faceAnchor?: unknown }) => JSON.stringify([face.sourceFeatureId, face.bodyId, face.normal, face.surfaceType, face.faceAnchor]);
