import { openCADFeatureWindow } from "./features/feature-window-style";
import { mountEditHistory } from "./modeling/edit-history";
import { createEmptyPartDocument, insertFeature, resolveAxisLine, rollbackPosition } from "@aether/core/document";
import type { PartDocument, PartFeature, AxisDefinition, PlaneReference, PointReference, AxisReference } from "@aether/core/document";
import { addFeatureViewControls } from "./features/view-controls";
import { cadSelection } from "./cad-selection-store";

type AxisFeature = PartFeature & { type: "axis" };
type Method = AxisDefinition["method"];
const METHOD_LABELS: Record<Method, string> = { edge: "Through edge", "two-points": "Two points", "normal-to-plane": "Normal to plane", "two-planes": "Two planes" };
const PRINCIPAL_LABELS = { XY: "Top plane", XZ: "Front plane", YZ: "Right plane" } as const;

/** Construction axis editor on the standard feature window, the plane window's
 *  anatomy: an entities box fed by viewport and tree picks, a method picker.
 *  Methods are SolidCraft's construct.axis.*: through a straight edge, through
 *  two points, normal to a plane through a point, where two planes meet. */
export async function openAxisWindow(
  getDocument: () => PartDocument | null,
  apply: (doc: PartDocument) => Promise<void>,
  existing?: AxisFeature,
  initialMethod: Method = "edge",
): Promise<void> {
  const viewport = document.querySelector<HTMLElement>(".cad-studio-viewport");
  const initialDocument = getDocument();
  const source = initialDocument ?? createEmptyPartDocument("Untitled Part");
  if (!viewport) return;
  if (viewport.querySelector(".cad-plane-window") || document.querySelector(".cad-sketch-workspace")) return;
  const feature: AxisFeature = existing ?? { id: crypto.randomUUID(), type: "axis", name: `Axis ${source.features.filter((f) => f.type === "axis").length + 1}`, suppressed: false,
    definition: { method: "edge", axis: { kind: "axis", partId: "", candidateId: "", originMillimeters: [0, 0, 0], directionMillimeters: [0, 0, 1] } } };
  const created = !existing;
  let busy = false, closed = false;
  const previousFilter = cadSelection.snapshot().filter;
  const currentDocument = () => getDocument() ?? (initialDocument ? null : source);
  const earlierPlanes = () => { const doc = currentDocument(); if (!doc) return [] as PartFeature[]; const cutoff = doc.features.findIndex((f) => f.id === feature.id); return doc.features.slice(0, cutoff < 0 ? rollbackPosition(doc) : cutoff).filter((f) => f.type === "plane"); };
  const labelFor = (r: PlaneReference) => r.kind === "principal" ? PRINCIPAL_LABELS[r.plane] : r.kind === "face" ? (r.label ?? "Selected face") : (earlierPlanes().find((f) => f.id === r.featureId)?.name ?? "Missing plane");
  const initial = existing?.definition;
  let references: PlaneReference[] = initial?.method === "normal-to-plane" ? [initial.reference] : initial?.method === "two-planes" ? [...initial.references] : [];
  let points: PointReference[] = initial?.method === "two-points" ? [...initial.points] : initial?.method === "normal-to-plane" ? [initial.point] : [];
  let axis: AxisReference | null = initial?.method === "edge" ? initial.axis : null;

  const buildDefinition = (): AxisDefinition | null => {
    const method = methodOf();
    if (method === "edge") return axis ? { method, axis } : null;
    if (method === "two-points") return points.length === 2 ? { method, points: [points[0], points[1]] } : null;
    if (method === "normal-to-plane") return references.length === 1 && points.length === 1 ? { method, reference: references[0], point: points[0] } : null;
    return references.length === 2 ? { method, references: [references[0], references[1]] } : null;
  };
  const describeRequirement = (): string | null => {
    const method = methodOf();
    if (method === "edge") return axis ? null : "Through edge needs a straight edge.";
    if (method === "two-points") return points.length === 2 ? null : `Two points needs exactly 2 points — ${points.length} selected.`;
    if (method === "normal-to-plane") return references.length === 1 && points.length === 1 ? null : `Normal to plane needs 1 plane and 1 point — ${references.length} plane(s), ${points.length} point(s) selected.`;
    return references.length === 2 ? null : `Two planes needs exactly 2 planes — ${references.length} selected.`;
  };
  const cleanup = () => {
    if (closed || busy) return;
    closed = true;
    window.dispatchEvent(new CustomEvent("aether-plane-highlight", { detail: { references: [] } }));
    unsubscribeSelection();
    cadSelection.dispatch({ type: "set-filter", filter: previousFilter });
    window.removeEventListener("aether-plane-geometry", onGeometry);
    window.removeEventListener("aether-sketch-plane", onPrincipalPick);
    window.removeEventListener("aether-plane-feature-picked", onFeaturePick);
    window.removeEventListener("aether-sketch-face", onFacePick);
    window.dispatchEvent(new CustomEvent("aether-sketch-plane-selection", { detail: false }));
    win.close();
  };
  const win = openCADFeatureWindow({
    viewport, className: "cad-plane-window", icon: "plane", title: feature.name,
    onAccept: async () => {
      if (closed || busy) return;
      const doc = currentDocument();
      if (!doc || doc.documentId !== source.documentId) { win.setError("The active Part changed. Close this window and reopen the tool."); return; }
      const index = doc.features.findIndex((f) => f.id === feature.id);
      if (!created && index < 0) { win.setError("This axis was removed. Close this window and create another axis."); return; }
      const error = definitionError();
      if (error) { win.setError(error); return; }
      const target: AxisFeature = { ...feature, definition: buildDefinition()! };
      const next = created ? insertFeature(doc, target) : structuredClone(doc);
      if (!created) next.features[index] = target;
      busy = true; win.panel.inert = true; win.panel.setAttribute("aria-busy", "true");
      try { await apply(next); busy = false; cleanup(); }
      catch (e) { busy = false; win.panel.inert = false; win.panel.removeAttribute("aria-busy"); win.status.textContent = (e as Error).message; }
    },
    onDiscard: cleanup,
  });
  addFeatureViewControls(win);
  mountEditHistory(win.panel, source, existing?.id);
  win.panel.addEventListener("keydown", (event) => { if (event.key === "Escape") { event.preventDefault(); cleanup(); } });
  const entities = win.entitiesBox("Entities");
  const renderEntities = () => entities.render([
    ...(axis && methodOf() === "edge" ? [{ label: axis.label ?? "Edge", onRemove: () => { axis = null; cadSelection.dispatch({ type: "clear" }); syncMethod(); renderEntities(); } }] : []),
    ...references.map((reference, index) => ({ label: labelFor(reference), onRemove: () => { references.splice(index, 1); renderEntities(); validate(); } })),
    ...points.map((p, index) => ({ label: p.label ?? `Point ${index + 1}`, onRemove: () => { points = points.filter((_, at) => at !== index); cadSelection.dispatch({ type: "clear" }); renderEntities(); validate(); } })),
  ]);
  const methodPicker = win.picker(Object.values(METHOD_LABELS), { ariaLabel: "Axis method", value: METHOD_LABELS[existing ? existing.definition.method : initialMethod], onChange: () => { syncMethod(); renderEntities(); requestGeometry(); } });
  const methodOf = (): Method => (Object.keys(METHOD_LABELS) as Method[]).find((m) => METHOD_LABELS[m] === methodPicker.value()) ?? "edge";
  win.body.append(methodPicker.element); win.body.append(win.status);
  function definitionError(): string | null {
    const missing = describeRequirement(); if (missing) return missing;
    const definition = buildDefinition(), doc = currentDocument();
    if (!definition || !doc) return "This axis is not complete yet.";
    const index = doc.features.findIndex((f) => f.id === feature.id);
    try { resolveAxisLine({ ...feature, definition }, doc.features.slice(0, index < 0 ? rollbackPosition(doc) : index)); return null; }
    catch (error) { return error instanceof Error ? error.message : String(error); }
  }
  function validate() { win.setError(definitionError()); window.dispatchEvent(new CustomEvent("aether-plane-highlight", { detail: { references: [...references] } })); }
  function syncMethod() {
    const method = methodOf();
    // What the method still needs decides what the viewport picks next.
    const filter = method === "edge" ? "edge" : method === "two-points" ? "vertex" : method === "normal-to-plane" ? (references.length ? "vertex" : "face") : "face";
    if (cadSelection.snapshot().filter !== filter) cadSelection.dispatch({ type: "set-filter", filter });
    const caption = entities.element.querySelector(".aui-feature-entities-caption");
    if (caption) caption.textContent = method === "edge" ? "Edge" : method === "two-points" ? "Points" : method === "normal-to-plane" ? "Plane and point" : "Planes";
    validate();
  }
  const addReference = (reference: PlaneReference) => { const key = JSON.stringify(reference); if (references.some((r) => JSON.stringify(r) === key)) return; references.push(reference); syncMethod(); renderEntities(); };
  const onPrincipalPick = (event: Event) => { const plane = (event as CustomEvent).detail; if (plane === "XY" || plane === "XZ" || plane === "YZ") addReference({ kind: "principal", plane }); };
  const onFeaturePick = (event: Event) => { const featureId = (event as CustomEvent).detail?.featureId; if (typeof featureId === "string" && earlierPlanes().some((f) => f.id === featureId)) addReference({ kind: "feature", featureId }); };
  const onFacePick = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    if (!detail?.frame || typeof detail.partId !== "string" || !Number.isInteger(detail.faceId)) { if (detail?.error) win.status.textContent = detail.error; return; }
    win.status.textContent = ""; addReference({ kind: "face", partId: detail.partId, faceId: detail.faceId, label: detail.label, frame: detail.frame });
  };
  const onGeometry = (event: Event) => {
    const detail = (event as CustomEvent).detail, method = methodOf();
    if (method === "edge" && detail?.axis) axis = { kind: "axis", partId: detail.axis.partId, candidateId: detail.axis.candidateId, label: detail.axis.label, originMillimeters: detail.axis.originMillimeters, directionMillimeters: detail.axis.directionMillimeters };
    if (method === "two-points" || method === "normal-to-plane") {
      const limit = method === "two-points" ? 2 : 1;
      for (const p of (detail?.points ?? []) as PointReference[]) if (points.length < limit && !points.some((q) => q.partId === p.partId && q.candidateId === p.candidateId)) points.push({ kind: "point", partId: p.partId, candidateId: p.candidateId, label: p.label, positionMillimeters: p.positionMillimeters });
    }
    renderEntities(); validate();
  };
  const requestGeometry = () => window.dispatchEvent(new CustomEvent("aether-plane-geometry-request"));
  const unsubscribeSelection = cadSelection.subscribe(() => requestGeometry());
  window.addEventListener("aether-plane-geometry", onGeometry);
  window.addEventListener("aether-sketch-plane", onPrincipalPick);
  window.addEventListener("aether-plane-feature-picked", onFeaturePick);
  window.addEventListener("aether-sketch-face", onFacePick);
  window.dispatchEvent(new CustomEvent("aether-sketch-plane-selection", { detail: true }));
  syncMethod(); renderEntities(); if (created) requestGeometry();
}
