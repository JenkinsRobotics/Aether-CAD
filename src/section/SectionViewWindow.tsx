/** Section view — Onshape's: pick a planar face (or a default plane), drag the
 *  handle or type an offset, and exclude/include bodies. Every change previews
 *  live; ✓ keeps the section, ✕ restores what was there before. */
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { AetherIcon, MenuButton, openFeatureWindow } from "@aether/ui";
import { displayQuantity, parseQuantity, unitChoice } from "@aether/core/units";
import { cadSelection, type CADSelectionItem } from "../cad-selection-store";
import { documentUnits } from "../document-preferences";
import "./section-view.css";
import { DEFAULT_SECTION_PLANES, sectionView, type SectionView, type Vec3 } from "./section-view-store";

type Frame = { originMillimeters: Vec3; normal: Vec3 } | null;
type Projection = { start: { x: number; y: number }; end: { x: number; y: number }; valueAt: (x: number, y: number) => number | null } | null;

let closeOpen: (() => void) | null = null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach(listener => listener());
export const sectionEditorOpen = () => closeOpen !== null;
export const subscribeSectionEditor = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function turnOffSectionView(): void { closeOpen?.(); sectionView.set(null); }

/** The body an item belongs to, as Exclude/Include lists it. */
const bodyOf = (item: CADSelectionItem) => ({ id: item.partId, label: item.kind === "body" ? item.label : item.label.replace(/^.* of /, "") });

export function openSectionView(): void {
  if (closeOpen) return;
  const before = sectionView.snapshot();
  let draft: SectionView = before ?? { plane: null, offsetMillimeters: 0, mode: "exclude", items: [] };
  let active: "planes" | "items" = draft.plane ? "items" : "planes";
  // The active field decides what a click picks: a face for the plane, a body for the lists.
  const previousFilter = cadSelection.snapshot().filter;
  const pickFor = () => cadSelection.dispatch({ type: "set-filter", filter: active === "planes" ? "face" : "body" });
  const icon = document.createElement("span"), menuHost = document.createElement("span"), reactHost = document.createElement("div");
  const close = (keep: boolean) => {
    if (!closeOpen) return;
    closeOpen = null;
    unsubscribe(); cancelAnimationFrame(frame); handle.remove(); root.unmount(); win.close();
    cadSelection.dispatch({ type: "set-filter", filter: previousFilter });
    sectionView.set(keep ? (draft.plane ? draft : null) : before);
    changed();
  };
  const win = openFeatureWindow({ className: "cad-section-window", viewport: document.querySelector<HTMLElement>(".cad-studio-viewport") ?? document.body,
    title: "Section view", headerIcon: icon, acceptLabel: "Accept section view", discardLabel: "Cancel", onAccept: () => close(true), onDiscard: () => close(false) });
  const tabs = win.tabs(["Exclude", "Include"], draft.mode === "include" ? 1 : 0);
  const planes = win.entitiesBox("Section planes");
  const items = win.entitiesBox("Items to exclude");
  menuHost.className = "cad-section-plane-menu";
  planes.element.append(menuHost);

  const update = (next: Partial<SectionView>) => { draft = { ...draft, ...next }; win.setError(null); sectionView.set(draft, true); render(); };
  const focus = (field: "planes" | "items") => { active = field; render(); };
  planes.element.addEventListener("click", () => focus("planes"));
  items.element.addEventListener("click", () => focus("items"));
  [...tabs.children].forEach((tab, index) => tab.addEventListener("click", () => update({ mode: index ? "include" : "exclude" })));

  // Picks in the model fill the active field, then clear the model selection.
  // One click can notify more than once (selection, then hover): handle each pick once.
  let handled: readonly CADSelectionItem[] | null = null;
  const unsubscribe = cadSelection.subscribe(() => {
    const picked = cadSelection.snapshot().items;
    if (!picked.length || picked === handled) return;
    handled = picked;
    if (active === "planes") {
      const face = picked.find(item => item.kind === "face");
      let frame: Frame = null;
      if (face) window.dispatchEvent(new CustomEvent("aether-section-face", { detail: { respond: (value: Frame) => { frame = value; } } }));
      queueMicrotask(() => cadSelection.dispatch({ type: "clear" }));
      if (!face || !frame) { win.setError("Select a planar face, or choose Top, Front or Right."); return; }
      const { originMillimeters, normal } = frame as NonNullable<Frame>;
      active = "items";
      update({ plane: { label: face.label, originMillimeters, normal }, offsetMillimeters: 0 });
      return;
    }
    let list = [...draft.items];
    for (const body of picked.map(bodyOf)) list = list.some(item => item.id === body.id) ? list.filter(item => item.id !== body.id) : [...list, body];
    queueMicrotask(() => cadSelection.dispatch({ type: "clear" }));
    update({ items: list });
  });

  // The handle: an arrow along the plane normal, dragged in the model, and the offset box.
  const units = documentUnits(), length = unitChoice(units, "length");
  const handle = document.createElement("div");
  handle.className = "cad-section-handle";
  handle.innerHTML = `<svg aria-hidden="true"><line/><circle r="7"/></svg><input aria-label="Section offset (${length.unit})" inputmode="decimal">`;
  const viewport = document.querySelector<HTMLElement>(".cad-studio-viewport") ?? document.body;
  viewport.append(handle);
  const line = handle.querySelector("line")!, knob = handle.querySelector("circle")!, input = handle.querySelector("input")!;
  const origin = () => viewport.getBoundingClientRect();
  let frame = 0, drag: { projection: NonNullable<Projection>; grab: number } | null = null;
  const project = (): Projection => { let value: Projection = null; window.dispatchEvent(new CustomEvent("aether-section-handle", { detail: { view: draft, respond: (p: Projection) => { value = p; } } })); return value; };
  const draw = () => {
    frame = requestAnimationFrame(draw);
    const projection = drag?.projection ?? project();
    handle.hidden = !draft.plane || !projection;
    if (!projection || !draft.plane) return;
    const box = origin(), live = drag ? project() ?? projection : projection;
    const [x1, y1, x2, y2] = [live.start.x - box.left, live.start.y - box.top, live.end.x - box.left, live.end.y - box.top];
    line.setAttribute("x1", String(x1)); line.setAttribute("y1", String(y1)); line.setAttribute("x2", String(x2)); line.setAttribute("y2", String(y2));
    knob.setAttribute("cx", String(x2)); knob.setAttribute("cy", String(y2));
    // The offset box sits behind the handle's base, clear of the knob.
    const along = Math.hypot(x2 - x1, y2 - y1) || 1;
    input.style.transform = `translate(${x1 - (x2 - x1) / along * 56 - 42}px, ${y1 - (y2 - y1) / along * 56 - 11}px)`;
    if (document.activeElement !== input) input.value = `${displayQuantity(draft.offsetMillimeters / 1000, units, "length")} ${length.unit}`;
  };
  knob.addEventListener("pointerdown", event => {
    const projection = project(); if (!projection) return;
    const value = projection.valueAt(event.clientX, event.clientY); if (value === null) return;
    event.preventDefault(); event.stopPropagation();
    knob.setPointerCapture(event.pointerId);
    drag = { projection, grab: value - draft.offsetMillimeters };
  });
  knob.addEventListener("pointermove", event => {
    if (!drag) return;
    const value = drag.projection.valueAt(event.clientX, event.clientY);
    if (value !== null && Number.isFinite(value)) update({ offsetMillimeters: value - drag.grab });
  });
  const release = () => { drag = null; };
  knob.addEventListener("pointerup", release); knob.addEventListener("pointercancel", release);
  input.addEventListener("keydown", event => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    try { update({ offsetMillimeters: parseQuantity(input.value.replace(new RegExp(`\\s*${length.unit}$`), ""), units, "length") * 1000 }); input.blur(); }
    catch { win.setError(`Enter the offset as a number in ${length.unit}.`); }
  });
  input.addEventListener("blur", () => { input.value = ""; });

  const root = createRoot(reactHost);
  const render = () => {
    planes.render(draft.plane ? [{ label: draft.plane.label, onRemove: () => { active = "planes"; update({ plane: null }); } }] : []);
    items.render(draft.items.map(item => ({ label: item.label, onRemove: () => update({ items: draft.items.filter(entry => entry.id !== item.id) }) })));
    items.element.querySelector(".aui-feature-entities-caption")!.textContent = draft.mode === "include" ? "Items to include" : "Items to exclude";
    if (cadSelection.snapshot().filter !== (active === "planes" ? "face" : "body")) pickFor();
    planes.element.dataset.active = String(active === "planes");
    items.element.dataset.active = String(active === "items");
    root.render(<>
      {createPortal(<AetherIcon name="section-view"/>, icon)}
      {createPortal(<MenuButton label="Default section planes" items={DEFAULT_SECTION_PLANES.map(plane => ({ id: plane.label, label: `${plane.label} plane` }))}
        onSelect={id => { const plane = DEFAULT_SECTION_PLANES.find(entry => entry.label === id)!; active = "items"; update({ plane, offsetMillimeters: 0 }); }}>
        <AetherIcon name="planes-axes"/></MenuButton>, menuHost)}
    </>);
  };
  closeOpen = () => close(false);
  sectionView.set(draft, true);
  render(); draw(); changed();
}
