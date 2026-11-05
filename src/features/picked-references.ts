/** A list of viewport picks in a feature window: faces or edges, added from the
 *  current selection through a main-thread request (the viewer builds the exact
 *  references, the dialog never manufactures identities). Shared by every tool
 *  that takes individual faces or edges, SolidCraft's `faces: [...]` / `edges: [...]`. */
import { cadSelection, type CADSelectionItem } from "../cad-selection-store";
import { referencePickerLifecycle } from "./reference-picker-lifecycle";
import type { Control, FeatureEditorContext } from "./shared";

export interface PickedReferencesOptions<T> {
  title: string;
  /** "entity": faces or edges, whichever the pointer is nearer; faces arrive through `faceToRef`. */
  kind: "face" | "edge" | "entity";
  faceToRef?: (face: { label: string }) => T;
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
  const update = (refs: T[]) => { const value = JSON.stringify(refs); if (value === control.value) return; control.value = value; options.onChange?.(refs); render(); control.dispatchEvent(new Event("change")); };
  const render = () => box.render(read().map(ref => ({ label: ref.label, onRemove: () => { cadSelection.dispatch({ type: "clear" }); update(read().filter(item => options.identity(item) !== options.identity(ref))); } })));
  // Selecting in the viewport fills the list (the subscription below); each row removes itself. No Add/Clear buttons: the gallery's editors have none.
  let active = false;
  const entity = options.kind === "entity";
  // Entities pick in the viewer's one rule (auto): a vertex or edge within reach, else the face.
  const lifecycle = referencePickerLifecycle(entity ? "auto" : options.kind as "face" | "edge", () => win.panel.isConnected, (value) => {
    active = value; box.element.dataset.picking = String(value);
    window.dispatchEvent(new CustomEvent(`aether-source-${options.kind}-picking`, { detail: value }));
  });
  const kindOf = (items: readonly { kind: string }[]) => items.length && items.every((item) => item.kind === items[0].kind) ? items[0].kind : null;
  // Main-thread reference resolution is synchronous. A preview refresh can also
  // update global selection; it must not reenter or reinterpret a pointer toggle.
  let requesting = false, toggleReply = false;
  const request = (selection?: readonly CADSelectionItem[], toggle = false) => {
    if (!active || !win.panel.isConnected || requesting) return;
    requesting = true; toggleReply = toggle;
    try {
      const items = selection ?? cadSelection.snapshot().items;
      const event = entity && kindOf(items) === "face" ? "aether-offset-faces-request" : options.requestEvent;
      window.dispatchEvent(new CustomEvent(event, { detail: { beforeFeatureId: feature?.id, ...(selection ? { selection } : {}) } }));
    } finally { requesting = false; toggleReply = false; }
  };
  box.element.addEventListener("pointerdown", event => {
    lifecycle.setActive(true);
    // A request replaces entity rows. Never detach the remove button between
    // pointerdown and click, which would swallow the browser's click entirely.
    if (!(event.target instanceof window.Element && event.target.closest('button'))) request();
  });
  const add = (picked: T[]) => {
    const refs = read(), known = new Set(refs.map(options.identity));
    const unique = [...new Map(picked.map(ref => [options.identity(ref), ref])).values()];
    const removed = toggleReply ? new Set(unique.map(options.identity).filter(id => known.has(id))) : new Set<string>();
    update([...refs.filter(ref => !removed.has(options.identity(ref))), ...unique.filter(ref => !known.has(options.identity(ref)))]);
  };
  const receive = (event: Event) => {
    if (!active || !win.panel.isConnected) return;
    const reply = (event as CustomEvent).detail;
    const picked = reply?.[options.replyKey] as T[] | undefined;
    if (!picked?.length) { win.setError(reply?.error ?? `Select one or more ${entity ? "faces or edges" : options.kind + "s"}.`); return; }
    add(picked);
  };
  const receiveFaces = (event: Event) => {
    if (!entity || !active || !win.panel.isConnected) return;
    const faces = (event as CustomEvent).detail?.faces as { label: string }[] | undefined;
    if (!faces?.length) { win.setError((event as CustomEvent).detail?.error ?? "Select faces or edges on an earlier solid part."); return; }
    add(faces.map((face) => options.faceToRef!(face)));
  };
  window.addEventListener(options.replyEvent, receive);
  if (entity) window.addEventListener("aether-offset-faces", receiveFaces);
  const accepts = (kind: string | null) => kind !== null && (entity ? kind === "face" || kind === "edge" : kind === options.kind);
  // Feature inputs own their selection set. Resolve the actual clicked item,
  // not the transient global selection, so normal and modifier clicks can both
  // remove an existing input without disturbing any other selected reference.
  const click = (event: Event) => {
    const item = (event as CustomEvent<{ item: CADSelectionItem }>).detail?.item;
    if (!active || !win.panel.isConnected || !item || !accepts(item.kind)) return;
    event.preventDefault(); request([item], true);
  };
  window.addEventListener('aether-feature-reference-click', click);
  let selected = cadSelection.snapshot().items;
  const unsubscribe = cadSelection.subscribe(() => { const next = cadSelection.snapshot().items; if (next === selected) return; selected = next; if (accepts(kindOf(next))) request(); });
  if (options.note) { const note = document.createElement("p");  note.textContent = options.note; win.addHelp(note); }
  const observer = new window.MutationObserver(() => { if (win.panel.isConnected) return; observer.disconnect(); unsubscribe(); window.removeEventListener(options.replyEvent, receive); window.removeEventListener("aether-offset-faces", receiveFaces); window.removeEventListener('aether-feature-reference-click', click); lifecycle.dispose(); });
  observer.observe(document.body, { childList: true, subtree: true }); render(); lifecycle.setActive(true);
  if (!feature && accepts(kindOf(selected))) queueMicrotask(request);
  return { read, update, element: box.element };
}

/** Archive codecs may reorder object keys. Compare the geometric discriminator,
 * not its JSON property order, so a reopened face still toggles off when clicked. */
export const faceIdentity = (face: { sourceFeatureId: string; bodyId: string; normal?: unknown; surfaceType?: unknown; faceAnchor?: unknown }) => {
  const anchor = face.faceAnchor as { centerMillimeters?: unknown; areaSquareMillimeters?: unknown } | undefined;
  return JSON.stringify([face.sourceFeatureId, face.bodyId, face.normal, face.surfaceType,
    anchor?.centerMillimeters, anchor?.areaSquareMillimeters]);
};
