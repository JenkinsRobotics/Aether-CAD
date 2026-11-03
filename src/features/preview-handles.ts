import type { ImportedModelData, PreviewHandle } from '@aether/core/contracts';
import { mountExtrusionHandle, type AxisProjection } from './extrude-depth-drag';
import type { Controls } from './shared';

/** Manipulators for every feature the engine publishes handles for (see
 *  PreviewHandle): a linear handle per length or size, an angular ring per angle,
 *  each dragging the dialog's own control so preview, validation and commit keep
 *  one owner. The handles arrive with each preview and move with it. */
export type AngleProjection = { x: number; y: number; points: { x: number; y: number }[]; arc?: { x: number; y: number }[]; tangent?: number; valueAt: (x: number, y: number) => number | null };

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

/** A ring about the handle's axis through its zero point, the swept arc on it and an arrow at the
 *  end of the sweep (Onshape's revolve manipulator); dragging the arrow turns the control's angle by
 *  the pointer's sweep and shows the value while it moves. */
export function mountAngleHandle(panel: HTMLElement, control: HTMLInputElement, unit: string, handle: () => PreviewHandle | undefined, ready: () => boolean, label: string) {
  const viewport = document.querySelector<HTMLElement>('.cad-studio-viewport');
  if (!viewport || !window.requestAnimationFrame) return;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  Object.assign(svg.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', overflow: 'hidden', pointerEvents: 'none', zIndex: '7' }); svg.setAttribute('aria-hidden', 'true');
  const line = (width: string, opacity: string) => { const el = document.createElementNS('http://www.w3.org/2000/svg', 'polyline'); el.setAttribute('fill', 'none'); el.setAttribute('stroke', '#387acb'); el.setAttribute('stroke-width', width); el.setAttribute('stroke-opacity', opacity); el.style.display = 'none'; svg.append(el); return el; };
  const ring = line('1', '0.35'), arc = line('2', '1');
  const button = document.createElement('button'); button.type = 'button'; button.className = 'cad-angle-handle'; button.hidden = true; button.setAttribute('aria-label', label);
  button.title = 'Drag around the axis to turn. Shift for fine adjustment; Escape restores the drag.';
  Object.assign(button.style, { position: 'absolute', zIndex: '8', touchAction: 'none', cursor: 'grab', width: '22px', height: '22px', padding: '0', border: '0', background: 'transparent', color: '#2672b6', display: 'grid', placeItems: 'center' });
  button.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><path d="M3 3 L19 11 L3 19 Z" fill="currentColor" stroke="white" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  const value = document.createElement('span'); value.className = 'cad-angle-handle-value'; value.hidden = true;
  Object.assign(value.style, { position: 'absolute', zIndex: '8', pointerEvents: 'none', transform: 'translate(12px, -50%)', borderRadius: '14px', background: '#2672b6', color: 'white', padding: '2px 8px', fontSize: '12px', whiteSpace: 'nowrap' });
  viewport.append(svg, button, value);
  const factor = Number(control.dataset.canonicalFactor ?? 1);
  const read = () => Number(control.value) * factor;
  let projection: AngleProjection | null = null, frame = 0;
  let drag: { id: number; previous: number; value: number; original: string; projection: AngleProjection } | undefined;
  const set = (degrees: number) => { if (!Number.isFinite(degrees)) return; control.value = String(Number((degrees / factor).toPrecision(8))); control.dispatchEvent(new Event('input')); };
  const update = () => {
    if (!panel.isConnected) { cancel(true); svg.remove(); button.remove(); value.remove(); return; }
    const live = handle(); projection = null;
    if (live && Number.isFinite(read())) window.dispatchEvent(new CustomEvent('aether-native-angle-handle', { detail: { origin: live.originMillimeters, axis: live.direction, angle: read(), start: live.startMillimeters, respond: (p: AngleProjection | null) => { projection = p; } } }));
    // While dragging, the ring stays where the drag began but the arrow follows the live angle.
    const p = drag?.projection ?? projection, live2 = projection ?? p;
    button.hidden = !p; value.hidden = !drag || !p; ring.style.display = p ? '' : 'none'; arc.style.display = p?.arc ? '' : 'none'; button.disabled = !drag && !ready();
    if (p && live2) {
      const rect = viewport.getBoundingClientRect(), at = (q: { x: number; y: number }) => `${q.x - rect.left},${q.y - rect.top}`;
      button.style.left = `${live2.x - rect.left}px`; button.style.top = `${live2.y - rect.top}px`;
      button.style.transform = `translate(-50%, -50%) rotate(${live2.tangent ?? 0}deg)`;
      value.style.left = `${live2.x - rect.left}px`; value.style.top = `${live2.y - rect.top}px`;
      const text = `${label} · ${control.value} ${unit}`; if (value.textContent !== text) value.textContent = text;
      ring.setAttribute('points', p.points.map(at).join(' '));
      if (live2.arc) arc.setAttribute('points', live2.arc.map(at).join(' '));
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
  const observer = new window.MutationObserver(() => { if (!panel.isConnected) { window.cancelAnimationFrame(frame); cancel(true); svg.remove(); button.remove(); value.remove(); observer.disconnect(); } });
  observer.observe(document.body, { childList: true, subtree: true });
  frame = window.requestAnimationFrame(update);
}
