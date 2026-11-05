/** The shared white axis arrows, constrained to the active section's normal. */
import { mountValueManipulator, type ManipulatorOrbit, type ManipulatorPoint } from '@aether/ui';
import { displayQuantity, parseQuantity, unitChoice } from '@aether/core/units';
import { documentUnits } from '../document-preferences';
import type { SectionCut } from './section-view-store';
import { sectionFrame, moveSectionTo, rotateSection } from './section-frame';
import type { TransformHandleProjection } from '../viewport/transform-gizmo';
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
  axisView?: 'toward' | 'away';
  point?: [number, number, number];
  rotations?: (TransformHandleProjection & { id: string; index: number } | null)[];
};
export function mountSectionHandle(viewport: HTMLElement, selected: () => SectionCut | null, change: (offset: number) => void, error: (message: string | null) => void, edit?: (patch: Partial<SectionCut>) => void) {
  const units = documentUnits(), length = unitChoice(units, 'length');
  const element = document.createElement('div');
  element.className = 'cad-section-handle';
  viewport.append(element);
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
    cut: SectionCut;
    kind: string;
    rotation?: NonNullable<NonNullable<SectionProjection['rotations']>[number]>;
    previous?: number;
    angle?: number;
  } | null = null, frame = 0;
  const callbacks: import('@aether/ui').TransformManipulatorOptions = {
    onStart(handle, event) {
      const cut = selected(), projection = project();
      if (!cut || !projection)
        return false;
      const rotation = projection.rotations?.find(ring => ring?.id === handle.id) ?? undefined;
      const at = handle.kind === 'pivot' ? 0 : (rotation ?? projection).valueAt(event.clientX, event.clientY);
      if (at === null)
        return false;
      drag = { projection, grab: at - cut.offsetMillimeters, before: cut.offsetMillimeters, id: cut.id, cut: structuredClone(cut), kind: handle.kind,
        rotation, previous: at, angle: rotation ? cut.rotationDegrees?.[rotation.index] ?? 0 : 0 };
      return true;
    },
    onMove(_handle, event) {
      if (!drag || selected()?.id !== drag.id) return;
      if (drag.kind === 'pivot') {
        window.dispatchEvent(new CustomEvent('aether-section-pivot', { detail: { pointer: event, origin: drag.projection.point ?? sectionFrame(drag.cut).point,
          respond: (pick: { point: [number, number, number] } | null) => { if (pick) edit?.(moveSectionTo(drag!.cut, pick.point)); } } }));
        return;
      }
      if (drag.rotation) {
        const angle = drag.rotation.valueAt(event.clientX, event.clientY);
        if (angle === null) return;
        drag.angle! += ((angle - drag.previous! + 540) % 360) - 180; drag.previous = angle;
        const rotation: [number, number] = [...(drag.cut.rotationDegrees ?? [0, 0])];
        rotation[drag.rotation.index] = event.shiftKey ? Math.round(drag.angle! / 15) * 15 : drag.angle!;
        edit?.(rotateSection(drag.cut, rotation, drag.projection.point)); return;
      }
      const value = drag.projection.valueAt(event.clientX, event.clientY);
      if (value !== null && Number.isFinite(value)) change(value - drag.grab);
    },
    onEnd(_handle, cancelled) {
      const previous = drag;
      drag = null;
      window.dispatchEvent(new CustomEvent('aether-section-drag-end'));
      if (cancelled && previous && selected()?.id === previous.id) {
        change(previous.before); edit?.({ rotationDegrees: previous.cut.rotationDegrees, pivotMillimeters: previous.cut.pivotMillimeters });
      }
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
      if (handle.kind === 'rotation') {
        const angles: [number, number] = [...(cut.rotationDegrees ?? [0, 0])];
        angles[Number(handle.id.slice(-1))] += direction * (event.shiftKey ? 15 : event.altKey ? .1 : 1);
        edit?.(rotateSection(cut, angles, project()?.point)); return;
      }
      const step = length.factor * 1000 * (event.shiftKey ? 10 : event.altKey ? .1 : 1);
      change(cut.offsetMillimeters + direction * (handle.id === 'negative' ? -1 : 1) * step);
    },
  };
  const applyInput = (text: string, report = false): string | undefined => {
    try {
      const value = parseQuantity(text, units, 'length') * 1000;
      change(value); error(null);
    } catch {
      if (report) { const message = `Enter a valid offset in ${length.unit}.`; error(message); return message; }
    }
  };
  const gizmo = mountValueManipulator(element, {
    ...callbacks,
    readoutLabel: `Section offset (${length.unit})`,
    onInput: text => { applyInput(text); },
    onCommit: text => applyInput(text, true),
    onCancelInput: text => { applyInput(text, true); },
  });
  gizmo.element.setAttribute('aria-label', 'Section plane movement');
  const draw = () => {
    frame = requestAnimationFrame(draw);
    const cut = selected(), projection = project();
    element.hidden = !cut || !projection;
    if (!cut || !projection) {
      gizmo.update({ handles: [], orbits: [], guides: [], readout: null });
      return;
    }
    const box = viewport.getBoundingClientRect(), x = projection.start.x - box.left, y = projection.start.y - box.top;
    const handles: import('@aether/ui').ManipulatorHandle[] = edit ? [{ id: 'pivot', kind: 'pivot', label: 'Move section origin; snap to geometry', x, y }] : [];
    const local = (p: ManipulatorPoint) => ({ x: p.x - box.left, y: p.y - box.top });
    const orbits: ManipulatorOrbit[] = edit ? (projection.rotations ?? []).flatMap(ring => {
      const orbit = ring?.orbit;
      return ring && orbit ? [{ id: ring.id, label: `Rotate section plane ${ring.index === 0 ? 'X' : 'Y'}`,
        angle: orbit.angle, points: ring.points.map(local), pointAt: degrees => local(orbit.pointAt(degrees)) }] : [];
    }) : [];
    const guides: ManipulatorPoint[][] = [];
    const dx = projection.end.x - projection.start.x, dy = projection.end.y - projection.start.y, size = Math.hypot(dx, dy);
    if (projection.axisView) {
      guides.push([{ x, y }, { x: x + 40, y }]);
      handles.push({ id: 'positive', kind: 'axis', label: 'Move section in positive normal direction', x: x + 40, y, axisView: projection.axisView });
    } else if (size >= 3) {
      const ux = dx / size, uy = dy / size;
      guides.push([{ x: x - ux * 29, y: y - uy * 29 }, { x: x + ux * 29, y: y + uy * 29 }]);
      const angle = Math.atan2(dy, dx) * 180 / Math.PI + 90;
      handles.push({ id: 'positive', kind: 'axis', label: 'Move section in positive normal direction', x: x + ux * 40, y: y + uy * 40, angle },
        { id: 'negative', kind: 'axis', label: 'Move section in negative normal direction', x: x - ux * 40, y: y - uy * 40, angle: angle + 180 });
    }
    gizmo.update({ handles, orbits, guides, readout: { id: cut.id, x: x - 42, y: y + 28,
      text: `${displayQuantity(cut.offsetMillimeters / 1000, units, 'length')} ${length.unit}` } });
  };
  draw();
  return {
    element,
    dispose() {
      cancelAnimationFrame(frame);
      gizmo.dispose();
      element.remove();
    },
  };
}
