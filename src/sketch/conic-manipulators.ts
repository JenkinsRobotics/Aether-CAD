import type { SketchDrawing } from '@aether/core/sketch';
import { conicHandles } from '../../freecad-engine/browser/conic-manipulation';

export function renderConicManipulators(svg: SVGSVGElement, drawing: SketchDrawing) {
  const ns = 'http://www.w3.org/2000/svg';
  for (const h of conicHandles(drawing)) {
    const guide = document.createElementNS(ns, 'line');
    for (const [key, value] of Object.entries({ x1: h.midpoint[0], y1: -h.midpoint[1], x2: h.control[0], y2: -h.control[1] })) guide.setAttribute(key, String(value));
    guide.setAttribute('class', 'sketch-preview-guide sketch-conic-guide');
    const node = document.createElementNS(ns, 'circle');
    node.setAttribute('cx', String(h.point[0])); node.setAttribute('cy', String(-h.point[1])); node.setAttribute('r', '.001');
    node.setAttribute('class', 'sketch-point sketch-conic-rho-control');
    node.dataset.conicHandle = 'rho'; node.dataset.conicContour = String(h.ref.contour); node.dataset.conicSegment = String(h.ref.index);
    node.setAttribute('aria-label', h.label);
    const state = svg.querySelector(`[data-entity-contour="${h.ref.contour}"][data-entity-segment="${h.ref.index}"]`)?.getAttribute('data-entity-constraint-state');
    if (state) node.setAttribute('data-entity-constraint-state', state);
    const title = document.createElementNS(ns, 'title'); title.textContent = h.label; node.append(title);
    svg.append(guide, node);
  }
}
