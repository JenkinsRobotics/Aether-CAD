/** Fillet, as Onshape's (help: fillet.htm): the Edge / Full round tabs; for Edge the Entities to
 *  fillet, Tangent propagation, Measurement (Radius / Width), Control (Distance / Conic / Curvature),
 *  Radius, Asymmetric, Partial fillet, Variable fillet, Allow edge overflow and Smooth fillet corners;
 *  for Full round the Side face, Opposite side face, Faces to replace and Tangent propagation.
 *  Controls this kernel cannot honour are present and disabled with the gap named (never silent):
 *  Conic and Curvature control, Asymmetric, Partial fillet, points on edge and smooth transition,
 *  the edge-overflow choice and Smooth fillet corners (ledger: Fillet). Edge picking and the
 *  saved-document scopes live in edge-finish.ts. */
import type { SolidFaceReference } from "@aether/core/document";
import { edgeFinishControls, layoutEdgeFinish, serializeEdgeFinish, validateEdgeFinish } from "./edge-finish";
import { faceIdentity, mountPickedReferences } from "./picked-references";
import { checkRow, iconButton, planned, rowIn, unitSuffix, type Controls, type FeatureEditor, type FeatureEditorContext } from "./shared";

const circularOnly = "Not available in this kernel: its fillets are circular (OCCT), so Conic and Curvature control are a recorded gap.";
const asymmetricGap = "Not available in this kernel: an asymmetric (elliptical) blend is a recorded gap.";
const partialGap = "Not available in this kernel: a partial fillet needs the edge split before blending, a recorded gap.";
const pointsGap = "Not available in this kernel: radii at points along the edge are a recorded gap (start and end radius only).";
const overflowGap = "Always on in this kernel: choosing edges to keep is a recorded gap.";
const cornersGap = "Not available in this kernel: vertex blends between fillets are a recorded gap.";

export const filletEditor: FeatureEditor = {
  type: "fillet",

  controls(context: FeatureEditorContext): Controls {
    const { field, feature } = context;
    return {
      ...edgeFinishControls(context),
      filletType: field("Fillet type", feature?.filletType === "full-round" ? "full-round" : "edge", ["edge", "full-round"]),
      measurement: field("Measurement", feature?.measurement ?? "radius", ["radius", "width"]),
      control: field("Control", "distance", ["distance", "conic", "curvature"]),
      radius: field("Radius (mm)", String(feature?.radiusMillimeters ?? 0.5)),
      variable: field("Variable fillet", String(feature?.endRadiusMillimeters !== undefined), ["false", "true"]),
      endRadius: field("End radius (mm)", String(feature?.endRadiusMillimeters ?? feature?.radiusMillimeters ?? 0.5)),
      points: field("Points on edge", JSON.stringify(feature?.type === "fillet" ? feature.points ?? [] : [])),
      sideFace: field("Side face", JSON.stringify(feature?.sideFace ? [feature.sideFace] : [])),
      oppositeSideFace: field("Opposite side face", JSON.stringify(feature?.oppositeSideFace ? [feature.oppositeSideFace] : [])),
      replacedFaces: field("Faces to replace", JSON.stringify(feature?.replacedFaces ?? [])),
    };
  },

  layout(context, controls) {
    const { win, form, lengthUnitLabel } = context;
    const hide = (control: Controls[string]) => { control.closest("label")?.remove(); control.hidden = true; control.setAttribute("form", form.id); form.append(control); };
    const row = (label: string, control: Controls[string]) => { control.closest("label")?.remove(); control.setAttribute("form", form.id); return rowIn(label, control, unitSuffix(lengthUnitLabel)); };
    const gapCheck = (label: string, reason: string, checked = false) => { const box = document.createElement("input"); box.type = "checkbox"; box.checked = checked; box.setAttribute("aria-label", label); return planned(rowIn(label, box), reason); };
    const gapInput = (label: string, reason: string, unit?: string) => { const input = document.createElement("input"); input.type = "text"; input.setAttribute("aria-label", label); return planned(unit ? rowIn(label, input, unitSuffix(unit)) : rowIn(label, input), reason); };

    // Edge | Full round
    hide(controls.filletType);
    const tabs = win.tabs(["Edge", "Full round"], controls.filletType.value === "full-round" ? 1 : 0);
    const edge = document.createElement("div"), fullRound = document.createElement("div");
    win.body.append(tabs, edge, fullRound);

    // Edge: the entities box and Tangent propagation from the shared edge-finish layout, moved into the tab.
    const finish = layoutEdgeFinish(context, controls, "Entities to fillet");
    edge.append(finish.entities, finish.tangent);
    hide(controls.measurement);
    const measurements = { Radius: "radius", Width: "width" } as const;
    const measurement = win.picker(Object.keys(measurements), { ariaLabel: "Measurement menu", onChange: (value) => { controls.measurement.value = measurements[value as keyof typeof measurements]; sync(); controls.measurement.dispatchEvent(new Event("change")); } });
    measurement.setValue(controls.measurement.value === "width" ? "Width" : "Radius");
    edge.append(rowIn("Measurement", measurement.element));
    hide(controls.control);
    const controlModes = { Distance: "distance", Conic: "conic", Curvature: "curvature" } as const;
    const control = win.picker(Object.keys(controlModes), { ariaLabel: "Control menu", onChange: (value) => { controls.control.value = controlModes[value as keyof typeof controlModes]; sync(); controls.control.dispatchEvent(new Event("change")); } });
    control.setValue("Distance");
    edge.append(rowIn("Control", control.element));
    const size = row("Radius", controls.radius);
    edge.append(size);
    const rho = gapInput("Rho", circularOnly), magnitude = gapInput("Magnitude", circularOnly);
    edge.append(rho, magnitude);
    // Asymmetric: second radius and its flip.
    const asymmetric = win.subsection("Asymmetric", { kind: "checkbox", open: false });
    asymmetric.body.append(gapInput("Second radius", asymmetricGap, lengthUnitLabel), rowIn("Flip asymmetric", planned(iconButton("flip-horizontal", "Flip asymmetric"), asymmetricGap)));
    planned(asymmetric.element, asymmetricGap);
    edge.append(asymmetric.element);
    // Partial fillet: start position, end type, second bound.
    const partial = win.subsection("Partial fillet", { kind: "checkbox", open: false });
    partial.body.append(gapInput("Start position", partialGap), gapInput("End type", partialGap), gapCheck("Second bound", partialGap));
    planned(partial.element, partialGap);
    edge.append(partial.element);
    // Variable fillet: the two vertices' radii are real; points on the edge and the smooth transition are gaps.
    hide(controls.variable);
    const variable = win.subsection("Variable fillet", { kind: "checkbox", open: controls.variable.value === "true", onToggle: (open) => { controls.variable.value = String(open); sync(); controls.variable.dispatchEvent(new Event("change")); } });
    const end = row("End radius", controls.endRadius);
    // Points on the edge: (position along the edge, radius) rows, the same law on every picked edge.
    hide(controls.points);
    const pointsList = document.createElement("div"); pointsList.className = "cad-fillet-points";
    const readPoints = (): { position: number; radiusMillimeters: number }[] => JSON.parse(controls.points.value || "[]");
    const writePoints = (points: { position: number; radiusMillimeters: number }[]) => { controls.points.value = JSON.stringify(points); renderPoints(); controls.points.dispatchEvent(new Event("change")); };
    const renderPoints = () => {
      pointsList.replaceChildren(...readPoints().map((point, index) => {
        const position = document.createElement("input"); position.type = "text"; position.value = String(point.position); position.setAttribute("aria-label", `Point ${index + 1} position`);
        const radius = document.createElement("input"); radius.type = "text"; radius.value = String(point.radiusMillimeters); radius.setAttribute("aria-label", `Point ${index + 1} radius`);
        const update = () => { const points = readPoints(); points[index] = { position: Number(position.value), radiusMillimeters: Number(radius.value) }; controls.points.value = JSON.stringify(points); controls.points.dispatchEvent(new Event("change")); };
        position.onchange = update; radius.onchange = update;
        const remove = iconButton("close", `Remove point ${index + 1}`); remove.onclick = () => writePoints(readPoints().filter((_, i) => i !== index));
        return rowIn(`Point ${index + 1} (0…1, ${lengthUnitLabel})`, position, radius, remove);
      }));
    };
    const addPoint = Object.assign(document.createElement("button"), { type: "button", className: "aui-button", textContent: "Add point on edge" });
    addPoint.onclick = () => { const points = readPoints(); writePoints([...points, { position: Math.round((points.length + 1) / (points.length + 2) * 100) / 100, radiusMillimeters: Number(controls.radius.value) || 1 }]); };
    renderPoints();
    variable.body.append(end, pointsList, rowIn("Points on edge", addPoint), gapCheck("Smooth transition", pointsGap));
    edge.append(variable.element);
    // Allow edge overflow is always on in this kernel; the edges to keep are a gap.
    const overflow = win.subsection("Allow edge overflow", { kind: "checkbox", open: true });
    const keep = win.entitiesBox("Edges to keep"); keep.render([]);
    overflow.body.append(planned(keep.element, overflowGap));
    planned(overflow.element, overflowGap);
    edge.append(overflow.element);
    // Smooth fillet corners and the corners to exclude.
    const corners = win.subsection("Smooth fillet corners", { kind: "checkbox", open: false });
    const exclude = win.entitiesBox("Corners to exclude"); exclude.render([]);
    corners.body.append(planned(exclude.element, cornersGap));
    planned(corners.element, cornersGap);
    edge.append(corners.element);

    // Full round: three face boxes and Tangent propagation. Mounted last to first: each box prepends itself.
    const faceBox = (control: Controls[string], title: string, single: boolean) => {
      const box = mountPickedReferences<SolidFaceReference>(context, control, {
        title, kind: "face", requestEvent: "aether-offset-faces-request", replyEvent: "aether-offset-faces", replyKey: "faces", identity: faceIdentity,
        onChange: (picked) => { if (single && picked.length > 1) box.update([picked[picked.length - 1]]); },
      });
      return box.element;
    };
    const replaced = faceBox(controls.replacedFaces, "Faces to replace", false);
    const oppositeSide = faceBox(controls.oppositeSideFace, "Opposite side face", true);
    const sideFace = faceBox(controls.sideFace, "Side face", true);
    fullRound.append(sideFace, oppositeSide, replaced, checkRow(context, controls.tangentChain, "Tangent propagation"));

    const sync = () => {
      const full = controls.filletType.value === "full-round";
      edge.hidden = full; fullRound.hidden = !full;
      rho.hidden = controls.control.value !== "conic"; magnitude.hidden = controls.control.value !== "curvature";
      end.hidden = controls.variable.value !== "true";
      const width = controls.measurement.value === "width";
      size.querySelector("span")!.textContent = width ? "Width" : "Radius"; end.querySelector("span")!.textContent = width ? "End width" : "End radius";
    };
    [...tabs.children].forEach((tab, index) => { (tab as HTMLButtonElement).onclick = () => {
      controls.filletType.value = index === 1 ? "full-round" : "edge";
      [...tabs.children].forEach((other, i) => other.classList.toggle("active", i === index));
      sync(); controls.filletType.dispatchEvent(new Event("change"));
      // The shown tab's first box takes the picks.
      (index === 1 ? sideFace : finish.entities).dispatchEvent(new Event("pointerdown"));
    }; });
    sync();
    // The shown tab's first box is the active picker (the last mounted box would be otherwise).
    (controls.filletType.value === "full-round" ? sideFace : finish.entities).dispatchEvent(new Event("pointerdown"));
    const note = document.createElement("p"); note.textContent = "Full round replaces the faces between the two side faces with a blend tangent to both: in this kernel the side faces must be parallel planes and the replaced faces planar between them. Disabled controls name the kernel gap in their tooltip."; win.addHelp(note);
  },

  validate(controls) {
    if (controls.filletType.value === "full-round") {
      if (!JSON.parse(controls.sideFace.value || "[]").length) return "Select the side face.";
      if (!JSON.parse(controls.oppositeSideFace.value || "[]").length) return "Select the opposite side face.";
      if (!JSON.parse(controls.replacedFaces.value || "[]").length) return "Select the faces to replace.";
      return null;
    }
    if (controls.control.value !== "distance") return circularOnly;
    if (!(Number(controls.radius.value) > 0)) return "Enter a positive radius.";
    if (controls.variable.value === "true" && !(Number(controls.endRadius.value) > 0)) return "Enter a positive end radius.";
    if (controls.variable.value === "true") for (const point of JSON.parse(controls.points.value || "[]") as { position: number; radiusMillimeters: number }[]) if (!(point.position > 0 && point.position < 1) || !(point.radiusMillimeters > 0)) return "Each point on the edge needs a position between 0 and 1 and a positive radius.";
    return validateEdgeFinish(controls, "fillet");
  },

  serialize(values) {
    if (values.filletType === "full-round") {
      const one = (text: string) => JSON.parse(text || "[]")[0];
      return { filletType: "full-round", sideFace: one(values.sideFace), oppositeSideFace: one(values.oppositeSideFace), replacedFaces: JSON.parse(values.replacedFaces || "[]"), ...(values.tangentChain === "yes" ? { tangentChain: true } : {}) };
    }
    return {
      radiusMillimeters: Number(values.radius),
      ...(values.measurement === "width" ? { measurement: "width" } : {}),
      ...(values.variable === "true" ? { endRadiusMillimeters: Number(values.endRadius), ...(JSON.parse(values.points || "[]").length ? { points: JSON.parse(values.points) } : {}) } : {}),
      ...serializeEdgeFinish(values),
    };
  },
};
