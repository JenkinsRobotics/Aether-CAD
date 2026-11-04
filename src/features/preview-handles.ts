import type { ImportedModelData, PreviewHandle } from '@aether/core/contracts';
import { mountExtrusionHandle, type AxisProjection } from './extrude-depth-drag';
import type { Controls } from './shared';
import { registerValueHandle, type AngularProjection } from './value-handles';
import { evaluateQuantityExpression } from '@aether/core/units';
let angleSerial = 0;

/** Manipulators for every feature the engine publishes handles for (see
 *  PreviewHandle): a linear handle per length or size, an angular ring per angle,
 *  each dragging the dialog's own control so preview, validation and commit keep
 *  one owner. The handles arrive with each preview and move with it. */
export type AngleProjection = AngularProjection;

export function mountPreviewHandles(panel: HTMLElement, controls: Controls, units: { length: string; angle: string }, map: Record<string, string> = {}, enabled: Record<string, () => boolean> = {}) {
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
  const current = (parameter: string) => enabled[parameter]?.() === false ? undefined : handles.find((h) => h.parameter === parameter);
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
      }, { valueMode: handle.signed ? 'signed' : handle.nonnegative ? 'nonnegative' : 'positive', label: handle.label ?? handle.parameter, ready: () => ready, formatLabel: (value, suffix) => `${handle.label ?? handle.parameter} · ${value} ${suffix}` });
    } else mountAngleHandle(panel, control, units.angle, () => current(handle.parameter), () => ready, handle.label ?? 'Angle');
  };
  panel.addEventListener('aether-feature-preview-state', receive);
  const observer = new window.MutationObserver(() => { if (!panel.isConnected) { panel.removeEventListener('aether-feature-preview-state', receive); observer.disconnect(); } });
  observer.observe(document.body, { childList: true, subtree: true });
}

/** A revolve's angle on the shared manipulator: an orbit ribbon on the ring through the profile,
 *  the swept arc as its guide and the value in the readout. Dragging turns the control by the
 *  pointer's sweep; typing in the readout sets it. */
export function mountAngleHandle(panel: HTMLElement, control: HTMLInputElement, unit: string, handle: () => PreviewHandle | undefined, ready: () => boolean, label: string) {
  const factor = Number(control.dataset.canonicalFactor ?? 1);
  const read = () => Number(control.value) * factor;
  const set = (degrees: number) => { if (!Number.isFinite(degrees)) return; control.value = String(Number((degrees / factor).toPrecision(8))); control.dispatchEvent(new Event('input')); };
  const project = (): AngularProjection | null => {
    const live = handle(); if (!live || !Number.isFinite(read())) return null;
    let projection: AngularProjection | null = null;
    window.dispatchEvent(new CustomEvent('aether-native-angle-handle', { detail: { origin: live.originMillimeters, axis: live.direction, angle: read(), start: live.startMillimeters, screenRadius: live.screenRadius, respond: (p: AngularProjection | null) => { projection = p; } } }));
    return projection ? { ...(projection as AngularProjection), angle: read() } : null;
  };
  let drag: { previous: number; value: number; original: string; projection: AngularProjection } | undefined;
  registerValueHandle({
    id: `${panel.dataset.featureId ?? panel.id ?? 'feature'}:${label}:${++angleSerial}`, kind: 'rotation', label, panel,
    project, ready,
    text: () => `${control.value} ${unit}`,
    begin(event, projection) {
      const p = projection as AngularProjection, value = p.valueAt(event.clientX, event.clientY); if (value === null) return false;
      drag = { previous: value, value: read(), original: control.value, projection: p }; return true;
    },
    move(event) {
      if (!drag) return;
      const value = drag.projection.valueAt(event.clientX, event.clientY); if (value === null) return;
      let delta = value - drag.previous; delta = ((delta + 180) % 360 + 360) % 360 - 180;
      drag.previous = value; drag.value += delta * (event.shiftKey ? 0.1 : 1);
      set(drag.value);
    },
    end(cancelled) {
      if (!drag) return; const previous = drag; drag = undefined;
      if (cancelled) { control.value = previous.original; control.dispatchEvent(new Event('input')); }
      control.dispatchEvent(new Event('change'));
    },
    key(event) {
      if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && ready()) {
        event.preventDefault(); event.stopPropagation();
        const step = handle()?.stepDegrees ?? 15;
        set(read() + (event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? Math.min(step / 10, 1) : step));
        control.dispatchEvent(new Event('change'));
      }
    },
    commit(text) {
      try {
        const value = evaluateQuantityExpression(text, { family: 'angle', factor: factor * Math.PI / 180 });
        if (!text.trim() || !Number.isFinite(value)) throw new Error('Invalid angle');
        set(value * factor); control.dispatchEvent(new Event('change'));
      } catch { return 'Enter a valid angle or expression, such as 90 deg or pi/2 rad.'; }
    },
  });
}
