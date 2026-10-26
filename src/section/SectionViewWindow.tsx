/** Section view — Onshape's: pick a planar face (or a default plane), drag the
 *  handle or type an offset, and exclude/include bodies. Every change previews
 *  live; ✓ keeps the section, ✕ restores what was there before. */
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { AetherIcon, Checkbox, FieldRow, Inspector, MenuButton, NumberField, openFeatureWindow } from "@aether/ui";
import { unitChoice } from "@aether/core/units";
import { type CADSelectionItem } from "../cad-selection-store";
import { documentUnits } from "../document-preferences";
import "./section-view.css";
import { DEFAULT_SECTION_PLANES, sectionView, activeSectionCut, newSectionCut, type SectionCut, type SectionView, type Vec3 } from "./section-view-store";

import { mountSectionHandle } from "./section-handle";
import { createInspectionSession } from "../inspection/inspection-session";
import { sectionFrame, rotateSection } from './section-frame';

type Frame = { originMillimeters: Vec3; normal: Vec3 } | null;


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
  let draft: SectionView = before ?? { planes: [], activePlaneId:null, mode: "exclude", items: [] };
  let active: "planes" | "items" = draft.planes.length ? "items" : "planes";
  // The active field decides what a click picks: a face for the plane, a body for the lists.
  const session = createInspectionSession({ filter: active === "planes" ? "face" : "body", changed: () => { if (closeOpen) render(); } });
  const pickFor = () => session.selection.dispatch({ type: "set-filter", filter: active === "planes" ? "face" : "body" });
  const icon = document.createElement("span"), menuHost = document.createElement("span"), reactHost = document.createElement("div");
  const close = (keep: boolean) => {
    if (!closeOpen) return;
    closeOpen = null;
    unsubscribe(); handle.dispose(); root.unmount(); session.dispose(); win.close();
    window.removeEventListener("keydown", escape);
    sectionView.set(keep ? (draft.planes.length ? draft : null) : before);
    changed();
  };
  const win = openFeatureWindow({ className: "cad-section-window", viewport: document.querySelector<HTMLElement>(".cad-studio-viewport") ?? document.body,
    title: "Section view", headerIcon: icon, acceptLabel: "Accept section view", discardLabel: "Cancel", onAccept: () => close(true), onDiscard: () => close(false) });
  const planeSection = win.section("Cutting planes");
  const planes = win.entitiesBox("Section planes");
  planeSection.body.append(planes.element);
  const planeHint=document.createElement('p');
  planeHint.textContent='Enabled planes cut together. Select a plane to adjust it.';win.addHelp(planeHint);
  const controls = document.createElement("div");
  planeSection.body.append(controls);
  const scopeSection = win.section("Bodies");
  const tabs = win.tabs(["Exclude", "Include"], draft.mode === "include" ? 1 : 0);
  scopeSection.body.append(tabs);
  const items = win.entitiesBox("Items to exclude");
  scopeSection.body.append(items.element);
  const hint = document.createElement("p");
  win.addHelp(hint);
  win.addHelp("Add a planar, cylindrical or conical face, or use the plus menu for a default plane. Drag either arrow or type an offset to move the selected plane. Drag the center to snap the plane to geometry. Rotate with the curved handles or the X/Y angle fields; hold Shift for 15° increments. Flip cut keeps the opposite side. View normal looks straight at the cut. Accept keeps the section; Cancel restores the previous settings.");
  menuHost.className = "cad-section-plane-menu";
  planes.element.append(menuHost);

  const update = (next: Partial<SectionView>) => { draft = { ...draft, ...next }; win.setError(null); sectionView.set(draft, true); render(); };
  const updateCut = (next: Partial<SectionCut>) => {
    const selected=activeSectionCut(draft);if(!selected)return;
    if (next.rotationDegrees && !('pivotMillimeters' in next)) next = { ...next, ...rotateSection(selected, next.rotationDegrees) };
    update({planes:draft.planes.map(cut=>cut.id===selected.id?{...cut,...next}:cut)});
  };
  const addCut = (plane:SectionCut['plane']) => {
    const cut = newSectionCut(plane);
    window.dispatchEvent(new CustomEvent('aether-section-handle', { detail: { view: cut, respond: (projection: {point?: Vec3} | null) => { if (projection?.point) cut.pivotMillimeters = projection.point; } } }));
    active='planes';update({planes:[...draft.planes,cut],activePlaneId:cut.id});
  };
  const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.defaultPrevented && win.isFrontmost()) { event.preventDefault(); close(false); } };
  const focus = (field: "planes" | "items") => { active = field; session.activate(); render(); };
  planes.element.addEventListener("click", () => focus("planes"));
  items.element.addEventListener("click", () => focus("items"));
  [...tabs.children].forEach((tab, index) => tab.addEventListener("click", () => update({ mode: index ? "include" : "exclude" })));

  // Picks in the model fill the active field, then clear the model selection.
  // One click can notify more than once (selection, then hover): handle each pick once.
  let handled: readonly CADSelectionItem[] | null = null;
  const unsubscribe = session.selection.subscribe(() => {
    if (!session.active()) return;
    const picked = session.selection.snapshot().items;
    if (!picked.length || picked === handled) return;
    handled = picked;
    if (active === "planes") {
      queueMicrotask(() => session.selection.dispatch({ type: "clear" }));
      let added = false;
      for (const face of picked.filter(item => item.kind === 'face')) {
        let frame: Frame = null;
        window.dispatchEvent(new CustomEvent("aether-section-face", { detail: { item: face, respond: (value: Frame) => { frame = value; } } }));
        if (!frame) continue;
        const { originMillimeters, normal } = frame as NonNullable<Frame>;
        addCut({ label: face.label, originMillimeters, normal }); added = true;
      }
      if (!added) win.setError("Select a planar face, cylinder or cone, or choose a default plane.");
      return;
    }
    let list = [...draft.items];
    for (const body of picked.map(bodyOf)) list = list.some(item => item.id === body.id) ? list.filter(item => item.id !== body.id) : [...list, body];
    queueMicrotask(() => session.selection.dispatch({ type: "clear" }));
    update({ items: list });
  });

  const units = documentUnits(), length = unitChoice(units, "length");
  const handle = mountSectionHandle(document.querySelector<HTMLElement>(".cad-studio-viewport") ?? document.body,
    () => activeSectionCut(draft), offsetMillimeters => updateCut({offsetMillimeters}), message => win.setError(message), updateCut);

  const root = createRoot(reactHost);
  const render = () => {
    const selected = activeSectionCut(draft);
    planes.render(draft.planes.map(cut => ({label:cut.plane.label, selected:cut.id===selected?.id,
      onSelect:()=>{active='planes';update({activePlaneId:cut.id});},
      onRemove:()=>{const remaining=draft.planes.filter(item=>item.id!==cut.id);active='planes';update({planes:remaining,activePlaneId:selected?.id===cut.id?remaining[0]?.id??null:selected?.id??null});}
    })));
    items.render(draft.items.map(item => ({ label: item.label, onRemove: () => update({ items: draft.items.filter(entry => entry.id !== item.id) }) })));
    items.element.querySelector(".aui-feature-entities-caption")!.textContent = draft.mode === "include" ? "Items to include" : "Items to exclude";
    items.element.setAttribute("aria-label", draft.mode === "include" ? "Items to include" : "Items to exclude");
    hint.textContent = draft.mode === "exclude" ? "All bodies are cut except those in Items to exclude." : "Only bodies in Items to include are cut.";
    win.accept.disabled = !draft.planes.length;
    if (session.selection.snapshot().filter !== (active === "planes" ? "face" : "body")) pickFor();
    planes.element.dataset.active = String(session.active() && active === "planes");
    items.element.dataset.active = String(session.active() && active === "items");
    root.render(<>
      {createPortal(<AetherIcon name="section-view"/>, icon)}
      {createPortal(<Inspector>
        <FieldRow label="Offset" onReset={(selected?.offsetMillimeters ?? 0) ? () => updateCut({ offsetMillimeters: 0 }) : undefined}>
          <NumberField aria-label="Section offset" value={(selected?.offsetMillimeters ?? 0) / (length.factor * 1000)} precision={length.decimals} unit={length.unit}
            disabled={!selected} onValueChange={value => {
              if (value !== null) updateCut({ offsetMillimeters: value * length.factor * 1000 });
              else win.setError(`Enter a valid offset in ${length.unit}.`);
            }}
            onKeyDown={event => { if (event.key === "Enter") event.stopPropagation(); }}/>
        </FieldRow>
        {[0, 1].map(axis => <FieldRow key={axis} label={`Rotation ${'XY'[axis]}`} onReset={(selected?.rotationDegrees?.[axis] ?? 0) ? () => {
          const angles: [number, number] = [...(selected?.rotationDegrees ?? [0, 0])]; angles[axis] = 0; updateCut({rotationDegrees: angles});
        } : undefined}>
          <NumberField aria-label={`Section rotation ${'XY'[axis]}`} value={selected?.rotationDegrees?.[axis] ?? 0} precision={2} unit="°" disabled={!selected}
            onValueChange={value => { if(value !== null) { const angles: [number, number] = [...(selected?.rotationDegrees ?? [0, 0])]; angles[axis] = value; updateCut({rotationDegrees: angles}); } }}/>
        </FieldRow>)}
        <FieldRow label="Cut"><Checkbox label="Enable plane" checked={!!selected && selected.enabled !== false} disabled={!selected} onChange={event => updateCut({enabled:event.target.checked})}/></FieldRow>
        <FieldRow label="Direction"><Checkbox label="Flip cut" checked={!!selected?.reversed} disabled={!selected}
          onChange={event => updateCut({ reversed: event.target.checked })}/></FieldRow>
        <FieldRow label="Preview"><Checkbox label="Show plane" disabled={!selected} checked={selected?.showPlane !== false}
          onChange={event => updateCut({ showPlane: event.target.checked })}/></FieldRow>
        <FieldRow label="Cap"><Checkbox label="Hatching" checked={draft.hatch !== false} onChange={event => update({hatch:event.target.checked})}/></FieldRow>
        <button type="button" className="aui-button aui-button--flat" disabled={!selected} onClick={() => { if(selected) window.dispatchEvent(new CustomEvent('aether-section-normal', {detail:sectionFrame(selected)})); }}>View normal</button>
      </Inspector>, controls)}
      {createPortal(<MenuButton label="Add section plane" items={[
        {id:'face',label:'Select a planar face'},
        ...DEFAULT_SECTION_PLANES.map(plane => ({ id: plane.label, label: `${plane.label} plane` })),
      ]} onSelect={id => { if(id==='face'){focus('planes');return;} addCut(DEFAULT_SECTION_PLANES.find(entry => entry.label === id)!); }}>
        <AetherIcon name="plus"/></MenuButton>, menuHost)}
    </>);
  };
  closeOpen = () => close(false);
  window.addEventListener("keydown", escape);
  session.attach(win);
  handle.element.addEventListener("pointerdown", () => session.activate(), true);
  handle.element.addEventListener("focusin", () => session.activate());
  sectionView.set(draft, true);
  render(); changed();
}
