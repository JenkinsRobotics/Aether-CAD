import { mountEditHistory } from "./modeling/edit-history";
import { createEmptyPartDocument, insertFeature, resolvePlaneFrame, rollbackPosition } from "@aether/core/document";
import type { SketchFrame } from "@aether/core/sketch";
import type {
  PartDocument,
  PartFeature,
  PlaneDefinition,
  PlaneReference,
  PointReference,
  AxisReference,
} from "@aether/core/document";
import { openFeatureWindow } from "@aether/ui";
import { addFeatureViewControls } from './features/view-controls';
import { cadSelection } from "./cad-selection-store";

type PlaneFeature = PartFeature & { type: "plane" };
type Principal = "XY" | "XZ" | "YZ";

const PRINCIPAL_LABELS: Record<Principal, string> = {
  XY: "Top plane",
  XZ: "Front plane",
  YZ: "Right plane",
};

/** Onshape-anatomy plane editor on the standard feature window: entities
 * box (viewport/tree clicks add references), method dropdown, offset
 * distance with flip-direction arrow, flip normal. ✓ commits, ✕ discards a
 * freshly created plane. */
export async function openPlaneWindow(
  getDocument: () => PartDocument | null,
  apply: (doc: PartDocument) => Promise<void>,
  existing?: PlaneFeature,
  initialMethod: PlaneDefinition["method"] = "offset",
): Promise<void> {
  const viewport = document.querySelector<HTMLElement>(".cad-studio-viewport");
  const initialDocument = getDocument();
  const source = initialDocument ?? createEmptyPartDocument("Untitled Part");
  if (!viewport) return;
  if (viewport.querySelector(".cad-plane-window") || document.querySelector(".cad-sketch-workspace")) return;
  const feature: PlaneFeature =
    existing ??
    ({
      id: crypto.randomUUID(),
      type: "plane",
      name: `Plane ${source.features.filter((f) => f.type === "plane").length + 1}`,
      plane: "XY",
      offsetMillimeters: 10,
      suppressed: false,
      definition: {
        method: "offset",
        reference: { kind: "principal", plane: "XY" },
        distanceMillimeters: 10,
      },
    } satisfies PlaneFeature);
  const created = !existing;
  let busy = false;
  let closed = false;
  const previousFilter = cadSelection.snapshot().filter;
  const currentDocument = () => getDocument() ?? (initialDocument ? null : source);
  const earlierPlanes = (): PlaneFeature[] => {
    const doc = currentDocument();
    if (!doc) return [];
    const cutoff = doc.features.findIndex((f) => f.id === feature.id);
    return doc.features
      .slice(0, cutoff < 0 ? rollbackPosition(doc) : cutoff)
      .filter((f): f is PlaneFeature => f.type === "plane" && f.id !== feature.id);
  };
  const labelFor = (reference: PlaneReference): string =>
    reference.kind === "principal"
      ? PRINCIPAL_LABELS[reference.plane]
      : reference.kind === "face"
        ? (reference.label ?? "Selected face")
        : (earlierPlanes().find((f) => f.id === reference.featureId)?.name ?? "Missing plane");

  const initial = feature.definition ?? {
    method: "offset" as const,
    reference: { kind: "principal" as const, plane: feature.plane },
    distanceMillimeters: feature.offsetMillimeters,
  };
  // A NEW plane starts with an empty Entities box: the seeded definition exists
  // only so the feature is well-formed in the tree, and pre-filling "Top plane"
  // made it look like a choice the user had made. Editing an existing plane
  // still shows the references it was built from.
  // Existing planes show the references they were built from; the geometry
  // methods carry their own picks instead, restored just below.
  const references: PlaneReference[] = !created
    ? initial.method === "offset"
      ? [initial.reference]
      : initial.method === "mid"
        ? [...initial.references]
        : initial.method === "angle"
          ? [initial.reference]
          : []
    : [];
  let flip = Boolean(feature.definition?.flip);

  /** Points and an axis picked for the geometry-driven methods. */
  let points: PointReference[] =
    !created && initial.method === "three-point" ? [...initial.points] : [];
  let axis: AxisReference | null =
    !created && initial.method === "angle" ? initial.axis : null;

  /** The definition these controls currently describe, or null when the plane
   *  is not yet complete. One builder feeds the live preview AND the commit, so
   *  what you see in the viewport is exactly what gets saved. */
  const buildDefinition = (): PlaneDefinition | null => {
    if (methodPicker.value() === "Three point") {
      if (points.length !== 3) return null;
      return { method: "three-point", points: [points[0], points[1], points[2]], ...(flip ? { flip } : {}) };
    }
    if (methodPicker.value() === "Angle") {
      const angleDegrees = Number(angleInput.value);
      if (!axis || references.length !== 1 || !Number.isFinite(angleDegrees)) return null;
      return { method: "angle", axis, reference: references[0], angleDegrees, ...(flip ? { flip } : {}) };
    }
    if (methodPicker.value() === "Offset") {
      if (references.length !== 1) return null;
      const distanceMillimeters = Number(offsetInput.value);
      if (!Number.isFinite(distanceMillimeters)) return null;
      return { method: "offset", reference: references[0], distanceMillimeters, ...(flip ? { flip } : {}) };
    }
    if (references.length !== 2) return null;
    return { method: "mid", references: [references[0], references[1]], ...(flip ? { flip } : {}) };
  };

  /** Why the plane is not complete, in the window's own words. */
  const describeRequirement = (): string | null => {
    if (methodPicker.value() === "Three point")
      return points.length === 3
        ? null
        : `Three point needs exactly 3 points — ${points.length} selected.`;
    if (methodPicker.value() === "Angle") {
      if (!axis) return "Angle needs an edge to rotate about.";
      if (references.length !== 1)
        return `Angle needs exactly 1 reference plane — ${references.length} selected.`;
      if (!Number.isFinite(Number(angleInput.value))) return "Enter a finite angle in degrees.";
      return null;
    }
    const need = methodPicker.value() === "Offset" ? 1 : 2;
    const noun = need === 1 ? "reference plane" : "reference planes";
    if (references.length !== need)
      return `${methodPicker.value()} needs exactly ${need} ${noun} — ${references.length} selected.`;
    if (methodPicker.value() === "Offset" && !Number.isFinite(Number(offsetInput.value)))
      return "Enter a finite offset in millimetres.";
    return null;
  };

  const cleanup = () => {
    if (closed || busy) return;
    closed = true;
    window.dispatchEvent(
      new CustomEvent("aether-plane-preview", { detail: { featureId: feature.id, frame: null, finished: true } }),
    );
    window.dispatchEvent(
      new CustomEvent("aether-plane-highlight", { detail: { references: [] } }),
    );
    unsubscribeSelection();
    cadSelection.dispatch({ type: "set-filter", filter: previousFilter });
    window.removeEventListener("aether-plane-geometry", onGeometry);
    window.removeEventListener("aether-sketch-plane", onPrincipalPick);
    window.removeEventListener("aether-plane-feature-picked", onFeaturePick);
    window.removeEventListener("aether-sketch-face", onFacePick);
    window.dispatchEvent(new CustomEvent("aether-sketch-plane-selection", { detail: false }));
    win.close();
  };
  const win = openFeatureWindow({
    viewport,
    className: "cad-plane-window",
    title: feature.name,
    acceptLabel: "Apply plane",
    discardLabel: created ? "Discard plane" : "Close plane window",
    onAccept: async () => {
      if (closed || busy) return;
      const doc = currentDocument();
      if (!doc || doc.documentId !== source.documentId) {
        win.setError("The active Part changed. Close this window and reopen the tool.");
        return;
      }
      const index = doc.features.findIndex((f) => f.id === feature.id);
      if (!created && index < 0) {
        win.setError("This plane was removed. Close this window and create another plane.");
        return;
      }
      const error = definitionError();
      if (error) { win.setError(error); return; }
      const definition = buildDefinition()!;
      const target: PlaneFeature = { ...feature, definition };
      if (definition.method === "offset" && definition.reference.kind === "principal") {
        target.plane = definition.reference.plane;
        target.offsetMillimeters = definition.distanceMillimeters;
      }
      const next = created ? insertFeature(doc, target) : structuredClone(doc);
      if (!created) next.features[index] = target;
      busy = true;
      win.panel.inert = true;
      win.panel.setAttribute("aria-busy", "true");
      try {
        await apply(next);
        busy = false;
        cleanup();
      } catch (e) {
        busy = false;
        win.panel.inert = false;
        win.panel.removeAttribute("aria-busy");
        win.status.textContent = (e as Error).message;
      }
    },
    // New planes are drafts until Apply. Cancel never touches history or autosave.
    onDiscard: cleanup,
  });

  addFeatureViewControls(win);
  mountEditHistory(win.panel, source, existing?.id);
  win.panel.addEventListener("keydown", event => {
    if (event.key === "Escape") { event.preventDefault(); cleanup(); }
  });
  const entities = win.entitiesBox("Entities");
  const renderEntities = () => {
    const method = methodPicker?.value?.();
    if (method === "Three point")
      return entities.render(
        points.map((p, index) => ({
          label: p.label ?? `Point ${index + 1}`,
          onRemove: () => {
            points = points.filter((_, at) => at !== index);
            cadSelection.dispatch({ type: "clear" });
            renderEntities();
            validate();
          },
        })),
      );
    if (method === "Angle")
      return entities.render([
        ...(axis
          ? [{ label: axis.label ?? "Edge", onRemove: () => { axis = null; cadSelection.dispatch({ type: "clear" }); syncMethod(); renderEntities(); validate(); } }]
          : []),
        ...references.map((reference, index) => ({
          label: labelFor(reference),
          onRemove: () => {
            references.splice(index, 1);
            renderEntities();
            validate();
          },
        })),
      ]);
    return entities.render(
      references.map((reference, index) => ({
        label: labelFor(reference),
        onRemove: () => {
          references.splice(index, 1);
          renderEntities();
          validate();
        },
      })),
    );
  };

  const methodPicker = win.picker(["Offset", "Mid plane", "Three point", "Angle"], {
    ariaLabel: "Plane method",
    value: ({ offset: "Offset", mid: "Mid plane", "three-point": "Three point", angle: "Angle" } as const)[existing ? initial.method : initialMethod],
    onChange: () => {
      syncMethod();
      renderEntities();
      if (methodPicker.value() === "Three point" || methodPicker.value() === "Angle") requestGeometry();
    },
  });
  win.body.append(methodPicker.element);
  win.body.append(win.status);

  const offsetInput = document.createElement("input");
  offsetInput.type = "text";
  offsetInput.value = String(initial.method === "offset" ? initial.distanceMillimeters : 10);
  offsetInput.setAttribute("aria-label", "Offset distance");
  const unit = document.createElement("span");
  unit.textContent = "mm";
  const flipDirection = document.createElement("button");
  flipDirection.type = "button";
  flipDirection.textContent = "⇅";
  flipDirection.setAttribute("aria-label", "Flip offset direction");
  flipDirection.onclick = () => {
    const value = Number(offsetInput.value);
    if (Number.isFinite(value)) offsetInput.value = String(-value);
    validate();
  };
  offsetInput.addEventListener("input", validate);
  const offsetRow = win.row("Offset distance", offsetInput, unit, flipDirection);

  const angleInput = document.createElement("input");
  angleInput.type = "text";
  angleInput.value = String(initial.method === "angle" ? initial.angleDegrees : 45);
  angleInput.setAttribute("aria-label", "Plane angle");
  const angleUnit = document.createElement("span");
  angleUnit.textContent = "deg";
  const angleRow = win.row("Angle", angleInput, angleUnit);
  angleInput.addEventListener("input", () => validate());

  const flipInput = document.createElement("input");
  flipInput.type = "checkbox";
  flipInput.checked = flip;
  flipInput.setAttribute("aria-label", "Flip normal");
  flipInput.onchange = () => {
    flip = flipInput.checked;
    validate();
  };
  win.row("Flip normal", flipInput);

  /** Report arity against the CURRENT method, and disable the accept control
   *  until it is satisfied — the window cannot commit an invalid plane. */
  function definitionError(): string | null {
    const missing = describeRequirement();
    if (missing) return missing;
    const definition = buildDefinition();
    const doc = currentDocument();
    if (!definition || !doc) return "This plane is not complete yet.";
    const index = doc.features.findIndex(f => f.id === feature.id);
    try {
      resolvePlaneFrame({ ...feature, definition }, doc.features.slice(0, index < 0 ? rollbackPosition(doc) : index));
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  function validate() {
    win.setError(definitionError());
    preview();
  }

  /** Preview the same resolved frame that Apply will save. A new plane remains
   * transient until accepted; incomplete and invalid definitions have no preview. */
  function preview() {
    const doc = currentDocument();
    const index = doc?.features.findIndex((f) => f.id === feature.id) ?? -1;
    const definition = buildDefinition();
    let frame: SketchFrame | null = null;
    if (doc && definition) {
      try {
        frame = resolvePlaneFrame(
          { ...feature, definition },
          doc.features.slice(0, index < 0 ? rollbackPosition(doc) : index),
        );
      } catch {
        // An unresolvable reference (deleted plane) simply has no preview.
        frame = null;
      }
    }
    window.dispatchEvent(
      new CustomEvent("aether-plane-preview", { detail: { featureId: feature.id, frame } }),
    );
    // Whatever this feature is using reads orange in the viewport, so the
    // entity chips and the geometry always agree about the selection.
    window.dispatchEvent(
      new CustomEvent("aether-plane-highlight", { detail: { references: [...references] } }),
    );
  }

  function syncMethod() {
    const method = methodPicker.value();
    offsetRow.hidden = method !== "Offset";
    angleRow.hidden = method !== "Angle";
    const filter = method === "Three point" ? "vertex" : method === "Angle" && !axis ? "edge" : "face";
    if (cadSelection.snapshot().filter !== filter) cadSelection.dispatch({ type: "set-filter", filter });
    // Each method collects only what it uses, so a leftover pick from another
    // method can never satisfy it.
    entitiesBoxCaption(method);
    validate();
  }

  /** Name the box after what the current method is asking for. */
  function entitiesBoxCaption(method: string) {
    const caption = entities.element.querySelector(".aui-feature-entities-caption");
    if (caption)
      caption.textContent =
        method === "Three point" ? "Points" : method === "Angle" ? "Edge and reference plane" : "Entities";
  }

  // Entities come from clicking planes in the viewport or Items tree.
  const addReference = (reference: PlaneReference) => {
    const key = JSON.stringify(reference);
    if (references.some((r) => JSON.stringify(r) === key)) return;
    references.push(reference);
    renderEntities();
    validate();
  };
  const onPrincipalPick = (event: Event) => {
    const plane = (event as CustomEvent).detail;
    if (plane === "XY" || plane === "XZ" || plane === "YZ")
      addReference({ kind: "principal", plane });
  };
  const onFeaturePick = (event: Event) => {
    const featureId = (event as CustomEvent).detail?.featureId;
    if (typeof featureId === "string" && earlierPlanes().some((f) => f.id === featureId))
      addReference({ kind: "feature", featureId });
  };
  /** A planar face on a solid is a plane like any other. The frame is captured
   *  here because face geometry lives in the kernel, not the document. */
  const onFacePick = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    if (!detail?.frame || typeof detail.partId !== "string" || !Number.isInteger(detail.faceId)) {
      if (detail?.error) win.status.textContent = detail.error;
      return;
    }
    win.status.textContent = "";
    addReference({
      kind: "face",
      partId: detail.partId,
      faceId: detail.faceId,
      label: detail.label,
      frame: detail.frame,
    });
  };
  /** Points and edges come from the same selection the rest of the app uses. */
  const onGeometry = (event: Event) => {
    const detail = (event as CustomEvent).detail;
    if (methodPicker.value() === "Three point") {
      const selected: PointReference[] = (detail?.points ?? []).map((p: any) => ({
        kind: "point" as const,
        partId: p.partId,
        candidateId: p.candidateId,
        label: p.label,
        positionMillimeters: p.positionMillimeters,
      }));
      for (const point of selected) {
        if (!points.some(p => p.partId === point.partId && p.candidateId === point.candidateId)) points.push(point);
      }
    } else if (methodPicker.value() === "Angle" && detail?.axis) {
      axis = {
            kind: "axis" as const,
            partId: detail.axis.partId,
            candidateId: detail.axis.candidateId,
            label: detail.axis.label,
            originMillimeters: detail.axis.originMillimeters,
            directionMillimeters: detail.axis.directionMillimeters,
          };
      if (cadSelection.snapshot().filter === "edge") cadSelection.dispatch({ type: "set-filter", filter: "face" });
    }
    renderEntities();
    validate();
  };
  /** Ask for the current point/edge selection. The methods that need geometry
   *  read the same selection the rest of the app uses, so picking in the
   *  viewport or the tree both work without a second pathway. */
  const requestGeometry = () =>
    window.dispatchEvent(new CustomEvent("aether-plane-geometry-request"));
  const unsubscribeSelection = cadSelection.subscribe(() => {
    const method = methodPicker.value();
    if (method === "Three point" || method === "Angle") requestGeometry();
  });
  window.addEventListener("aether-plane-geometry", onGeometry);
  window.addEventListener("aether-sketch-plane", onPrincipalPick);
  window.addEventListener("aether-plane-feature-picked", onFeaturePick);
  window.addEventListener("aether-sketch-face", onFacePick);
  window.dispatchEvent(new CustomEvent("aether-sketch-plane-selection", { detail: true }));
  syncMethod();
  renderEntities();
  if (created && (initialMethod === "angle" || initialMethod === "three-point")) requestGeometry();

}
