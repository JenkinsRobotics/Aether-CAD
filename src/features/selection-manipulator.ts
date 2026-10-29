import { mountTransformManipulator } from '@aether/ui';
import type { NumericPartTransform } from '@aether/core/document';
import type { MateViewport } from '../viewer';
import type { Point3, ProjectedManipulatorHandle } from '../viewport/selection-manipulator-math';

/** The owner grants placement of a captured occurrence, never an implicit edit
 * to the feature definition of a selected Part body. */
export interface PlacementSelection {
  key: string;
  revision: string;
  ids: string[];
  current(): boolean;
  apply(transform: NumericPartTransform, signal: AbortSignal): Promise<void>;
}
interface Options {
  viewport: HTMLElement;
  viewer: MateViewport;
  capture(): PlacementSelection | null;
  status(message: string, error?: boolean): void;
}
export function mountSelectionManipulator(options: Options) {
  const { viewer, viewport } = options;
  let pivot: Point3 | null = null, identity = '', busy = false;
  let pending: AbortController | null = null;
  let handles: ProjectedManipulatorHandle[] = [];
  type Drag = {
    handle: ProjectedManipulatorHandle; selected: PlacementSelection; pivot: Point3;
    start: Point3 | number | null; previous: number; angle: number;
    translation: Point3; transform: NumericPartTransform | null; originalPivot: Point3 | null;
  };
  let drag: Drag | null = null;
  const context = () => {
    if (document.querySelector('.cad-feature-dialog,.cad-measure-window,.cad-section-window,.cad-sketch-workspace,[role="dialog"]')) return null;
    const selected = options.capture();
    if (!selected?.current()) return null;
    const frame = viewer.manipulatorFrame(selected.ids);
    return frame ? { selected, frame } : null;
  };
  const end = async (cancelled: boolean) => {
    if (!drag) return;
    const current = drag; drag = null;
    viewer.clearInteractionAnchors();
    delete document.body.dataset.cadHandleDrag;
    if (cancelled || !current.selected.current()) {
      viewer.clearManipulatorPreview(); pivot = current.originalPivot; return;
    }
    if (current.handle.kind === 'pivot' || !current.transform) return;
    const transform = current.transform;
    if (transform.kind === 'translate' && Math.hypot(...transform.translationMillimeters) < 1e-8
      || transform.kind === 'rotate' && Math.abs(transform.angleDegrees) < 1e-8) {
      viewer.clearManipulatorPreview(); return;
    }
    busy = true;
    pending = new AbortController();
    if (transform.kind === 'translate') pivot = current.pivot.map((n, i) => n + transform.translationMillimeters[i]) as Point3;
    // Retain the visible pose until the canonical edit and its viewport upload
    // finish. Releasing the pointer must not snap the model back during a solve.
    viewer.previewManipulatorTransform(current.selected.ids, transform, false);
    try {
      await current.selected.apply(transform, pending.signal);
      viewer.clearManipulatorPreview(false);
      const live = options.capture();
      if (live?.key === current.selected.key) identity = `${live.key}:${live.revision}`;
      options.status('Component placement updated.');
    } catch (error) {
      viewer.clearManipulatorPreview(); pivot = current.originalPivot;
      options.status(error instanceof Error ? error.message : String(error), true);
    } finally { pending = null; busy = false; }
  };
  const widget = mountTransformManipulator(viewport, {
    onStart(handle, event) {
      const capture = context(), projected = handles.find(h => h.id === handle.id);
      if (busy || !capture || !projected) return false;
      const at = pivot ?? capture.frame.centerMillimeters, sample = projected.sample(event.clientX, event.clientY);
      if (handle.kind !== 'pivot' && sample === null) return false;
      drag = { handle: projected, selected: capture.selected, pivot: [...at], start: sample,
        previous: typeof sample === 'number' ? sample : 0, angle: 0, translation: [0, 0, 0], transform: null,
        originalPivot: pivot && [...pivot] };
      document.body.dataset.cadHandleDrag = '1';
    },
    onMove(_handle, event) {
      if (!drag) return;
      if (!drag.selected.current()) { widget.cancel(); return; }
      if (drag.handle.kind === 'pivot') { pivot = viewer.pickManipulatorPivot(event, drag.pivot)?.point ?? pivot; return; }
      const sample = drag.handle.sample(event.clientX, event.clientY); if (sample === null) return;
      if (typeof sample === 'number') {
        const delta = ((sample - drag.previous + 540) % 360) - 180;
        drag.previous = sample; drag.angle += delta * (event.shiftKey ? .1 : 1);
        drag.transform = { kind: 'rotate', axisOriginMillimeters: drag.pivot, axisDirection: drag.handle.axis!, angleDegrees: drag.angle };
      } else if (Array.isArray(drag.start)) {
        const start = drag.start;
        drag.translation = sample.map((n, i) => drag!.translation[i] + (n - start[i]) * (event.shiftKey ? .1 : 1)) as Point3;
        drag.start = sample;
        drag.transform = { kind: 'translate', translationMillimeters: drag.translation };
      }
      if (drag.transform) viewer.previewManipulatorTransform(drag.selected.ids, drag.transform, false);
    },
    onEnd(_handle, cancelled) { void end(cancelled); },
    onKey(handle, event) {
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key) || busy || drag) return;
      const capture = context(), projected = handles.find(h => h.id === handle.id);
      if (!capture || !projected?.axis) return;
      event.preventDefault(); event.stopPropagation();
      const at = pivot ?? capture.frame.centerMillimeters;
      const step = (['ArrowUp', 'ArrowRight'].includes(event.key) ? 1 : -1) * (event.shiftKey ? .1 : 1);
      const transform: NumericPartTransform = handle.kind === 'rotation'
        ? { kind: 'rotate', axisOriginMillimeters: at, axisDirection: projected.axis, angleDegrees: step * 15 }
        : { kind: 'translate', translationMillimeters: projected.axis.map(v => v * step) as Point3 };
      drag = { handle: projected, selected: capture.selected, pivot: at, start: null, previous: 0, angle: 0,
        translation: [0, 0, 0], transform, originalPivot: pivot };
      void end(false);
    },
    onResetPivot() { pivot = null; viewer.clearInteractionAnchors(); },
  });
  widget.element.classList.add('cad-selection-manipulator');
  const place = (event: PointerEvent) => {
    if (!event.shiftKey || event.button !== 0 || !(event.target instanceof HTMLCanvasElement) || busy || drag) return;
    const capture = context(); if (!capture) return;
    const point = viewer.pickManipulatorPivot(event, pivot ?? capture.frame.centerMillimeters); if (!point) return;
    event.preventDefault(); event.stopImmediatePropagation(); pivot = point.point;
    viewer.clearInteractionAnchors();
  };
  viewport.addEventListener('pointerdown', place, true);
  const cancel = () => { widget.cancel(); pending?.abort(); };
  window.addEventListener('cad-document-navigation', cancel);
  window.addEventListener('aether-feature-preview-start', cancel);
  let raf = 0;
  const update = () => {
    const capture = context();
    if (drag && (!capture || !drag.selected.current() || capture.selected.key !== drag.selected.key)) widget.cancel();
    if (!capture && !drag) {
      widget.update([]); handles = [];
      if (!busy) { identity = ''; pivot = null; }
    } else {
      const key = capture?.selected.key ?? identity;
      // A different canonical pose (including undo) recenters the handle. While
      // committing our own preview its pivot stays on the moving occurrence.
      const nextIdentity = `${key}:${capture?.selected.revision ?? ''}`;
      if (nextIdentity !== identity && !drag && !busy) { identity = nextIdentity; pivot = null; }
      const at = pivot ?? drag?.pivot ?? capture!.frame.centerMillimeters;
      const displayed = drag?.transform?.kind === 'translate'
        ? drag.pivot.map((v, i) => v + (drag!.transform as {translationMillimeters: Point3}).translationMillimeters[i]) as Point3 : at;
      handles = viewer.projectSelectionManipulator(displayed);
      widget.update(handles, { disabled: busy });
    }
    raf = requestAnimationFrame(update);
  };
  raf = requestAnimationFrame(update);
  return () => {
    cancel(); cancelAnimationFrame(raf); widget.dispose(); viewer.clearManipulatorPreview(); viewer.clearInteractionAnchors();
    viewport.removeEventListener('pointerdown', place, true);
    window.removeEventListener('cad-document-navigation', cancel);
    window.removeEventListener('aether-feature-preview-start', cancel);
  };
}
