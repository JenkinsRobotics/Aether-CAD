import { dimensionValue, editDrawingDimension, solveDrawingConstraints, type DrawingConstraint, type SketchDrawing, type SketchEntityRef, type SketchPoint } from '@aether/core/sketch';
import { cadCommands } from '../cad-command-registry';
import { pickSelectableSketchEntity } from './projected-picking';
import { bindDimensionInput } from './dimension-input';
import { inferDimension } from './dimension-inference';
import { renderDimensionAnnotations } from './dimension-annotations';
import { refreshDimensionLabelUnits } from './dimension-label-units';
import './dimension-tool.css';
import { referencedConic } from '../../freecad-engine/browser/conic-constraints';

type Options = {
  svg: SVGSVGElement;
  enabled(): boolean;
  drawing(): SketchDrawing;
  point(e: MouseEvent): SketchPoint | null;
  tolerance(): number;
  selected?(): SketchEntityRef[];
  select(refs: SketchEntityRef[]): void;
  report(text: string): void;
  chooseTool(name: string): void;
  commit(drawing: SketchDrawing, id: string, position: SketchPoint): void;
};

/** One dimension command: pick geometry, place its inferred annotation, confirm. */
export function mountDimensionTool(o: Options) {
  let active = false, refs: SketchEntityRef[] = [], panel: HTMLFormElement | undefined;
  let editingId: string | undefined;
  let draftId = crypto.randomUUID(), disposeInput: (() => void) | undefined;
  const clearPreview = () => o.svg.querySelector('.sketch-dimension-preview')?.remove();
  const removePanel = () => { disposeInput?.(); disposeInput = undefined; panel?.remove(); panel = undefined; editingId = undefined; };
  const reset = () => { refs = []; draftId = crypto.randomUUID(); clearPreview(); removePanel(); o.select([]); };
  const cancel = () => {
    active = false; reset(); delete o.svg.dataset.dimensionTool;
    cadCommands.setActive('sketch-constraint-distance', false);
  };
  const begin = () => {
    if (!o.enabled()) return;
    const selected = o.selected?.().slice(0, 2) ?? [];
    o.chooseTool('select'); active = true; refs = selected;
    o.svg.dataset.dimensionTool = 'active'; cadCommands.setActive('sketch-constraint-distance', true);
    o.select(refs); o.report('Select geometry, then click to place its dimension. Esc exits.');
  };
  const preview = (p: SketchPoint) => {
    clearPreview();
    const candidate = inferDimension(o.drawing(), refs, p, draftId);
    if (!candidate) return;
    renderDimensionAnnotations(o.svg, { ...o.drawing(), constraints: [{ ...candidate, reference: true }] }, o.tolerance() * 100, { [draftId]: p });
    const layer = o.svg.lastElementChild;
    layer?.classList.add('sketch-dimension-preview'); layer?.setAttribute('pointer-events', 'none');
    layer?.querySelectorAll<SVGTextElement>('text').forEach(text => { text.dataset.dimensionReference = 'false'; });
    refreshDimensionLabelUnits(o.svg);
    return candidate;
  };
  const enterValue = (candidate: DrawingConstraint, p: SketchPoint, event: MouseEvent) => {
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    const existing = o.drawing().constraints?.find(c => !c.reference &&
      (c.kind === candidate.kind || (['radius', 'diameter'].includes(c.kind) && ['radius', 'diameter'].includes(candidate.kind))) &&
      ((same(c.a, candidate.a) && same(c.b, candidate.b)) ||
        (c.kind === 'conic-rho' && candidate.kind === 'conic-rho' && referencedConic(o.drawing(), c.a) === referencedConic(o.drawing(), candidate.a)) ||
        (candidate.b && same(c.a, candidate.b) && same(c.b, candidate.a))));
    const constraint = existing ?? candidate;
    const current = dimensionValue(o.drawing(), existing ?? { ...candidate, reference: true });
    removePanel();
    const form = document.createElement('form'); form.className = 'cad-sketch-dimension-entry';
    form.setAttribute('role', 'dialog'); form.setAttribute('aria-label', 'Dimension');
    form.style.left = `${Math.max(8, Math.min(event.clientX + 16, window.innerWidth - 236))}px`;
    form.style.top = `${Math.max(8, Math.min(event.clientY + 16, window.innerHeight - 70))}px`;
    const input = document.createElement('input'); input.type = 'text'; input.setAttribute('aria-label', 'Dimension value');
    const unit = document.createElement('span'); unit.className = 'dimension-entry-unit';
    const binding = bindDimensionInput(input, () => constraint.kind, text => { unit.textContent = text; });
    disposeInput = binding.dispose; binding.write(current);
    const apply = document.createElement('button'); apply.type = 'submit'; apply.className = 'dimension-entry-confirm'; apply.textContent = '✓'; apply.setAttribute('aria-label', 'Confirm dimension');
    const close = document.createElement('button'); close.type = 'button'; close.className = 'dimension-entry-cancel'; close.textContent = '×'; close.setAttribute('aria-label', 'Cancel dimension'); close.onclick = reset;
    form.append(input, unit, apply, close); document.body.append(form); panel = form; editingId = constraint.id;
    form.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); reset(); } });
    form.onsubmit = e => {
      e.preventDefault();
      try {
        const value = binding.read();
        if (!(value > 0) || !Number.isFinite(value)) throw Error('Enter a positive dimension.');
        const drawing = o.drawing();
        const next = existing ? editDrawingDimension(drawing, existing.id, value)
          : solveDrawingConstraints({ ...drawing, constraints: [...(drawing.constraints ?? []), { ...candidate, value }] });
        o.commit(next, constraint.id, p); reset();
        o.report('Select geometry for the next dimension. Esc exits.');
      } catch (error) {
        let status = form.querySelector('p'); if (!status) { status = document.createElement('p'); status.setAttribute('role', 'alert'); form.append(status); }
        status.textContent = error instanceof Error ? error.message : String(error);
      }
    };
    input.focus(); input.select();
  };
  const click = (event: MouseEvent) => {
    if (!o.enabled()) return;
    const target = (event.target as Element)?.closest?.('.sketch-dimension:not(.sketch-dimension-preview *)');
    const label = [...o.svg.querySelectorAll('.sketch-dimension-annotations:not(.sketch-dimension-preview) .sketch-dimension text')].find(node => { const r = node.getBoundingClientRect(); return r.width > 0 && event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom; });
    const id = target?.getAttribute('data-constraint-id') ?? label?.parentElement?.getAttribute('data-constraint-id');
    const existing = id ? o.drawing().constraints?.find(c => c.id === id && !c.reference) : undefined;
    if (existing) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (panel && editingId === existing.id) { panel.querySelector('input')?.focus(); return; }
      if (!active) begin();
      refs = [existing.a, ...(existing.b ? [existing.b] : [])]; o.select(refs);
      const text = target?.querySelector('text') ?? label;
      const p: SketchPoint = text ? [Number(text.getAttribute('x')), -Number(text.getAttribute('y'))] : o.point(event) ?? [0,0];
      enterValue(existing, p, event); return;
    }
    if (!active) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (panel) return;
    const p = o.point(event); if (!p) return;
    try {
      const picked = pickSelectableSketchEntity(o.drawing(), p);
      if (picked && picked.d <= o.tolerance() && refs.length < 2 && !refs.some(r => JSON.stringify(r) === JSON.stringify(picked.ref))) {
        refs.push(picked.ref); o.select(refs); preview(p);
        o.report(refs.length === 1 && picked.ref.kind === 'point' ? 'Select another point or line.' : 'Select another item, or click empty space to place the dimension.');
        return;
      }
      const candidate = preview(p);
      if (candidate) enterValue(candidate, p, event);
    } catch (error) { o.report(error instanceof Error ? error.message : String(error)); }
  };
  const move = (event: MouseEvent) => {
    if (!active || panel || !o.enabled()) return;
    const p = o.point(event); if (!p) return;
    try { preview(p); } catch { clearPreview(); }
  };
  o.svg.addEventListener('click', click, true); o.svg.addEventListener('pointermove', move);
  return { begin, cancel, active: () => active, dispose: () => { cancel(); o.svg.removeEventListener('click', click, true); o.svg.removeEventListener('pointermove', move); } };
}
