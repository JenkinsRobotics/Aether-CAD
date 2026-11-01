import { openCADFeatureWindow } from "../features/feature-window-style";
import { addFeatureViewControls } from "../features/view-controls";
import "../sketch-workspace.css";
import "./projection-window.css";

/** Projection settings use the same floating container and field rows as other
 * CAD features. The small preview stays in its body, leaving the viewport clear. */
export function createProjectionWindow(options: {
  viewport: HTMLElement;
  existing: boolean;
  onAccept(): void | Promise<void>;
  onDiscard(): void;
}) {
  const root = document.createElement("section");
  root.className = "cad-sketch-workspace choosing-plane cad-projection-workspace";
  root.setAttribute("aria-label", "Project sketch");
  options.viewport.append(root);
  const win = openCADFeatureWindow({
    viewport: options.viewport,
    className: "cad-projection-window",
    icon: "sketch",
    title: options.existing ? "Edit projection" : "Project sketch",
    acceptLabel: options.existing ? "Update projection" : "Create projection",
    discardLabel: "Cancel",
    onAccept: options.onAccept,
    onDiscard: options.onDiscard,
  });
  addFeatureViewControls(win);
  root.append(win.panel);
  const canvas = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  canvas.setAttribute("aria-label", "Projection preview");
  canvas.classList.add("cad-sketch-canvas", "cad-projection-preview");
  win.body.append(canvas);
  return {
    root, win, canvas,
    field<T extends HTMLInputElement | HTMLSelectElement>(label: string, element: T): T {
      element.setAttribute("aria-label", label);
      win.row(label, element);
      return element;
    },
    close() { win.close(); root.remove(); },
  };
}
