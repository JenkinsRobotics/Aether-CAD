/** Projected rotation affordances. The visible arc, hit target and drag all
 * describe the same world-space orbit; no screen-facing rotation glyph. */
import type { TransformManipulatorOptions, ManipulatorHandle } from '@aether/ui';
import type { TransformHandleProjection } from '../viewport/transform-gizmo';

export type SectionOrbit = TransformHandleProjection & { id: string; index: number };
type Point = { x: number; y: number };
const svgNS = 'http://www.w3.org/2000/svg';

/** A double-ended ribbon following the projected circle, with tangent heads. */
export function orbitArrow(orbit: NonNullable<SectionOrbit['orbit']>): Point[] {
  const speed = Math.hypot(
    orbit.pointAt(orbit.angle + 1).x - orbit.pointAt(orbit.angle - 1).x,
    orbit.pointAt(orbit.angle + 1).y - orbit.pointAt(orbit.angle - 1).y,
  ) / 2;
  const span = Math.min(55, 24 / Math.max(speed, .4));
  const points = Array.from({ length: 25 }, (_, i) => orbit.pointAt(orbit.angle - span + i * span / 12));
  const first = points[0], last = points.at(-1)!;
  const normal = (i: number) => {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    const size = Math.max(Math.hypot(b.x - a.x, b.y - a.y), 1e-6);
    return { x: -(b.y - a.y) / size, y: (b.x - a.x) / size };
  };
  const side = (i: number, width: number) => {
    const n = normal(i), p = points[i];
    return { x: p.x + n.x * width, y: p.y + n.y * width };
  };
  const shaft = Array.from({ length: 17 }, (_, i) => i + 4);
  return [first, side(4, 6), ...shaft.map(i => side(i, 2)), side(20, 6), last,
    side(20, -6), ...shaft.reverse().map(i => side(i, -2)), side(4, -6)];
}

export function mountSectionOrbits(container: HTMLElement, callbacks: TransformManipulatorOptions) {
  const element = document.createElementNS(svgNS, 'svg');
  element.classList.add('cad-section-orbits');
  container.append(element);
  const entries = new Map<string, { group: SVGGElement; hit: SVGPolylineElement; guide: SVGPolylineElement; arrow: SVGPolygonElement }>();
  let current: readonly SectionOrbit[] = [];
  let drag: { handle: ManipulatorHandle; pointer: number; hit: SVGPolylineElement } | null = null;
  const handleFor = (id: string): ManipulatorHandle | undefined => {
    const ring = current.find(ring => ring.id === id);
    return ring && { ...ring, kind: 'rotation', label: `Rotate section ${ring.index ? 'Y' : 'X'}` };
  };
  const finish = (cancelled: boolean) => {
    if (!drag) return;
    const previous = drag; drag = null;
    previous.hit.parentElement?.removeAttribute('data-dragging');
    if (previous.hit.hasPointerCapture?.(previous.pointer)) previous.hit.releasePointerCapture(previous.pointer);
    callbacks.onEnd(previous.handle, cancelled);
  };
  const escape = (event: KeyboardEvent) => {
    if (!drag || event.key !== 'Escape') return;
    event.preventDefault(); event.stopPropagation(); finish(true);
  };
  const blur = () => finish(true);
  window.addEventListener('keydown', escape, true);
  window.addEventListener('blur', blur);
  return {
    update(rings: readonly SectionOrbit[], rect: Pick<DOMRect, 'left' | 'top'>) {
      current = rings;
      if (drag && !rings.some(ring => ring.id === drag!.handle.id)) finish(true);
      for (const ring of rings) {
        let entry = entries.get(ring.id);
        if (!entry) {
          const group = document.createElementNS(svgNS, 'g');
          const guide = document.createElementNS(svgNS, 'polyline'); guide.classList.add('cad-section-orbit-guide');
          const arrow = document.createElementNS(svgNS, 'polygon'); arrow.classList.add('cad-section-orbit-arrow');
          const hit = document.createElementNS(svgNS, 'polyline'); hit.classList.add('cad-section-orbit-hit');
          hit.setAttribute('role', 'button'); hit.setAttribute('tabindex', '0');
          hit.dataset.transformHandle = ring.id;
          hit.setAttribute('aria-label', `Rotate section ${ring.index ? 'Y' : 'X'}`);
          hit.addEventListener('pointerdown', event => {
            if (event.button !== 0 || drag) return;
            const handle = handleFor(ring.id); if (!handle) return;
            event.preventDefault(); event.stopPropagation();
            if (callbacks.onStart(handle, event) === false) return;
            drag = { handle, pointer: event.pointerId, hit };
            group.dataset.dragging = 'true'; hit.focus({ preventScroll: true }); hit.setPointerCapture(event.pointerId);
          });
          hit.addEventListener('pointermove', event => {
            if (drag?.hit !== hit || drag.pointer !== event.pointerId) return;
            event.stopPropagation(); callbacks.onMove(drag.handle, event);
          });
          hit.addEventListener('pointerup', event => {
            if (drag?.hit !== hit || drag.pointer !== event.pointerId) return;
            event.stopPropagation(); finish(false);
          });
          hit.addEventListener('pointercancel', () => finish(true));
          hit.addEventListener('lostpointercapture', () => finish(true));
          hit.addEventListener('keydown', event => { const handle = handleFor(ring.id); if (handle) callbacks.onKey?.(handle, event); });
          group.append(guide, arrow, hit); element.append(group);
          entry = { group, guide, arrow, hit }; entries.set(ring.id, entry);
        }
        const points = (values: Point[]) => values.map(p => `${p.x - rect.left},${p.y - rect.top}`).join(' ');
        const line = points(ring.points);
        entry.guide.setAttribute('points', line); entry.hit.setAttribute('points', line);
        entry.arrow.setAttribute('points', ring.orbit ? points(orbitArrow(ring.orbit)) : '');
        entry.group.style.display = '';
      }
      for (const [id, entry] of entries) if (!rings.some(ring => ring.id === id)) entry.group.style.display = 'none';
    },
    dispose() {
      finish(true); window.removeEventListener('keydown', escape, true); window.removeEventListener('blur', blur); element.remove();
    },
  };
}
