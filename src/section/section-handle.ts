/** The shared white axis arrows, constrained to the active section's normal. */
import { mountTransformManipulator } from '@aether/ui';
import { displayQuantity, parseQuantity, unitChoice } from '@aether/core/units';
import { documentUnits } from '../document-preferences';
import type { SectionCut } from './section-view-store';
export type SectionProjection = {
  start: {
    x: number;
    y: number;
  };
  end: {
    x: number;
    y: number;
  };
  valueAt: (x: number, y: number) => number | null;
};
export function mountSectionHandle(viewport: HTMLElement, selected: () => SectionCut | null, change: (offset: number) => void, error: (message: string | null) => void) {
  const units = documentUnits(), length = unitChoice(units, 'length');
  const element = document.createElement('div');
  element.className = 'cad-section-handle';
  viewport.append(element);
  const guide = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  guide.setAttribute('aria-hidden', 'true');
  const line = document.createElementNS(guide.namespaceURI, 'line');
  guide.append(line);
  element.append(guide);
  const input = document.createElement('input');
  input.setAttribute('aria-label', `Section offset (${length.unit})`);
  input.inputMode = 'decimal';
  element.append(input);
  const project = (): SectionProjection | null => {
    let value: SectionProjection | null = null;
    const view = selected();
    if (view) {
      window.dispatchEvent(new CustomEvent('aether-section-handle', {
        detail: { view, respond: (projection: SectionProjection | null) => { value = projection; } },
      }));
    }
    return value;
  };
  let drag: {
    projection: SectionProjection;
    grab: number;
    before: number;
    id: string;
  } | null = null, frame = 0;
  const gizmo = mountTransformManipulator(element, {
    onStart(_handle, event) {
      const cut = selected(), projection = project();
      if (!cut || !projection)
        return false;
      const at = projection.valueAt(event.clientX, event.clientY);
      if (at === null)
        return false;
      drag = { projection, grab: at - cut.offsetMillimeters, before: cut.offsetMillimeters, id: cut.id };
      return true;
    },
    onMove(_handle, event) {
      if (!drag || selected()?.id !== drag.id) return;
      const value = drag.projection.valueAt(event.clientX, event.clientY);
      if (value !== null && Number.isFinite(value)) change(value - drag.grab);
    },
    onEnd(_handle, cancelled) {
      const previous = drag;
      drag = null;
      if (cancelled && previous && selected()?.id === previous.id) change(previous.before);
    },
    onKey(handle, event) {
      if (!['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(event.key))
        return;
      event.preventDefault();
      event.stopPropagation();
      const cut = selected();
      if (!cut)
        return;
      const direction = ['ArrowUp', 'ArrowRight'].includes(event.key) ? 1 : -1;
      const step = length.factor * 1000 * (event.shiftKey ? 10 : event.altKey ? .1 : 1);
      change(cut.offsetMillimeters + direction * (handle.id === 'negative' ? -1 : 1) * step);
    },
  });
  gizmo.element.setAttribute('aria-label', 'Section plane movement');
  const applyInput = (report = false) => {
    try {
      const value = parseQuantity(input.value.replace(new RegExp(`\\s*${length.unit}$`), ''), units, 'length') * 1000;
      if (!input.value.trim() || !Number.isFinite(value))
        throw Error();
      change(value);
      error(null);
    }
    catch {
      if (report)
        error(`Enter a valid offset in ${length.unit}.`);
    }
  };
  input.addEventListener('input', () => applyInput());
  input.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    event.stopPropagation();
    applyInput(true);
    input.blur();
  });
  input.addEventListener('blur', () => applyInput(true));
  const draw = () => {
    frame = requestAnimationFrame(draw);
    const cut = selected(), projection = project();
    element.hidden = !cut || !projection;
    if (!cut || !projection) {
      gizmo.update([]);
      return;
    }
    const box = viewport.getBoundingClientRect(), x = projection.start.x - box.left, y = projection.start.y - box.top;
    const dx = projection.end.x - projection.start.x, dy = projection.end.y - projection.start.y, size = Math.hypot(dx, dy);
    if (size < 3) {
      gizmo.update([]);
      line.setAttribute('visibility', 'hidden');
    }
    else {
      line.removeAttribute('visibility');
      const ux = dx / size, uy = dy / size;
      for (const [key, value] of Object.entries({ x1: x - ux * 29, y1: y - uy * 29, x2: x + ux * 29, y2: y + uy * 29 }))
        line.setAttribute(key, String(value));
      const angle = Math.atan2(dy, dx) * 180 / Math.PI + 90;
      gizmo.update([{ id: 'positive', kind: 'axis', label: 'Move section in positive normal direction', x: x + ux * 40, y: y + uy * 40, angle },
        { id: 'negative', kind: 'axis', label: 'Move section in negative normal direction', x: x - ux * 40, y: y - uy * 40, angle: angle + 180 }]);
    }
    input.style.transform = `translate(${x - 42}px,${y + 28}px)`;
    if (document.activeElement !== input)
      input.value = `${displayQuantity(cut.offsetMillimeters / 1000, units, 'length')} ${length.unit}`;
  };
  draw();
  return {
    dispose() {
      cancelAnimationFrame(frame);
      gizmo.dispose();
      element.remove();
    },
  };
}
