import { createProjectionWindow } from "./projection-window";
import { mountEditHistory } from "../modeling/edit-history";
import { openSketchWorkspace } from "../sketch-workspace";
import {
  insertFeature,
  rollbackPosition,
  resolveProfileDrawing,
  type PartDocument,
  type ProfileFeature,
} from "@aether/core/document";
import { renderSketchCanvas } from "./canvas-renderer";
import {
  populateProjectionGeometry,
  projectionGeometryReference,
} from "./projection-source-selection";
import "../sketch-workspace.css";
/** Source projection editing persists references rather than preview geometry. */
export function openProjectionEditor(
  getDocument: () => PartDocument | null,
  apply: (doc: PartDocument) => Promise<void>,
  existing?: ProfileFeature,
) {
  if (document.querySelector(".cad-sketch-workspace"))
    throw Error(
      "Finish or cancel the active sketch before creating a whole-sketch projection.",
    );
  const source = getDocument(),
    viewport = document.querySelector<HTMLElement>(".cad-studio-viewport");
  if (!source || !viewport)
    throw Error("Open a Part before projecting a sketch.");
  const index = existing
    ? source.features.findIndex((f) => f.id === existing.id)
    : rollbackPosition(source);
  if (index < 0) throw Error("The projected sketch no longer exists.");
  const featureId = existing?.id ?? crypto.randomUUID();
  const presentation = createProjectionWindow({
    viewport, existing: !!existing,
    onAccept: () => saveProjection(), onDiscard: () => close(),
  });
  const { root, canvas, field, win } = presentation;
  mountEditHistory(root, source, existing?.id);
  const name = field(
    "Projection name",
    document.createElement("input"),
  ) as HTMLInputElement;
  name.value = existing?.name ?? "Projected sketch";
  const select = field(
    "Source sketch",
    document.createElement("select"),
  ) as HTMLSelectElement;
  for (const f of source.features.slice(0, index))
    if (f.type === "profile") {
      const option = document.createElement("option");
      option.value = f.id;
      option.textContent = f.name + (f.suppressed ? " (suppressed)" : "");
      option.disabled = f.suppressed;
      select.append(option);
    }
  const oldSource =
    existing?.profile.type === "projection"
      ? existing.profile.sourceFeatureId
      : undefined;
  if (
    oldSource &&
    !Array.from(select.options).some((o) => o.value === oldSource)
  ) {
    const missing = document.createElement("option");
    missing.value = oldSource;
    missing.textContent = `Missing source: ${oldSource}`;
    select.append(missing);
  }
  select.value =
    oldSource ??
    Array.from(select.options).find((o) => !o.disabled)?.value ??
    "";
  const geometry = field(
    "Source geometry",
    document.createElement("select"),
  ) as HTMLSelectElement;
  populateProjectionGeometry(
    geometry,
    source,
    select.value,
    existing?.profile.type === "projection"
      ? existing.profile.sourceContourId
      : undefined,
  );
  const plane = field(
    "Target plane",
    document.createElement("select"),
  ) as HTMLSelectElement;
  for (const [value, label] of [
    ["XY", "Top (XY)"],
    ["XZ", "Front (XZ)"],
    ["YZ", "Right (YZ)"],
    ...(existing?.frame ? [["frame", "Current sketch plane"]] : []),
  ]) {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = label;
    plane.append(o);
  }
  plane.value = existing?.frame ? "frame" : (existing?.plane ?? "XY");
  const offset = field(
    "Plane offset (mm)",
    document.createElement("input"),
  ) as HTMLInputElement;
  offset.type = "number";
  offset.step = "any";
  offset.value = String(existing?.offsetMillimeters ?? 0);
  const message = win.status;
  const note = document.createElement("p");
  note.textContent = "Source edits update projected geometry.";
  win.addHelp(note);
  const save = win.accept, cancel = win.discard;
  let busy = false,
    candidate: PartDocument | null = null;
  const close = () => {
    if (!busy) presentation.close();
  };
  const preview = () => {
    candidate = null;
    save.disabled = true;
    offset.disabled = plane.value === "frame";
    try {
      if (!name.value.trim()) throw Error("Enter a projection name.");
      if (!select.value)
        throw Error("Create a source sketch before projecting it.");
      const linked = projectionGeometryReference(
        source,
        select.value,
        geometry.value,
      );
      const feature: ProfileFeature = {
        id: featureId,
        type: "profile",
        name: name.value.trim(),
        suppressed: existing?.suppressed ?? false,
        plane:
          plane.value === "frame"
            ? existing!.plane
            : (plane.value as ProfileFeature["plane"]),
        offsetMillimeters: Number(offset.value),
        profile: {
          type: "projection",
          ...linked.reference,
          ...(existing?.profile.type === "projection" && existing.profile.authored ? {authored: structuredClone(existing.profile.authored)} : {}),
        },
        ...(plane.value === "frame" ? { frame: existing!.frame } : {}),
      };
      if (!Number.isFinite(feature.offsetMillimeters) || !offset.value.trim())
        throw Error("Enter a finite plane offset.");
      candidate = existing
        ? {
            ...linked.document,
            features: linked.document.features.map((f) =>
              f.id === existing.id ? feature : f,
            ),
          }
        : insertFeature(linked.document, feature);
      const drawing = resolveProfileDrawing(
        candidate.features.map((f) =>
          f.id === feature.id ? { ...f, suppressed: false } : f,
        ),
        feature.id,
      );
      renderSketchCanvas(
        canvas,
        drawing,
        { x: -60, y: -40, width: 120, height: 80 },
        [],
      );
      // Native SVG bounds frame all curves without adding geometry calculations to UI.
      const boxes = Array.from(
        canvas.querySelectorAll<SVGGraphicsElement>(".sketch-contour"),
      )
        .map((e) => e.getBBox?.())
        .filter((b): b is DOMRect => Boolean(b));
      if (boxes.length) {
        const x = Math.min(...boxes.map((b) => b.x)),
          y = Math.min(...boxes.map((b) => b.y)),
          right = Math.max(...boxes.map((b) => b.x + b.width)),
          bottom = Math.max(...boxes.map((b) => b.y + b.height)),
          pad = Math.max(right - x, bottom - y, 1) * 0.12;
        renderSketchCanvas(
          canvas,
          drawing,
          {
            x: x - pad,
            y: y - pad,
            width: right - x + 2 * pad,
            height: bottom - y + 2 * pad,
          },
          [],
        );
      }
      message.textContent = `${drawing.contours.length} projected contours. Source link will be retained.`;
      save.disabled = busy;
    } catch (e) {
      candidate = null;
      canvas.replaceChildren();
      message.textContent = (e as Error).message;
    }
  };
  select.addEventListener("input", () => {
    populateProjectionGeometry(geometry, source, select.value);
    preview();
  });
  for (const input of [name, geometry, plane, offset])
    input.addEventListener("input", preview);
  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "aui-button";
  edit.textContent = "Save and edit geometry";
  canvas.after(edit);
  const saveProjection = async (editGeometry = false) => {
    if (busy || !candidate) return;
    if (getDocument() !== source) {
      message.textContent =
        "The document changed. Cancel and reopen the projection to use the current document.";
      save.disabled = true;
      return;
    }
    const next = structuredClone(candidate);
    busy = true;
    save.disabled = true;
    cancel.disabled = true;
    for (const input of [name, select, geometry, plane, offset])
      input.disabled = true;
    try {
      await apply(next);
      presentation.close();
      if (editGeometry) openSketchWorkspace(getDocument, apply, next.features.find(f=>f.id===featureId) as ProfileFeature);
    } catch (e) {
      message.textContent = (e as Error).message;
    } finally {
      busy = false;
      cancel.disabled = false;
      save.disabled = false;
      for (const input of [name, select, geometry, plane, offset])
        input.disabled = false;
      offset.disabled = plane.value === "frame";
    }
  };
  edit.onclick = () => { void saveProjection(true); };
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  });
  preview();
  name.focus();
}
