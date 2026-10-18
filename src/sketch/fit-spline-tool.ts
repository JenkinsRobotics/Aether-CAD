import {
  fitSketchSpline,
  constrainFitSpline,
  validateSketchDrawing,
  type SketchDrawing,
  type SketchPoint,
} from "@aether/core/sketch";
import { cadCommands } from "../cad-command-registry";
/** UI lifecycle only; interpolation belongs to Core. Pending points do not
 * enter the document until this explicit finish action succeeds. */
export function mountFitSplineTool(
  parent: HTMLElement,
  svg: SVGSVGElement,
  options: {
    state: () => {
      tool: string;
      pending: SketchPoint[];
      drawing: SketchDrawing;
      construction: boolean;
      busy: boolean;
    };
    commit: (drawing: SketchDrawing) => void;
    changePending: (points: SketchPoint[]) => void;
    error: (message: string) => void;
  },
) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Finish spline";
  parent.append(button);
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Close spline";
  parent.append(close);
  const remove = document.createElement("button");
  remove.type = "button";
  remove.textContent = "Remove last spline point";
  parent.append(remove);
  let observed: SketchPoint[] | undefined;
  let redoPoints: SketchPoint[][] = [];
  const sync = () => {
    const s = options.state();
    if (s.tool !== "fit-spline" || s.pending !== observed) redoPoints = [];
    observed = s.pending;
    return s;
  };
  const changePending = (points: SketchPoint[]) => {
    observed = points;
    options.changePending(points);
  };
  const finish = (closed = false) => {
    const s = options.state();
    if (s.tool !== "fit-spline" || s.busy) return;
    try {
      const contour = fitSketchSpline(s.pending, { closed });
      if (s.construction) contour.construction = true;
      const next = structuredClone(s.drawing);
      next.contours.push(contour);
      validateSketchDrawing(next);
      options.commit(constrainFitSpline(next, next.contours.length - 1));
    } catch (e) {
      options.error((e as Error).message);
    }
  };
  button.onclick = () => finish();
  close.onclick = () => finish(true);
  const undo = () => {
    const s = sync();
    if (s.tool !== "fit-spline" || s.busy || !s.pending.length) return false;
    redoPoints.push(s.pending);
    changePending(s.pending.slice(0, -1));
    return true;
  };
  const redo = () => {
    const s = sync();
    if (s.tool !== "fit-spline" || s.busy) return false;
    const points = redoPoints.pop();
    if (!points) return false;
    changePending(points);
    return true;
  };
  remove.onclick = () => { undo(); };
  // A browser double click sends click(1), click(2), then dblclick. The first
  // click places the final fit point; the second must never place it again,
  // including when the first click has just closed the spline at its start.
  const click = (e: MouseEvent) => {
    if (options.state().tool !== "fit-spline" || e.button !== 0 || e.detail < 2) return;
    e.preventDefault(); e.stopImmediatePropagation();
  };
  const doubleClick = (e: MouseEvent) => {
    const s = options.state();
    if (s.tool !== "fit-spline" || e.button !== 0) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (s.pending.length >= 2) finish();
  };
  svg.addEventListener("click", click, true);
  svg.addEventListener("dblclick", doubleClick, true);
  const disposeCommands = [
    cadCommands.register("sketch-finish-spline", () => finish()),
    cadCommands.register("sketch-remove-spline-point", () => { undo(); }),
  ];
  return {
    undo, redo,
    canUndo: () => { const s = sync(); return s.tool === "fit-spline" && !s.busy && s.pending.length > 0; },
    canRedo: () => { const s = sync(); return s.tool === "fit-spline" && !s.busy && redoPoints.length > 0; },
    key(e: KeyboardEvent) {
      const s = sync();
      if (s.tool !== "fit-spline" || s.busy || e.ctrlKey || e.metaKey || e.altKey) return false;
      if (e.key === "Enter" && s.pending.length) {
        e.preventDefault(); e.stopPropagation(); finish(); return true;
      }
      if (["Delete", "Backspace"].includes(e.key) && s.pending.length) {
        e.preventDefault(); e.stopPropagation(); undo(); return true;
      }
      return false;
    },
    refresh() {
      const s = sync();
      close.hidden = s.tool !== "fit-spline";
      close.disabled = s.busy || s.pending.length < 3;
      button.hidden = s.tool !== "fit-spline";
      button.disabled = s.busy || s.pending.length < 2;
      remove.hidden = s.tool !== "fit-spline";
      remove.disabled = s.busy || !s.pending.length;
      cadCommands.setEnabled("sketch-finish-spline", !button.hidden && !button.disabled);
      cadCommands.setEnabled("sketch-remove-spline-point", !remove.hidden && !remove.disabled);
    },
    dispose() {
      svg.removeEventListener("click", click, true);
      svg.removeEventListener("dblclick", doubleClick, true);
      disposeCommands.forEach(dispose => dispose());
      button.remove();
      close.remove();
      remove.remove();
    },
  };
}
