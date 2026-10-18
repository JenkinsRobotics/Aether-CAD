import type { SketchDrawing, SketchPoint } from '@aether/core/sketch';
import { pickConstraintMark } from './constraint-marks';
import './annotation-selection.css';
/** Annotation selection is separate from geometry: Delete never falls through to its owner. */
export function mountAnnotationSelection(o: {
  svg: SVGSVGElement;
  enabled(): boolean;
  drawing(): SketchDrawing;
  point(event: MouseEvent): SketchPoint | null;
  changed(): void;
}) {
  let ids = new Set<string>();
  let press: { x: number; y: number; id: string; moved: boolean } | undefined;
  const hit = (event: MouseEvent) => {
    const target = event.target as Element;
    const direct = target?.closest?.('[data-mark-for], .sketch-dimension[data-constraint-id]');
    if (direct?.closest('.sketch-dimension-preview')) return;
    const mark = direct?.getAttribute('data-mark-for') ?? pickConstraintMark(o.svg, o.point(event));
    if (mark) return mark;
    const label = [...o.svg.querySelectorAll('.sketch-dimension-annotations:not(.sketch-dimension-preview) .sketch-dimension text')].find(node => {
      const r = node.getBoundingClientRect();
      return r.width > 0 && event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom;
    });
    return direct?.getAttribute('data-constraint-id') ?? label?.parentElement?.getAttribute('data-constraint-id') ?? undefined;
  };
  const paint = () => {
    ids = new Set([...ids].filter(id => o.drawing().constraints?.some(c => c.id === id)));
    for (const node of o.svg.querySelectorAll('[data-mark-for], .sketch-dimension[data-constraint-id]')) {
      const selected = ids.has(node.getAttribute('data-mark-for') ?? node.getAttribute('data-constraint-id')!);
      node.classList.toggle('sketch-annotation-selected', selected);
      node.setAttribute('aria-selected', String(selected));
    }
  };
  const select = (id: string, add: boolean) => {
    if (add) { if (ids.has(id)) ids.delete(id); else ids.add(id); }
    else ids = new Set([id]);
    paint(); o.changed();
  };
  const down = (e: PointerEvent) => {
    press = undefined;
    if (e.button !== 0 || !o.enabled()) return;
    const id = hit(e); if (!id) return;
    press = { x: e.clientX, y: e.clientY, id, moved: false };
    select(id, e.shiftKey || e.ctrlKey || e.metaKey);
    // Dimension labels retain their existing drag-to-position interaction.
    if ([...o.svg.querySelectorAll("[data-mark-for]")].some(node => node.getAttribute("data-mark-for") === id)) { e.preventDefault(); e.stopImmediatePropagation(); }
  };
  const move = (e: PointerEvent) => { if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) >= 3) press.moved = true; };
  const click = (e: MouseEvent) => {
    if (!o.enabled()) return;
    if (press?.moved) { press = undefined; return; }
    const selectedOnDown = Boolean(press);
    const id = hit(e) ?? press?.id; press = undefined;
    if (!id) return;
    // A double-click opens the existing dimension editor; single click selects.
    if (e.detail >= 2 && o.drawing().constraints?.some(c => c.id === id && ['radius','diameter','length','distance','horizontal-distance','vertical-distance','angle'].includes(c.kind))) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (!selectedOnDown) select(id, e.shiftKey || e.ctrlKey || e.metaKey);
    o.svg.focus();
  };
  o.svg.addEventListener('pointerdown', down, true);
  o.svg.addEventListener('pointermove', move, true);
  o.svg.addEventListener('click', click, true);
  return { selected: () => [...ids], paint,
    clear: () => { ids.clear(); press = undefined; paint(); },
    dispose() { o.svg.removeEventListener('pointerdown', down, true); o.svg.removeEventListener('pointermove', move, true); o.svg.removeEventListener('click', click, true); },
  };
}
