import { openCADFeatureWindow } from "./features/feature-window-style";
import { mountEditHistory } from "./modeling/edit-history";
import { createEmptyPartDocument, insertFeature, resolvePointPosition, rollbackPosition } from "@aether/core/document";
import type { PartDocument, PartFeature, PointDefinition, PlaneReference, PointReference, AxisReference } from "@aether/core/document";
import { addFeatureViewControls } from "./features/view-controls";
import { cadSelection } from "./cad-selection-store";

type PointFeature = PartFeature & { type: "point" };
type Method = PointDefinition["method"];
const METHOD_LABELS: Record<Method, string> = { vertex: "At vertex", "two-edges": "Two edges", "three-planes": "Three planes", center: "Centre of circle", "edge-plane": "Edge and plane", "along-path": "Along path" };
const PRINCIPAL_LABELS = { XY: "Top plane", XZ: "Front plane", YZ: "Right plane" } as const;

/** Construction axis editor on the standard feature window, the plane window's
 *  anatomy: an entities box fed by viewport and tree picks, a method picker.
 *  Methods are SolidCraft's construct.axis.*: through a straight edge, through
 *  two points, normal to a plane through a point, where two planes meet. */
export async function openPointWindow(
  getDocument: () => PartDocument | null,
  apply: (doc: PartDocument) => Promise<void>,
  existing?: PointFeature,
  initialMethod: Method = "vertex",
): Promise<void> {
  const viewport = document.querySelector<HTMLElement>(".cad-studio-viewport");
  const initialDocument = getDocument();
  const source = initialDocument ?? createEmptyPartDocument("Untitled Part");
  if (!viewport) return;
  if (viewport.querySelector(".cad-plane-window") || document.querySelector(".cad-sketch-workspace")) return;
  const feature: PointFeature = existing ?? { id: crypto.randomUUID(), type: "point", name: `Point ${source.features.filter((f) => f.type === "point").length + 1}`, suppressed: false,
    definition: { method: "vertex", point: { kind: "point", partId: "", candidateId: "", positionMillimeters: [0, 0, 0] } } };
  const created = !existing;
  let busy = false, closed = false;
  const previousFilter = cadSelection.snapshot().filter;
  const currentDocument = () => getDocument() ?? (initialDocument ? null : source);
  const earlierPlanes = () => { const doc = currentDocument(); if (!doc) return [] as PartFeature[]; const cutoff = doc.features.findIndex((f) => f.id === feature.id); return doc.features.slice(0, cutoff < 0 ? rollbackPosition(doc) : cutoff).filter((f) => f.type === "plane"); };
  const labelFor = (r: PlaneReference) => r.kind === "principal" ? PRINCIPAL_LABELS[r.plane] : r.kind === "face" ? (r.label ?? "Selected face") : (earlierPlanes().find((f) => f.id === r.featureId)?.name ?? "Missing plane");
  const initial = existing?.definition;
  let references: PlaneReference[] = initial?.method === "three-planes" ? [...initial.references] : initial?.method === "edge-plane" ? [initial.reference] : [];
  let points: PointReference[] = initial?.method === "vertex" ? [initial.point] : [];
  let axes: AxisReference[] = initial?.method === "two-edges" ? [...initial.axes] : initial?.method === "center" || initial?.method === "edge-plane" || initial?.method === "along-path" ? [initial.axis] : [];

  const buildDefinition = (): PointDefinition | null => {
    const method = methodOf();
    if (method === "vertex") return points.length === 1 ? { method, point: points[0] } : null;
    if (method === "two-edges") return axes.length === 2 ? { method, axes: [axes[0], axes[1]] } : null;
    if (method === "three-planes") return references.length === 3 ? { method, references: [references[0], references[1], references[2]] } : null;
    if (method === "center") return axes.length === 1 ? { method, axis: axes[0] } : null;
    if (method === "edge-plane") return axes.length === 1 && references.length === 1 ? { method, axis: axes[0], reference: references[0] } : null;
    const t = Number(pathInput.value);
    return axes.length === 1 && Number.isFinite(t) ? { method, axis: axes[0], t } : null;
  };
  const describeRequirement = (): string | null => {
    const method = methodOf();
    if (method === "vertex") return points.length === 1 ? null : "At vertex needs one picked vertex.";
    if (method === "two-edges") return axes.length === 2 ? null : `Two edges needs exactly 2 edges — ${axes.length} selected.`;
    if (method === "three-planes") return references.length === 3 ? null : `Three planes needs exactly 3 planes — ${references.length} selected.`;
    if (method === "center") return axes.length === 1 ? null : "Centre needs one circular edge.";
    if (method === "edge-plane") return axes.length === 1 && references.length === 1 ? null : `Edge and plane needs 1 edge and 1 plane — ${axes.length} edge(s), ${references.length} plane(s) selected.`;
    if (!axes.length) return "Along path needs a straight edge.";
    const t = Number(pathInput.value); return Number.isFinite(t) && t >= 0 && t <= 1 ? null : "Enter a fraction between 0 and 1 along the edge.";
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
      if (!created && index < 0) { win.setError("This point was removed. Close this window and create another point."); return; }
      const error = definitionError();
      if (error) { win.setError(error); return; }
      const target: PointFeature = { ...feature, definition: buildDefinition()! };
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
    ...axes.map((a, index) => ({ label: a.label ?? `Edge ${index + 1}`, onRemove: () => { axes = axes.filter((_, at) => at !== index); cadSelection.dispatch({ type: "clear" }); syncMethod(); renderEntities(); } })),
    ...references.map((reference, index) => ({ label: labelFor(reference), onRemove: () => { references.splice(index, 1); renderEntities(); validate(); } })),
    ...points.map((p, index) => ({ label: p.label ?? `Point ${index + 1}`, onRemove: () => { points = points.filter((_, at) => at !== index); cadSelection.dispatch({ type: "clear" }); renderEntities(); validate(); } })),
  ]);
  const methodPicker = win.picker(Object.values(METHOD_LABELS), { ariaLabel: "Point method", value: METHOD_LABELS[existing ? existing.definition.method : initialMethod], onChange: () => { syncMethod(); renderEntities(); requestGeometry(); } });
  const methodOf = (): Method => (Object.keys(METHOD_LABELS) as Method[]).find((m) => METHOD_LABELS[m] === methodPicker.value()) ?? "vertex";
  win.body.append(methodPicker.element); win.body.append(win.status);
  const pathInput = document.createElement("input"); pathInput.type = "text"; pathInput.value = String(initial?.method === "along-path" ? initial.t : 0.5); pathInput.setAttribute("aria-label", "Fraction along the edge");
  const pathRow = win.row("Along the edge (0–1)", pathInput); pathInput.addEventListener("input", () => validate());
  function definitionError(): string | null {
    const missing = describeRequirement(); if (missing) return missing;
    const definition = buildDefinition(), doc = currentDocument();
    if (!definition || !doc) return "This point is not complete yet.";
    const index = doc.features.findIndex((f) => f.id === feature.id);
    try { resolvePointPosition({ ...feature, definition }, doc.features.slice(0, index < 0 ? rollbackPosition(doc) : index)); return null; }
    catch (error) { return error instanceof Error ? error.message : String(error); }
  }
  function validate() { win.setError(definitionError()); window.dispatchEvent(new CustomEvent("aether-plane-highlight", { detail: { references: [...references] } })); }
  function syncMethod() {
    const method = methodOf();
    // What the method still needs decides what the viewport picks next.
    pathRow.hidden = method !== "along-path";
    const filter = method === "vertex" ? "vertex" : method === "three-planes" ? "face" : method === "edge-plane" ? (axes.length ? "face" : "edge") : "edge";
    if (cadSelection.snapshot().filter !== filter) cadSelection.dispatch({ type: "set-filter", filter });
    const caption = entities.element.querySelector(".aui-feature-entities-caption");
    if (caption) caption.textContent = method === "vertex" ? "Vertex" : method === "three-planes" ? "Planes" : method === "edge-plane" ? "Edge and plane" : "Edges";
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
    const limit = method === "two-edges" ? 2 : 1;
    if (detail?.axis && method !== "vertex" && method !== "three-planes") {
      const picked: AxisReference = { kind: "axis", partId: detail.axis.partId, candidateId: detail.axis.candidateId, label: detail.axis.label, originMillimeters: detail.axis.originMillimeters, directionMillimeters: detail.axis.directionMillimeters, ...(detail.axis.lengthMillimeters !== undefined ? { lengthMillimeters: detail.axis.lengthMillimeters } : {}) };
      if (axes.length < limit && !axes.some((a) => a.partId === picked.partId && a.candidateId === picked.candidateId)) { axes.push(picked); syncMethod(); }
    }
    if (method === "vertex") for (const p of (detail?.points ?? []) as PointReference[]) if (points.length < 1) points.push({ kind: "point", partId: p.partId, candidateId: p.candidateId, label: p.label, positionMillimeters: p.positionMillimeters });
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
