import { resizeCircleFromPointer } from "./circle-resize";
import {
  dragSketchEntity,
  sketchEntityPoint,
  type SketchDrawing,
  type SketchPoint,
  type SketchEntityRef,
} from "@aether/core/sketch";
import { commitDragSnap, dragAnchor, snapDraggedPoint, type DragSnap } from "./drag-snapping";
import { showDragFeedback } from "./drag-feedback";
import {pickSketchEditEntity} from './edit-picking';
import {dragSketchEllipse,fullSketchEllipse,type EllipseHandle} from '../../freecad-engine/browser/ellipse-manipulation';
import { conicDragTarget, setConicCurvature } from '../../freecad-engine/browser/conic-manipulation';
interface Options {
  svg: SVGSVGElement;
  enabled: () => boolean;
  point: (e: MouseEvent) => SketchPoint | null;
  drawing: () => SketchDrawing;
  tolerance: () => number;
  snapping?: () => boolean;
  snapTolerance?: () => number;
  preview: (d: SketchDrawing) => void;
  commit: (before: SketchDrawing, after: SketchDrawing) => void;
  select: (ref: SketchEntityRef) => void;
  report: (s: string) => void;
}
export function bindSelectionDrag(o: Options) {
  let drag:
      | {
          id: number;
          screen: SketchPoint;
          start: SketchPoint;
          ref: SketchEntityRef;
          before: SketchDrawing;
          after: SketchDrawing;
          moved: boolean;
          snap?: DragSnap;
          ellipse?: Pick<EllipseHandle,'contour'|'kind'|'side'>;
          conic?: boolean;
        }
      | undefined,
    consume = false;
  o.svg.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !o.enabled()) return;
    const p = o.point(e);
    if (!p) return;
    const pick = pickSketchEditEntity(o.drawing(), p, o.svg);
    if (!pick || pick.d > o.tolerance() || pick.ref.projectedContourId!==undefined) return;
    const before = structuredClone(o.drawing());
    drag = {
      id: e.pointerId,
      screen: [e.clientX, e.clientY],
      start: p,
      ref: pick.ref,
      before,
      after: before,
      moved: false,
      conic: 'conicHandle' in pick,
      ellipse: 'ellipseHandle' in pick ? pick.ellipseHandle : pick.ref.kind!=='point' && fullSketchEllipse(before,pick.ref.contour)
        ? {contour:pick.ref.contour,kind:'center',side:1} : undefined,
    };
  });
  const advance = (e: PointerEvent) => {
    if (!drag || drag.id !== e.pointerId) return;
    if (!o.enabled()) { cancel(); return; }
    if (!drag.moved && Math.hypot(e.clientX - drag.screen[0], e.clientY - drag.screen[1]) < 3) return;
    const p = o.point(e);
    if (!p) return;
    drag.moved = true;
    o.svg.dataset.selectionDrag = "true";
    o.svg.setPointerCapture?.(e.pointerId);
    o.select(drag.ref);
    drag.snap = undefined;
    try {
      const delta:SketchPoint=[p[0]-drag.start[0],p[1]-drag.start[1]];
      const conic = drag.conic ? conicDragTarget(drag.before, drag.ref, drag.start, p,
        o.snapping?.() && !e.altKey ? o.snapTolerance?.() ?? o.tolerance() : 0) : undefined;
      const resizing = drag.conic || (drag.ellipse ? drag.ellipse.kind!=='center' : drag.before.contours[drag.ref.contour]?.type === "circle" && drag.ref.kind !== "point");
      const raw = conic ? setConicCurvature(drag.before, drag.ref, conic.rho)
        : drag.ellipse ? dragSketchEllipse(drag.before,drag.ellipse,drag.start,p)
        : resizing ? resizeCircleFromPointer(drag.before,drag.ref.contour,drag.start,p) : dragSketchEntity(drag.before,drag.ref,delta);
      drag.after = raw;
      if (conic?.snapped) drag.snap = { point: conic.point, constraints: [],
        guides: [{ from: conic.handle.midpoint, to: conic.point, label: 'Parabola · ρ 0.5' }] };
      const anchor = drag.ellipse?.kind==='center' && drag.ref.kind==='ellipse' ? undefined : dragAnchor(drag.before, drag.ref, drag.start);
      if (!resizing && o.snapping?.() && !e.altKey && anchor) {
        const snap = snapDraggedPoint(drag.before, raw, anchor, o.snapTolerance?.() ?? o.tolerance());
        const current = sketchEntityPoint(raw, anchor)!;
        if (snap.guides.length) {
          try {
            const snappedDelta:SketchPoint=[delta[0]+snap.point[0]-current[0],delta[1]+snap.point[1]-current[1]];
            const snapped = drag.ellipse ? dragSketchEllipse(drag.before,drag.ellipse,drag.start,[drag.start[0]+snappedDelta[0],drag.start[1]+snappedDelta[1]])
              : dragSketchEntity(drag.before,drag.ref,snappedDelta);
            const actual = sketchEntityPoint(snapped, anchor)!;
            if (Math.hypot(actual[0] - snap.point[0], actual[1] - snap.point[1]) < 1e-6) {
              drag.after = snapped;
              drag.snap = snap;
            }
          } catch { /* A conflicting inference yields to the user's existing constraints. */ }
        }
      }
      o.preview(drag.after);
      showDragFeedback(o.svg, drag.snap, (o.snapTolerance?.() ?? o.tolerance()) / 8);
    } catch (error) {
      drag.after = drag.before;
      o.preview(drag.before);
      showDragFeedback(o.svg, undefined, 1);
      o.report((error as Error).message);
    }
  };
  o.svg.addEventListener("pointermove", advance);
  o.svg.addEventListener("pointerup", (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    advance(e);
    if (!drag) return;
    const done = drag;
    drag = undefined;
    delete o.svg.dataset.selectionDrag;
    showDragFeedback(o.svg, undefined, 1);
    if (done.moved) {
      consume = true;
      let after = done.after;
      try { after = commitDragSnap(after, done.snap); }
      catch (error) { o.report(`Placement kept without the inferred constraint: ${(error as Error).message}`); }
      o.commit(done.before, after);
    }
    if (o.svg.hasPointerCapture?.(e.pointerId))
      o.svg.releasePointerCapture(e.pointerId);
  });
  const cancel = () => {
    delete o.svg.dataset.selectionDrag;
    showDragFeedback(o.svg, undefined, 1);
    if (drag) {
      const { before, id, moved } = drag;
      drag = undefined;
      consume = moved;
      o.preview(before);
      if (o.svg.hasPointerCapture?.(id)) o.svg.releasePointerCapture(id);
    }
  };
  o.svg.addEventListener("pointercancel", cancel);
  o.svg.addEventListener("lostpointercapture", cancel);
  return {
    cancel,
    active: () => !!drag?.moved,
    consumeClick() {
      const result = consume;
      consume = false;
      return result;
    },
  };
}
