import { matchesProfileRegion } from '@aether/core/sketch/reference/profile-region-reference';
import { sketchRegions } from "@aether/core/document";
import { takePickedSketchRegion } from "../sketch-region-selection";
import { cadWorkspace } from "../cad-workspace-store";
import { featureRegionChoices, stampProfileSelections } from "./regions";
import type { Controls, Control, FeatureEditorContext } from "./shared";
import { referencePickerLifecycle } from './reference-picker-lifecycle';
import { ExtrudeProfileModes, type ExtrudeProfilePick as Pick } from './extrude-profile-modes';

const initialByContext = new WeakMap<FeatureEditorContext, string>();
const layouts = new WeakMap<Control, () => void>();
const pickingModes = new WeakMap<Control, (active:boolean)=>void>();
let activeSelection: Control | undefined;
const key = (p: Pick) => JSON.stringify([p.featureId, p.contourIndex]);

export function extrudeSelectionControls(context: FeatureEditorContext, source: Control, creationMode?:Control) {
  const eventWindow = window;
  const region = context.field("Region", "", [""]) as HTMLSelectElement;
  region.multiple = true;
  const selections = context.field("Selected profiles", "[]");
  const sketches = context.doc.features.filter(f => [...(source as HTMLSelectElement).options].some(o => o.value === f.id));
  const curves=()=>creationMode?.value==='thin'||creationMode?.value==='surface';
  const choices = (id: string, useCurves: boolean) => { const f = sketches.find(f => f.id === id); return f ? featureRegionChoices(context,f,useCurves) : []; };
  const regions = (id: string) => choices(id, curves());
  const initial: Pick[] = [];
  const feature = context.feature;
  if (feature?.profileSelections) {
    for (const p of feature.profileSelections) {
      const choices = regions(p.profileFeatureId);
      for (const r of choices.filter(r => p.profileContourId || p.profileRegion ? matchesProfileRegion(p, r) : curves() || choices.length === 1))
        initial.push({ featureId: p.profileFeatureId, contourIndex: r.contourIndex });
    }
  } else if (feature?.profileFeatureId) {
    const ids = feature.profileContourIds ?? feature.contourIds ?? (feature.profileContourId ? [feature.profileContourId] : undefined);
    const choices = regions(feature.profileFeatureId);
    for (const r of choices.filter(r => feature.profileRegion ? matchesProfileRegion(feature, r) : ids ? ids.includes(r.contourId) : !r.cell)) initial.push({featureId: feature.profileFeatureId, contourIndex: r.contourIndex});
  }
  selections.dataset.initial = JSON.stringify(initial);
  initialByContext.set(context, selections.dataset.initial);
  selections.value = JSON.stringify(initial);
  const modes = new ExtrudeProfileModes(curves(), initial, choices);
  let box: ReturnType<FeatureEditorContext["win"]["entitiesBox"]> | undefined;
  const read = (): Pick[] => JSON.parse(selections.value);
  const syncRegion = () => {
    region.replaceChildren(...regions(source.value).map(r => {
      const option = document.createElement("option"); option.value = String(r.contourIndex);
      option.textContent = curves() ? `Curve ${r.contourIndex + 1}` : r.label;
      option.selected = read().some(p => p.featureId === source.value && p.contourIndex === r.contourIndex);
      return option;
    }));
  };
  let pickingActive=false;
  const announce = () => {
    const picks = read();
    if (box) box.element.dataset.picking = String(pickingActive);
    window.dispatchEvent(new CustomEvent("aether-region-mode", {detail: {active:pickingActive, curveMode:curves(), regionMode: feature?.regionMode === "faces" || !feature || selections.value !== selections.dataset.initial, selections:picks, legacySelections:picks.filter(p=>regions(p.featureId).some(r=>r.contourIndex===p.contourIndex && r.contourId && !r.cell)), allowedSourceIds:sketches.map(f=>f.id)}}));
  };
  const lifecycle = referencePickerLifecycle('auto', () => selections.isConnected, active => {
    pickingActive = active;
    if (active) activeSelection = selections;
    announce();
  });
  const render = () => {
    const picks = read();
    if (box) {
      const caption=curves()?"Sketch curves to extrude":"Faces and sketch regions to extrude";
      box.element.setAttribute('aria-label',caption);
      const label=box.element.querySelector('.aui-feature-entities-caption');
      if(label)label.textContent=caption;
    }
    box?.render(picks.map(p => ({label: `${sketches.find(f => f.id === p.featureId)?.name ?? "Sketch"} · ${curves()?`Curve ${p.contourIndex + 1}`:regions(p.featureId).find(r=>r.contourIndex===p.contourIndex)?.label ?? "Missing region"}`, onRemove: () => update(picks.filter(other => key(other) !== key(p)))})));
    announce();
  };
  pickingModes.set(selections, lifecycle.setActive);
  const publish = (picks: Pick[]) => {
    selections.value = JSON.stringify(picks);
    syncRegion(); render(); selections.dispatchEvent(new Event("change"));
  };
  const update = (picks: Pick[]) => publish(modes.replace(picks));
  source.addEventListener("change", () => update(source.value ? [...read(), ...regions(source.value).map(r => ({featureId:source.value, contourIndex:r.contourIndex}))] : []));
  region.addEventListener("change", () => update([...read().filter(p => p.featureId !== source.value), ...Array.from(region.selectedOptions, o => ({featureId:source.value, contourIndex:Number(o.value)}))]));
  const picked = (event: Event) => {
    if (!selections.isConnected || !pickingActive) return;
    const p = (event as CustomEvent).detail as Pick & {replace?:boolean};
    if (!regions(p.featureId).some(r => r.contourIndex === p.contourIndex)) return;
    source.value = p.featureId;
    const picks = read();
    update(picks.some(other => key(other) === key(p)) ? (p.replace ? picks : picks.filter(other => key(other) !== key(p))) : [...picks, {featureId:p.featureId,contourIndex:p.contourIndex}]);
  };
  window.addEventListener("aether-region-picked", picked);
  let previousTree = new Set(cadWorkspace.snapshot().selectedItemIDs);
  const unsubscribeTree = cadWorkspace.subscribe(() => {
    const selected = new Set(cadWorkspace.snapshot().selectedItemIDs);
    const added = [...selected].filter(id => !previousTree.has(id));
    previousTree = selected;
    if (!pickingActive || !selections.isConnected) return;
    const ids = added.map(id => /^feature\/[^/]+\/(.+)$/.exec(id)?.[1]).filter((id): id is string => Boolean(id && sketches.some(f => f.id === id)));
    if (!ids.length) return;
    source.value = ids.at(-1)!;
    update([...read(), ...ids.flatMap(featureId => regions(featureId).map(r => ({ featureId, contourIndex: r.contourIndex })))]);
  });
  const observer = new window.MutationObserver(() => {
    if (selections.isConnected) return;
    observer.disconnect(); unsubscribeTree(); eventWindow.removeEventListener("aether-region-picked", picked);
    lifecycle.dispose();
    if (activeSelection === selections) {
      activeSelection = undefined;
      eventWindow.dispatchEvent(new eventWindow.CustomEvent("aether-region-mode", {detail:{active:false}}));
    }
  });
  observer.observe(document.body,{childList:true,subtree:true});
  layouts.set(selections, () => {
    for (const control of [source,region,selections]) { control.closest("label")?.remove(); control.hidden=true; control.setAttribute("form",context.form.id); context.form.append(control); }
    box = context.win.entitiesBox("Faces and sketch regions to extrude");
    // Focus changes only the picking channel; never replace a pending × target.
    box.element.tabIndex = 0;
    const activate = () => lifecycle.setActive(true);
    box.element.addEventListener('pointerdown', activate);
    box.element.addEventListener('focusin', activate);
    const syncMode=()=>{
      region.setAttribute('aria-label',curves()?'Sketch curves':'Region');
      publish(modes.switchTo(curves()));
    };
    creationMode?.addEventListener('change',syncMode);
    region.setAttribute('aria-label',curves()?'Sketch curves':'Region');
    syncRegion(); render();
    let handedOver = feature ? null : takePickedSketchRegion();
    if (!feature && !handedOver) {
      const selected = [...cadWorkspace.snapshot().selectedItemIDs];
      const sketch = selected.length === 1 ? sketches.find(f => selected[0] === `feature/${f.type}/${f.id}`) : undefined;
      const eligible=sketch?regions(sketch.id):[];
      const choices = eligible.length?eligible:sketch?sketchRegions(sketch,true,context.doc.features):[];
      if (sketch && choices.length) handedOver = {featureId:sketch.id,contourIndex:choices[0].contourIndex,contourIndices:choices.map(r=>r.contourIndex),wholeSketch:true};
    }
    if(handedOver && sketches.some(f=>f.id===handedOver.featureId)) {
      // Retain an open sketch while Solid is active. Switching to Thin can then
      // select its curve without making the user find the sketch again.
      source.value=handedOver.featureId;syncRegion();
      const handoff = handedOver;
      queueMicrotask(() => {
        if (!selections.isConnected) return;
        if (handoff.wholeSketch) publish(modes.seedWholeSketch(handoff.featureId));
        else if (handoff.contourIndices) {
          const eligible = regions(handoff.featureId);
          update(handoff.contourIndices.filter(index => eligible.some(r => r.contourIndex === index))
            .map(contourIndex => ({featureId:handoff.featureId, contourIndex})));
        } else picked(new CustomEvent("aether-region-picked", {detail:{...handoff,replace:true}}));
      });
    }
  });
  return {region,selections};
}
export function layoutExtrudeSelections(controls: Controls) { layouts.get(controls.selections)?.(); }
export function serializeExtrudeSelections(values: Record<string,string>, context: FeatureEditorContext) {
  const picks: Pick[] = JSON.parse(values.selections);
  if (!picks.length) throw new Error("Select a sketch face.");
  const feature=context.feature;
  if (feature && feature.type !== 'surface-extrude' && values.creationMode !== 'surface' && !feature.profileSelections && values.selections === initialByContext.get(context)) return {profileFeatureId:feature.profileFeatureId, ...(feature.profileContourId ? {profileContourId:feature.profileContourId}:{}), ...(feature.profileRegion ? {profileRegion:feature.profileRegion}:{}), ...(feature.profileContourIds ? {profileContourIds:feature.profileContourIds}:{}), ...(feature.regionMode ? {regionMode:feature.regionMode}:{})};
  const profileFeatureId=picks[0].featureId;
  const profileSelections = stampProfileSelections(context, picks, ["thin", "surface"].includes(values.creationMode), true);
  return {profileFeatureId,profileSelections,regionMode:"faces",profileContourIds:undefined,profileContourId:profileSelections.length===1?profileSelections[0].profileContourId:undefined,profileRegion:profileSelections.length===1?profileSelections[0].profileRegion:undefined};
}

export function setExtrudeProfilePicking(controls: Controls, active:boolean) { pickingModes.get(controls.selections)?.(active); }
