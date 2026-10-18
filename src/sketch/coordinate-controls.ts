import type { SketchPoint } from "@aether/core/sketch";
import { mountEllipticalRadiusControl } from "./elliptical-radius-control";
import { mountArcDirectionControl } from "./arc-direction-control";
import { mountConicRhoControl } from './conic-rho-control';
import type { DocumentVariable } from '@aether/core/document';
/** Explicit coordinate entry and drawing parameters in the active tool editor. */
export function mountSketchCoordinates(parent: HTMLElement, o: {
  place(point: SketchPoint): void;
  preview(point: SketchPoint | null): void;
  changed(): void;
  newContour(): void;
  closeContour(): void;
  geometrySnap(value: boolean): void;
  gridSnap(value: boolean): void;
  variables?(): readonly DocumentVariable[] | undefined;
  confirmConic?(): void;
}) {
  const button = (label: string, run: () => void) => {
    const button = document.createElement("button");
    button.type = "button"; button.textContent = label; button.onclick = run; parent.append(button);
  };
  button("New contour", o.newContour); button("Close contour", o.closeContour);
  const numeric = (label: string, value: string) => {
    const row = document.createElement("label"), input = document.createElement("input");
    input.type = "number"; input.step = "any"; input.value = value; input.setAttribute("aria-label", label);
    // Accepting typed coordinates must not accept/close the surrounding tool
    // window, which would discard an unfinished drawing gesture.
    input.addEventListener("keydown", event => {
      if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); }
    });
    row.append(label, input); parent.append(row); return input;
  };
  const x = numeric("X (mm)", "0"), y = numeric("Y (mm)", "0");
  const point = (): SketchPoint => [Number(x.value), Number(y.value)];
  for (const input of [x, y]) input.oninput = () => { const p = point(); o.preview(p.every(Number.isFinite) ? p : null); };
  button("Place point", () => { const p = point(); if (p.every(Number.isFinite)) o.place(p); });
  const ellipseRadius = mountEllipticalRadiusControl(parent, o.changed);
  const arcDirection = mountArcDirectionControl(parent, o.changed);
  const conicRho = mountConicRhoControl(parent, o.changed, () => o.variables?.(), o.confirmConic);
  const sides = numeric("Polygon sides", "6");
  sides.min = "3"; sides.max = "100"; sides.step = "1"; sides.oninput = o.changed;
  for (const [label, change] of [["Snap to geometry", o.geometrySnap], ["Snap to grid", o.gridSnap]] as const) {
    const row = document.createElement("label"), input = document.createElement("input");
    input.type = "checkbox"; input.checked = true; input.setAttribute("aria-label", label);
    input.onchange = () => change(input.checked); row.append(input, label); parent.append(row);
  }
  return { point, sides: () => Number(sides.value), ellipseRadius, arcDirection, conicRho,
    update: (tool: string) => { sides.parentElement!.hidden = !tool.endsWith("polygon"); conicRho.update(tool); } };
}
