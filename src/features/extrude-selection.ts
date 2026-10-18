import { matchesProfileRegion } from '../../freecad-engine/browser/profile-region-reference';
import { sketchRegions } from "../freecad-translate";
import { takePickedSketchRegion } from "../sketch-region-selection";
import { cadWorkspace } from "../cad-workspace-store";
import { stampProfileSelections } from "./regions";
import type { Controls, Control, FeatureEditorContext } from "./shared";

type Pick = { featureId: string; contourIndex: number };
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
  const curves=()=>creationMode?.value==='thin';
  const regions = (id: string) => { const f = sketches.find(f => f.id === id); return f ? sketchRegions(f,curves(),context.doc.features) : []; };
  const initial: Pick[] = [];
  const feature = context.feature;
  if (feature?.profileSelections) {
    for (const p of feature.profileSelections) {
      const r = regions(p.profileFeatureId).find(r => p.profileContourId || p.profileRegion ? matchesProfileRegion(p, r) : regions(p.profileFeatureId).length === 1);
      if (r) initial.push({ featureId: p.profileFeatureId, contourIndex: r.contourIndex });
    }
  } else if (feature?.profileFeatureId) {
    const ids = feature.profileContourIds ?? (feature.profileContourId ? [feature.profileContourId] : undefined);
    const choices = regions(feature.profileFeatureId);
    for (const r of choices.filter(r => feature.profileRegion ? matchesProfileRegion(feature, r) : ids ? ids.includes(r.contourId) : choices.length === 1)) initial.push({featureId: feature.profileFeatureId, contourIndex: r.contourIndex});
  }
  selections.dataset.initial = JSON.stringify(initial);
  initialByContext.set(context, selections.dataset.initial);
  selections.value = JSON.stringify(initial);
  let box: ReturnType<FeatureEditorContext["win"]["entitiesBox"]> | undefined;
  const read = (): Pick[] => JSON.parse(selections.value);
  const syncRegion = () => {
    region.replaceChildren(...regions(source.value).map(r => {
      const option = document.createElement("option"); option.value = String(r.contourIndex);
      option.textContent = `${curves()?"Curve":"Face"} ${r.contourIndex + 1}`;
      option.selected = read().some(p => p.featureId === source.value && p.contourIndex === r.contourIndex);
      return option;
    }));
  };
  let pickingActive=true;
  const render = () => {
    const picks = read();
    activeSelection = selections;
    if (box) {
      const caption=curves()?"Sketch curves to extrude":"Faces and sketch regions to extrude";
      box.element.setAttribute('aria-label',caption);
      const label=box.element.querySelector('.aui-feature-entities-caption');
      if(label)label.textContent=caption;
    }
    box?.render(picks.map(p => ({label: `${curves()?"Curve":"Face"} ${p.contourIndex + 1} of ${sketches.find(f => f.id === p.featureId)?.name ?? "sketch"}`, onRemove: () => update(picks.filter(other => key(other) !== key(p)))})));
    window.dispatchEvent(new CustomEvent("aether-region-mode", {detail: {active:pickingActive, curveMode:curves(), regionMode: feature?.regionMode === "faces" || !feature || selections.value !== selections.dataset.initial, selections:picks, allowedSourceIds:sketches.map(f=>f.id)}}));
  };
  pickingModes.set(selections,active=>{pickingActive=active;render();});
  const update = (picks: Pick[]) => {
    selections.value = JSON.stringify([...new Map(picks.map(p => [key(p),p])).values()]);
    syncRegion(); render(); selections.dispatchEvent(new Event("change"));
  };
  source.addEventListener("change", () => update(source.value ? [...read(), ...regions(source.value).map(r => ({featureId:source.value, contourIndex:r.contourIndex}))] : []));
  region.addEventListener("change", () => update([...read().filter(p => p.featureId !== source.value), ...Array.from(region.selectedOptions, o => ({featureId:source.value, contourIndex:Number(o.value)}))]));
  const picked = (event: Event) => {
    if (!selections.isConnected) return;
    const p = (event as CustomEvent).detail as Pick & {replace?:boolean};
    if (!regions(p.featureId).some(r => r.contourIndex === p.contourIndex)) return;
    source.value = p.featureId;
    const picks = read();
    update(picks.some(other => key(other) === key(p)) ? (p.replace ? picks : picks.filter(other => key(other) !== key(p))) : [...picks, {featureId:p.featureId,contourIndex:p.contourIndex}]);
  };
  window.addEventListener("aether-region-picked", picked);
  const observer = new window.MutationObserver(() => {
    if (selections.isConnected) return;
    observer.disconnect(); eventWindow.removeEventListener("aether-region-picked", picked);
    if (activeSelection === selections) {
      activeSelection = undefined;
      eventWindow.dispatchEvent(new eventWindow.CustomEvent("aether-region-mode", {detail:{active:false}}));
    }
  });
  observer.observe(document.body,{childList:true,subtree:true});
  layouts.set(selections, () => {
    for (const control of [source,region,selections]) { control.closest("label")?.remove(); control.hidden=true; control.setAttribute("form",context.form.id); context.form.append(control); }
    box = context.win.entitiesBox("Faces and sketch regions to extrude");
    const sourceRow=document.createElement('label');sourceRow.className='aui-feature-row';sourceRow.append('Sketch',source);
    const curveRow=document.createElement('label');curveRow.className='aui-feature-row';curveRow.append('Sketch curves',region);
    region.multiple=true;region.size=3;region.style.height='auto';context.win.body.append(sourceRow,curveRow);
    const syncMode=()=>{
      sourceRow.hidden=curveRow.hidden=!curves();source.hidden=region.hidden=!curves();
      region.setAttribute('aria-label',curves()?'Sketch curves':'Region');
      const keep=read().filter(p=>regions(p.featureId).some(r=>r.contourIndex===p.contourIndex));
      const choices=regions(source.value);
      const handoffChoices = handedOver?.featureId === source.value && handedOver.contourIndices
        ? choices.filter(r => handedOver!.contourIndices!.includes(r.contourIndex)).map(r => ({featureId:source.value,contourIndex:r.contourIndex})) : [];
      update(keep.length?keep:handoffChoices.length?handoffChoices:choices.length===1?[{featureId:source.value,contourIndex:choices[0].contourIndex}]:[]);
    };
    creationMode?.addEventListener('change',syncMode);
    sourceRow.hidden=curveRow.hidden=!curves();source.hidden=region.hidden=!curves();
    region.setAttribute('aria-label',curves()?'Sketch curves':'Region');
    syncRegion(); render();
    let handedOver = feature ? null : takePickedSketchRegion();
    if (!feature && !handedOver) {
      const selected = [...cadWorkspace.snapshot().selectedItemIDs];
      const sketch = selected.length === 1 ? sketches.find(f => selected[0] === `feature/${f.type}/${f.id}`) : undefined;
      const eligible=sketch?regions(sketch.id):[];
      const choices = eligible.length?eligible:sketch?sketchRegions(sketch,true,context.doc.features):[];
      if (sketch && choices.length === 1) handedOver = {featureId:sketch.id,contourIndex:choices[0].contourIndex};
    }
    if(handedOver && sketches.some(f=>f.id===handedOver.featureId)) {
      // Retain an open sketch while Solid is active. Switching to Thin can then
      // select its curve without making the user find the sketch again.
      source.value=handedOver.featureId;syncRegion();
      const handoff = handedOver;
      queueMicrotask(() => {
        if (!selections.isConnected) return;
        if (handoff.contourIndices) {
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
  if (feature && !feature.profileSelections && values.selections === initialByContext.get(context)) return {profileFeatureId:feature.profileFeatureId, ...(feature.profileContourId ? {profileContourId:feature.profileContourId}:{}), ...(feature.profileRegion ? {profileRegion:feature.profileRegion}:{}), ...(feature.profileContourIds ? {profileContourIds:feature.profileContourIds}:{}), ...(feature.regionMode ? {regionMode:feature.regionMode}:{})};
  const profileFeatureId=feature?.profileFeatureId ?? picks[0].featureId;
  const profileSelections = stampProfileSelections(context, picks, values.creationMode === "thin", true);
  return {profileFeatureId,profileSelections,regionMode:"faces",profileContourIds:undefined,profileContourId:profileSelections.length===1?profileSelections[0].profileContourId:undefined,profileRegion:profileSelections.length===1?profileSelections[0].profileRegion:undefined};
}

export function setExtrudeProfilePicking(controls: Controls, active:boolean) { pickingModes.get(controls.selections)?.(active); }
