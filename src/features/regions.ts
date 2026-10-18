import { identifySketchContour, resolveProfileDrawing } from "../aether-core";
import { takePickedSketchRegion } from "../sketch-region-selection";
import { sketchRegions } from "../freecad-translate";
import type { Controls, FeatureEditorContext } from "./shared";
import { validatePartDocument } from '@aether/core/document';
import { matchesProfileRegion, type ProfileRegionSelection } from '../../freecad-engine/browser/profile-region-reference';
/** The row each region picker lives in once the window has laid it out.
 *  `presentFeatureWindow` removes the original <label>, so the row cannot be
 *  found by walking up from the control afterwards. */
const regionRows = new WeakMap<Element, HTMLElement>();

function announceRegion(context: FeatureEditorContext, source: Controls[string], region: Controls[string]) {
  const sketch = context.doc.features.find(f => f.id === source.value);
  const regions = sketch ? sketchRegions(sketch, false, context.doc.features) : [];
  const indices = region instanceof window.HTMLSelectElement && region.multiple ? Array.from(region.selectedOptions, o => Number(o.value)) : region.value ? [Number(region.value)] : [];
  const selectedRegions = regions.filter(r => indices.includes(r.contourIndex));
  const selected = selectedRegions[0];
  source.dataset.selectionLabel = sketch ? `${sketch.name} · ${selectedRegions.length > 1 ? `${selectedRegions.length} regions` : selected ? selected.label : "choose a region"}` : "";
  source.dispatchEvent(new Event("aether-selection-label"));
  const hint = regionRows.get(region)?.nextElementSibling;
  if (hint?.classList.contains("cad-region-selection-summary")) hint.textContent = selected
    ? `${selectedRegions.length} of ${regions.length} closed regions selected.${region instanceof window.HTMLSelectElement && region.multiple ? " Enclosed contours form holes. Ctrl/Cmd-click to select several regions." : " Only this region will be used."}`
    : `Choose a closed region in the viewport or dropdown. Selecting the sketch does not select all its regions.`;
  window.dispatchEvent(new CustomEvent("aether-region-mode", { detail: { active: true, sourceId: source.value, contourIndex: selected?.contourIndex ?? null, contourIndices: indices, regionMode: region instanceof window.HTMLSelectElement && region.multiple } }));
}

/** Fill the region picker from whichever sketch is currently chosen.
 *
 *  A sketch holding one region needs no choice, so the row stays hidden; one
 *  holding several must be told apart, which is the whole point of the picker.
 */
export function syncRegions(
  context: FeatureEditorContext,
  source: Controls[string],
  region: Controls[string],
) {
  const sketch = context.doc.features.find((f) => f.id === source.value);
  const regions = sketch ? sketchRegions(sketch, false, context.doc.features) : [];
  region.replaceChildren();
  for (const candidate of regions) {
    const option = document.createElement("option");
    option.value = String(candidate.contourIndex);
    option.textContent = candidate.label;
    region.append(option);
  }
  // Editing an existing feature: find the region its saved contour id names,
  // so reordering the sketch cannot silently retarget the extrude.
  const saved = context.feature?.profileContourId || context.feature?.profileRegion;
  const match = saved
    ? regions.find((candidate) => matchesProfileRegion(context.feature, candidate))
    : undefined;
  region.value = match
    ? String(match.contourIndex)
    : !saved && regions.length === 1
      ? String(regions[0].contourIndex)
      : "";
  if (region instanceof window.HTMLSelectElement && region.multiple) {
    const savedIds: string[] | undefined = context.feature?.profileContourIds;
    if (savedIds) for (const option of region.options) option.selected = regions.some(r => String(r.contourIndex) === option.value && r.contourId && savedIds.includes(r.contourId));
  }
  const row = regionRows.get(region) ?? region.closest("label");
  if (row) row.hidden = regions.length < 2;
  announceRegion(context, source, region);
}

/** Give the picked contour a stable id, on the document about to be applied.
 *
 *  Identity is assigned only when a region actually becomes referenced — the
 *  same rule `referenceProfileContour` follows — and the resolved drawing is
 *  written back so the id survives the next solve.
 */
export function stampRegion(
  context: FeatureEditorContext,
  sketchId: string,
  contourIndex: number,
): string {
  const sketch = context.doc.features.find((f) => f.id === sketchId) as any;
  if (sketch?.profile?.type === "projection")
    throw new Error("Pick a region on an authored sketch, not a projected one.");
  const drawing = resolveProfileDrawing(context.doc.features, sketchId);
  const contour = drawing.contours[contourIndex];
  if (!contour) throw new Error("That sketch region is no longer there.");
  identifySketchContour(contour, () => crypto.randomUUID());
  delete drawing.pierceContext;
  sketch.profile = drawing;
  return contour.id!;
}

/** Stage every contributor together; a failed later pick leaves the candidate
 * document untouched. Thin/path/direction callers retain stampRegion's raw ID. */
export function stampProfileSelections(
  context: FeatureEditorContext,
  picks: { featureId: string; contourIndex: number }[],
  curves = false,
  identifyPrimitives = false,
): ({ profileFeatureId: string } & ProfileRegionSelection)[] {
  const doc = structuredClone(context.doc);
  const staged = { ...context, doc };
  const selected = picks.map(pick => {
    const feature = doc.features.find(f => f.id === pick.featureId);
    if (!feature || feature.suppressed || !('profile' in feature)) throw Error('Select an available source sketch.');
    const region = sketchRegions(feature, curves, doc.features).find(r => r.contourIndex === pick.contourIndex);
    if (!region) throw Error('That sketch region is no longer available. Reselect it.');
    const base = { profileFeatureId: feature.id };
    if (feature.profile.type === 'projection') throw Error('Pick a region on an authored sketch, not a projected one.');
    if (feature.type === 'sketch' || (feature.profile.type !== 'drawing' && !identifyPrimitives)) return base;
    if (!region.sourceContourIndices) return { ...base, profileContourId: stampRegion(staged, feature.id, pick.contourIndex) };
    const drawing = resolveProfileDrawing(doc.features, feature.id);
    const ids = region.sourceContourIndices.map(index => {
      const contour = drawing.contours[index];
      if (!contour) throw Error('A connected sketch region source is missing.');
      identifySketchContour(contour, () => crypto.randomUUID());
      return contour.id!;
    });
    delete drawing.pierceContext;
    feature.profile = drawing;
    return { ...base, profileRegion: { contourIds: ids } };
  });
  validatePartDocument(doc);
  context.doc.features = doc.features;
  return selected;
}


export function regionControls(context: FeatureEditorContext, source: Controls[string], label = "Region", multiple = false) {
  const region = context.field(label, "", [""]);
  if (multiple && region instanceof window.HTMLSelectElement) { region.multiple = true; region.size = 4; region.style.height = "auto"; region.style.minHeight = "5.5rem"; }
  source.addEventListener("change", () => syncRegions(context, source, region));
  syncRegions(context, source, region);
  region.addEventListener("change", () => announceRegion(context, source, region));
  const picked = (event: Event) => {
    if (!source.isConnected) return;
    const { featureId, contourIndex, replace } = (event as CustomEvent).detail;
    if (![...(source as HTMLSelectElement).options].some(option => option.value === featureId)) return;
    if (source.value !== featureId) { source.value = featureId; source.dispatchEvent(new Event("change")); }
    if (region instanceof window.HTMLSelectElement && region.multiple) {
      const option = Array.from(region.options).find(o => o.value === String(contourIndex));
      if (option) option.selected = replace ? true : !option.selected;
    } else region.value = String(contourIndex);
    region.dispatchEvent(new Event("change"));
  };
  window.addEventListener("aether-region-picked", picked);
  // A region picked inside the sketch editor, before this dialog existed: the
  // sketch commits on the way here, so it arrives as a channel rather than as
  // the live event above. Taken once, so a later dialog inherits no stale pick.
  const handedOver = context.feature ? null : takePickedSketchRegion();
  // Controls are not connected yet, and layoutRegion synchronizes them once
  // more. Deliver after layout so the initial selection survives both steps.
  // A single-region feature must ask which region to use, never silently
  // narrow a multi-region sketch handoff to its first contour.
  if (handedOver && !handedOver.contourIndices) queueMicrotask(() =>
    picked(
      new CustomEvent("aether-region-picked", {
        detail: { featureId: handedOver.featureId, contourIndex: handedOver.contourIndex, replace: true },
      }),
    ));
  const observer = new window.MutationObserver(() => {
    if (source.isConnected) return;
    observer.disconnect();
    window.removeEventListener("aether-region-picked", picked);
    window.dispatchEvent(new CustomEvent("aether-region-mode", { detail: { active: false } }));
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return region;
}

export function layoutRegion(context: FeatureEditorContext, source: Controls[string], region: Controls[string]) {
  region.closest("label")?.remove();
  region.setAttribute("form", context.form.id);
  const row = context.win.row("Region", region);
  row.classList.add("cad-extrude-region-row");
  regionRows.set(region, row);
  syncRegions(context, source, region);
  const hint = document.createElement("small");
  hint.className = "cad-region-selection-summary";
  row.after(hint);
  announceRegion(context, source, region);
}

export function selectedRegion(values: Record<string, string>, context: FeatureEditorContext, sourceKey = "source", multiple = false) {
  const sketch = context.doc.features.find(feature => feature.id === values[sourceKey]);
  if (!sketch || !("profile" in sketch)) return {};
  if (multiple && sketch.type === "sketch") return { regionMode: "faces" };
  if (multiple) {
    const picks = values.region.split(',').map(index => ({ featureId: values[sourceKey], contourIndex: Number(index) }));
    return { regionMode: 'faces', profileSelections: stampProfileSelections(context, picks) };
  }
  if (!values.region.trim()) throw Error('Choose a closed sketch region.');
  const { profileFeatureId: _source, ...selection } = stampProfileSelections(context, [{ featureId: values[sourceKey], contourIndex: Number(values.region) }])[0];
  return { profileContourId: undefined, profileRegion: undefined, ...selection };
}
