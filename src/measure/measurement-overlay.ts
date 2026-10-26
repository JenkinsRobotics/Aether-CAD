import type { MeasurePoint } from './measurement-geometry';
type ScreenPoint = { x: number; y: number } | null;
export interface MeasurementAnnotation { points: readonly MeasurePoint[]; label?: string; angle?: boolean }
/** Screen-space labels track world-space picks during orbit, pan and zoom.
 * The owning viewport projects points; no document or renderer state lives here. */
export function mountMeasurementOverlay(viewport: HTMLElement) {
  const svgNS = 'http://www.w3.org/2000/svg';
  const root = document.createElement('div');
  root.className = 'cad-measure-overlay'; root.setAttribute('aria-hidden', 'true');
  const svg = document.createElementNS(svgNS, 'svg');
  const line = document.createElementNS(svgNS, 'polyline');
  const markers = document.createElementNS(svgNS, 'g');
  const label = document.createElement('span'); label.className = 'cad-measure-label';
  svg.append(line, markers); root.append(svg, label); viewport.append(root);
  let annotation: MeasurementAnnotation | null = null, frame = 0;
  const draw = () => {
    frame = requestAnimationFrame(draw);
    root.hidden = !annotation?.points.length;
    if (!annotation?.points.length) return;
    let points: ScreenPoint[] = [];
    window.dispatchEvent(new CustomEvent('aether-measure-project', { detail: {
      points: annotation.points, respond: (projected: ScreenPoint[]) => { points = projected; },
    } }));
    root.hidden = points.length !== annotation.points.length || points.some(point => !point);
    if (root.hidden) return;
    const rect = viewport.getBoundingClientRect();
    const local = points.map(point => ({ x: point!.x - rect.left, y: point!.y - rect.top }));
    line.setAttribute('points', local.map(point => `${point.x},${point.y}`).join(' '));
    markers.replaceChildren(...local.map(point => {
      const circle = document.createElementNS(svgNS, 'circle');
      circle.setAttribute('cx', String(point.x)); circle.setAttribute('cy', String(point.y)); circle.setAttribute('r', '5');
      return circle;
    }));
    const anchor = annotation.angle && local[1] ? local[1] : {
      x: (local[0].x + local[local.length - 1].x) / 2,
      y: (local[0].y + local[local.length - 1].y) / 2,
    };
    label.hidden = !annotation.label;
    label.textContent = annotation.label ?? '';
    label.style.left = `${Math.max(55, Math.min(rect.width - 55, anchor.x))}px`;
    label.style.top = `${Math.max(24, Math.min(rect.height - 24, anchor.y - 18))}px`;
  };
  draw();
  return { set: (next: MeasurementAnnotation | null) => { annotation = next; }, dispose: () => { cancelAnimationFrame(frame); root.remove(); } };
}
