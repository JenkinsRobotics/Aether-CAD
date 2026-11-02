import { mountSketchSnappingControls } from './snapping-controls';
import { createCoordinateFields } from "@aether/ui";
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
  const button = (label: string, run: () => void, container: HTMLElement = parent) => {
    const button = document.createElement("button");
    button.type = "button"; button.textContent = label; button.onclick = run; container.append(button); return button;
  };
  // A line is a point followed by a point (Jonathan, 2026-11-01): no contour buttons and no
  // typed X/Y row in the strip. ponytail: both stay in the DOM, hidden, for the suite and agents.
  const contourActions = document.createElement('div');
  contourActions.className = 'sketch-contour-actions'; contourActions.hidden = true; parent.append(contourActions);
  button("New contour", o.newContour, contourActions); button("Close contour", o.closeContour, contourActions);
  const numeric = (label: string, value: string) => {
    const row = document.createElement("label"), input = document.createElement("input");
    input.type = "number"; input.step = "any"; input.value = value; input.setAttribute("aria-label", label);
    // Accepting typed coordinates must not accept/close the surrounding tool
    // window, which would discard an unfinished drawing gesture.
    input.addEventListener("keydown", event => {
      if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); }
    });
    row.className = 'aui-feature-row';
    const caption = document.createElement('span'); caption.textContent = label;
    row.append(caption, input); parent.append(row); return input;
  };
  const x = numeric("X (mm)", "0"), y = numeric("Y (mm)", "0");
  const oldRows = [x.parentElement!, y.parentElement!];
  const coordinateRow = createCoordinateFields('Point (mm)', [{ axis: 'X', control: x }, { axis: 'Y', control: y }]);
  oldRows.forEach(row => row.remove()); parent.append(coordinateRow); coordinateRow.hidden = true;
  const point = (): SketchPoint => [Number(x.value), Number(y.value)];
  for (const input of [x, y]) input.oninput = () => { const p = point(); o.preview(p.every(Number.isFinite) ? p : null); };
  button("Place point", () => { const p = point(); if (p.every(Number.isFinite)) o.place(p); }).hidden = true;
  const ellipseRadius = mountEllipticalRadiusControl(parent, o.changed);
  const arcDirection = mountArcDirectionControl(parent, o.changed);
  const conicRho = mountConicRhoControl(parent, o.changed, () => o.variables?.(), o.confirmConic);
  const sides = numeric("Polygon sides", "6");
  sides.min = "3"; sides.max = "100"; sides.step = "1"; sides.oninput = o.changed;
  const slotWidth = numeric("Point slot width (mm)", "6"); slotWidth.min = "0"; slotWidth.oninput = o.changed;
  const disposeSnapping = mountSketchSnappingControls(parent, o);
  return { dispose: disposeSnapping, point, sides: () => Number(sides.value), slotWidth: () => Number(slotWidth.value), ellipseRadius, arcDirection, conicRho,
    update: (tool: string) => { sides.parentElement!.hidden = !tool.endsWith("polygon"); slotWidth.parentElement!.hidden = !tool.endsWith("-slot"); conicRho.update(tool); } };
}
