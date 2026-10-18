import type { DragSnap } from './drag-snapping';
import './drag-feedback.css';

export function showDragFeedback(svg: SVGSVGElement, snap: DragSnap | undefined, scale: number) {
  svg.querySelector('.sketch-drag-guides')?.remove();
  svg.querySelector('.sketch-snap-feedback')?.remove();
  svg.removeAttribute('data-inferred-constraint');
  if (!snap?.guides.length) return;
  const ns = 'http://www.w3.org/2000/svg';
  const group = svg.ownerDocument.createElementNS(ns, 'g');
  group.classList.add('sketch-drag-guides');
  group.setAttribute('pointer-events', 'none');
  for (const guide of snap.guides) {
    const line = svg.ownerDocument.createElementNS(ns, 'line');
    for (const [key, value] of Object.entries({ x1: guide.from[0], y1: -guide.from[1], x2: guide.to[0], y2: -guide.to[1] })) line.setAttribute(key, String(value));
    line.setAttribute('aria-label', `${guide.label} alignment guide`);
    group.append(line);
    const target = svg.ownerDocument.createElementNS(ns, 'circle');
    target.setAttribute('cx', String(guide.from[0])); target.setAttribute('cy', String(-guide.from[1])); target.setAttribute('r', String(scale * 4));
    group.append(target);
    const title = svg.ownerDocument.createElementNS(ns, 'title'); title.textContent = guide.label; group.append(title);
  }
  svg.dataset.inferredConstraint = snap.guides.map(g => g.label).join(' / ');
  svg.append(group);
}
