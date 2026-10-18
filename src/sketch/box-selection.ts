import { sketchEntities, sketchEntityPoint, sketchContourPolyline, type SketchDrawing, type SketchEntityRef, type SketchPoint } from '@aether/core/sketch';
import { boxSelectionMode, normalizedSelectionBox, type CADScreenRect } from '../cad-selection-store';
import { pickSketchEditEntity } from './edit-picking';
import './box-selection.css';

type Project = (point: SketchPoint) => SketchPoint | null;
const inside = (p: SketchPoint, r: CADScreenRect) => p[0] >= r.left && p[0] <= r.right && p[1] >= r.top && p[1] <= r.bottom;
function crosses(a: SketchPoint, b: SketchPoint, r: CADScreenRect) {
  let lo = 0, hi = 1;
  for (const [start, delta, min, max] of [[a[0], b[0]-a[0], r.left, r.right], [a[1], b[1]-a[1], r.top, r.bottom]]) {
    if (Math.abs(delta) < 1e-12) { if (start < min || start > max) return false; }
    else { const x = (min-start)/delta, y = (max-start)/delta; lo = Math.max(lo, Math.min(x,y)); hi = Math.min(hi, Math.max(x,y)); if (lo > hi) return false; }
  }
  return true;
}
/** Screen-space geometry selection works equally for flat and oblique sketch planes. */
export function sketchEntitiesInBox(drawing: SketchDrawing, project: Project, rect: CADScreenRect, mode: 'window' | 'crossing'): SketchEntityRef[] {
  const found: SketchEntityRef[] = [];
  drawing.contours.forEach((contour, index) => {
    const check = (ref: SketchEntityRef, points: SketchPoint[]) => {
      const projected = points.map(project); if (projected.some(p => !p)) return;
      const ps = projected as SketchPoint[];
      if (ps.length && (mode === 'window' ? ps.every(p => inside(p,rect)) : ps.some(p => inside(p,rect)) || ps.some((p,i) => i > 0 && crosses(ps[i-1],p,rect)))) found.push(ref);
    };
    if (contour.type === 'circle') check({ contour: index, kind: 'circle' }, sketchContourPolyline(contour, 128));
    else if (!contour.segments.length) check({ contour: index, kind: 'point', index: 0 }, [contour.start]);
    else contour.segments.forEach((segment, i) => check({ contour: index, kind: segment.type === 'line' ? 'line' : segment.type === 'arc' ? 'arc' : 'curve', index: i, ...(segment.type === 'bezier' || segment.type === 'ellipse' || segment.type === 'conic' ? { parameter: .5 } : {}) }, sketchContourPolyline({ type: 'path', start: i ? contour.segments[i-1].end : contour.start, segments: [segment] }, 128)));
  });
  const edgeContours = new Set(found.filter(ref => ref.kind !== 'point').map(ref => ref.contour));
  for (const { ref } of sketchEntities(drawing)) {
    if (ref.kind !== 'point' || edgeContours.has(ref.contour)) continue;
    const point = sketchEntityPoint(drawing, ref), screen = point ? project(point) : null;
    if (screen && inside(screen, rect) && !found.some(r => JSON.stringify(r) === JSON.stringify(ref))) found.push(ref);
  }
  return found;
}
export function bindSketchBoxSelection(o: { svg: SVGSVGElement; enabled(): boolean; drawing(): SketchDrawing; point(e: MouseEvent): SketchPoint | null; project: Project; tolerance(): number; select(refs: SketchEntityRef[], add: boolean): void; preview?(refs: SketchEntityRef[] | null, add: boolean): void }) {
  let drag: { id: number; x: number; y: number; moved: boolean } | undefined, overlay: HTMLDivElement | undefined, consume = false;
  const cancel = () => { const wasMoved = drag?.moved; drag = undefined; overlay?.remove(); overlay = undefined; if (wasMoved) o.preview?.(null, false); };
  const candidates = (e: PointerEvent) => {
    const mode = boxSelectionMode(drag!.x, e.clientX);
    const rect = normalizedSelectionBox({ startX: drag!.x, startY: drag!.y, currentX: e.clientX, currentY: e.clientY, mode });
    return sketchEntitiesInBox(o.drawing(), o.project, rect, mode);
  };
  const down = (e: PointerEvent) => {
    if (e.button !== 0 || !o.enabled()) return;
    if ((e.target as Element)?.closest?.('.sketch-dimension, [data-constraint-mark]')) return;
    if ([...o.svg.querySelectorAll('.sketch-dimension text')].some(node => { const r = node.getBoundingClientRect(); return r.width > 0 && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom; })) return;
    const p = o.point(e); if (!p) return;
    const hit = pickSketchEditEntity(o.drawing(), p, o.svg); if (hit && hit.d <= o.tolerance()) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
  };
  const move = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!o.enabled()) { cancel(); return; }
    if (!drag.moved && Math.hypot(e.clientX-drag.x,e.clientY-drag.y) < 4) return;
    drag.moved = true; e.preventDefault(); e.stopImmediatePropagation();
    if (!overlay) { overlay = document.createElement('div'); overlay.className = 'cad-sketch-selection-box'; document.body.append(overlay); }
    overlay.dataset.mode = boxSelectionMode(drag.x,e.clientX);
    overlay.style.left = `${Math.min(drag.x,e.clientX)}px`; overlay.style.top = `${Math.min(drag.y,e.clientY)}px`;
    overlay.style.width = `${Math.abs(e.clientX-drag.x)}px`; overlay.style.height = `${Math.abs(e.clientY-drag.y)}px`;
    o.preview?.(candidates(e), e.shiftKey || e.ctrlKey || e.metaKey);
  };
  const up = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    move(e); if (!drag) return;
    if (drag.moved) {
      e.preventDefault(); e.stopImmediatePropagation(); consume = true;
      o.select(candidates(e), e.shiftKey || e.ctrlKey || e.metaKey);
    }
    cancel();
  };
  o.svg.addEventListener('pointerdown',down,true); o.svg.addEventListener('pointermove',move,true); o.svg.addEventListener('pointerup',up,true); o.svg.addEventListener('pointercancel',cancel);
  return { cancel, active: () => Boolean(drag?.moved), consumeClick: () => { const result=consume; consume=false; return result; }, dispose: () => { cancel(); o.svg.removeEventListener('pointerdown',down,true); o.svg.removeEventListener('pointermove',move,true); o.svg.removeEventListener('pointerup',up,true); o.svg.removeEventListener('pointercancel',cancel); } };
}
