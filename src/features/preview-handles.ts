import type { ImportedModelData, PreviewHandle } from '@aether/core/contracts';
import { mountExtrusionHandle, type AxisProjection } from './extrude-depth-drag';
import type { Controls } from './shared';

/** Manipulators for every feature the engine publishes handles for (see
 *  PreviewHandle): a linear handle per length or size, an angular ring per angle,
 *  each dragging the dialog's own control so preview, validation and commit keep
 *  one owner. The handles arrive with each preview and move with it. */
export type AngleProjection = { x: number; y: number; points: { x: number; y: number }[]; valueAt: (x: number, y: number) => number | null };

export function mountPreviewHandles(panel: HTMLElement, controls: Controls, units: { length: string; angle: string }, map: Record<string, string> = {}) {
  let handles: PreviewHandle[] = [], ready = false;
  const mounted = new Set<string>();
  const receive = (event: Event) => {
    const state = (event as CustomEvent<{ model?: ImportedModelData | null; pending: boolean }>).detail;
    ready = !state.pending;
    if (!state.pending) {
      handles = state.model?.previewFeatureId === panel.dataset.featureId ? state.model?.previewHandles ?? [] : [];
      for (const handle of handles) mount(handle);
    }
  };
  const controlFor = (parameter: string) => controls[map[parameter] ?? parameter] as HTMLInputElement | undefined;
  const current = (parameter: string) => handles.find((h) => h.parameter === parameter);
  const mount = (handle: PreviewHandle) => {
    if (mounted.has(handle.parameter)) return;
    const control = controlFor(handle.parameter);
    if (!control) return;
    mounted.add(handle.parameter);
    if (handle.kind === 'linear') {
      mountExtrusionHandle(panel, { distance: control, reversed: controls.reversed ?? document.createElement('input') }, units.length, (depth, respond) => {
        const live = current(handle.parameter);
        if (!live) return respond(null);
        const scale = live.scale ?? 1;
        window.dispatchEvent(new CustomEvent('aether-native-extrusion-handle', { detail: { origin: live.originMillimeters, direction: live.direction, depth: depth / scale,
          respond: (projection: AxisProjection | null) => respond(projection ? { ...projection, depthAt: (x, y) => { const value = projection.depthAt(x, y); return value === null ? null : value * scale; } } : null) } }));
      }, { valueMode: handle.signed ? 'signed' : 'positive', label: handle.label ?? handle.parameter, ready: () => ready, formatLabel: (value, suffix) => `${handle.label ?? handle.parameter} · ${value} ${suffix}` });
    } else mountAngleHandle(panel, control, units.angle, () => current(handle.parameter), () => ready, handle.label ?? 'Angle');
  };
  panel.addEventListener('aether-feature-preview-state', receive);
  const observer = new window.MutationObserver(() => { if (!panel.isConnected) { panel.removeEventListener('aether-feature-preview-state', receive); observer.disconnect(); } });
  observer.observe(document.body, { childList: true, subtree: true });
}

/** A ring about the handle's axis; dragging turns the control's angle by the pointer's sweep. */
export function mountAngleHandle(panel: HTMLElement, control: HTMLInputElement, unit: string, handle: () => PreviewHandle | undefined, ready: () => boolean, label: string) {
  const viewport = document.querySelector<HTMLElement>('.cad-studio-viewport');
  if (!viewport || !window.requestAnimationFrame) return;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  Object.assign(svg.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', overflow: 'hidden', pointerEvents: 'none', zIndex: '7' }); svg.setAttribute('aria-hidden', 'true');
  const ring = document.createElementNS('http://www.w3.org/2000/svg', 'polyline'); ring.setAttribute('fill', 'none'); ring.setAttribute('stroke', '#387acb'); ring.setAttribute('stroke-width', '2'); ring.style.display = 'none'; svg.append(ring);
  const button = document.createElement('button'); button.type = 'button'; button.className = 'cad-angle-handle'; button.hidden = true; button.setAttribute('aria-label', label);
  button.title = 'Drag around the axis to turn. Shift for fine adjustment; Escape restores the drag.';
  Object.assign(button.style, { position: 'absolute', zIndex: '8', touchAction: 'none', cursor: 'grab', transform: 'translate(-50%, -50%)', border: '1px solid #6ba7e0', borderRadius: '14px', background: '#2672b6', color: 'white', padding: '2px 8px', fontSize: '12px' });
  viewport.append(svg, button);
  const factor = Number(control.dataset.canonicalFactor ?? 1);
  const read = () => Number(control.value) * factor;
  let projection: AngleProjection | null = null, frame = 0;
  let drag: { id: number; previous: number; value: number; original: string; projection: AngleProjection } | undefined;
  const set = (degrees: number) => { if (!Number.isFinite(degrees)) return; control.value = String(Number((degrees / factor).toPrecision(8))); control.dispatchEvent(new Event('input')); };
  const update = () => {
    if (!panel.isConnected) { cancel(true); svg.remove(); button.remove(); return; }
    const live = handle(); projection = null;
    if (live && Number.isFinite(read())) window.dispatchEvent(new CustomEvent('aether-native-angle-handle', { detail: { origin: live.originMillimeters, axis: live.direction, angle: read(), respond: (p: AngleProjection | null) => { projection = p; } } }));
    const p = drag?.projection ?? projection;
    button.hidden = !p; ring.style.display = p ? '' : 'none'; button.disabled = !drag && !ready();
    if (p) {
      const rect = viewport.getBoundingClientRect();
      button.style.left = `${p.x - rect.left}px`; button.style.top = `${p.y - rect.top}px`;
      const text = `${label} · ${control.value} ${unit}`; if (button.textContent !== text) button.textContent = text;
      ring.setAttribute('points', p.points.map((q) => `${q.x - rect.left},${q.y - rect.top}`).join(' '));
    }
    frame = window.requestAnimationFrame(update);
  };
  const cancel = (restore: boolean) => {
    if (!drag) return;
    const previous = drag; drag = undefined; delete document.body.dataset.cadHandleDrag;
    if (restore) { control.value = previous.original; control.dispatchEvent(new Event('input')); }
    if (button.hasPointerCapture(previous.id)) button.releasePointerCapture(previous.id);
    control.dispatchEvent(new Event('change'));
  };
  button.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !projection || !ready()) return;
    const value = projection.valueAt(event.clientX, event.clientY); if (value === null) return;
    event.preventDefault(); event.stopPropagation(); button.focus();
    drag = { id: event.pointerId, previous: value, value: read(), original: control.value, projection }; document.body.dataset.cadHandleDrag = '1';
    button.setPointerCapture(event.pointerId);
  });
  button.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const value = drag.projection.valueAt(event.clientX, event.clientY); if (value === null) return;
    let delta = value - drag.previous; delta = ((delta + 180) % 360 + 360) % 360 - 180;
    drag.previous = value; drag.value += delta * (event.shiftKey ? 0.1 : 1);
    set(drag.value); event.stopPropagation();
  });
  button.addEventListener('pointerup', () => cancel(false));
  button.addEventListener('pointercancel', () => cancel(true));
  button.addEventListener('lostpointercapture', () => cancel(true));
  button.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && drag) { event.preventDefault(); event.stopPropagation(); cancel(true); return; }
    if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && ready()) { event.preventDefault(); event.stopPropagation(); set(read() + (event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? 1 : 15)); control.dispatchEvent(new Event('change')); }
  });
  const observer = new window.MutationObserver(() => { if (!panel.isConnected) { window.cancelAnimationFrame(frame); cancel(true); svg.remove(); button.remove(); observer.disconnect(); } });
  observer.observe(document.body, { childList: true, subtree: true });
  frame = window.requestAnimationFrame(update);
}
