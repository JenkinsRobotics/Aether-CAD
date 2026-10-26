import { Vector3 } from 'three';
import type { MeasurePoint } from './measurement-geometry';
type ScreenPoint = {
    x: number;
    y: number;
} | null;
export interface MeasurementAnnotation {
    points: readonly MeasurePoint[];
    label?: string;
    angle?: boolean;
    axis?: 0 | 1 | 2;
}
/** The angle arc is constructed in the measured plane, then projected with its arms. */
export function angleArc(points: readonly MeasurePoint[]): MeasurePoint[] {
    if (points.length !== 3)
        return [];
    const center = new Vector3(...points[1]), a = new Vector3(...points[0]).sub(center), b = new Vector3(...points[2]).sub(center);
    const radius = Math.min(a.length(), b.length()) * .24;
    if (radius < 1e-9)
        return [];
    const angle = a.angleTo(b);
    a.normalize();
    b.normalize();
    let normal = a.clone().cross(b).normalize();
    if (normal.length() < 1e-8) {
        const seed = Math.abs(a.z) < .9 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0);
        normal = a.clone().cross(seed).normalize();
    }
    return Array.from({ length: 33 }, (_, i) => a.clone().applyAxisAngle(normal, angle * i / 32).multiplyScalar(radius).add(center).toArray());
}
/** Screen-space annotation labels follow the live world points through orbit and zoom. */
export function mountMeasurementOverlay(viewport: HTMLElement) {
    const ns = 'http://www.w3.org/2000/svg', root = document.createElement('div');
    root.className = 'cad-measure-overlay';
    root.setAttribute('aria-hidden', 'true');
    viewport.append(root);
    const svg = document.createElementNS(ns, 'svg');
    root.append(svg);
    const nodes: {
        group: SVGGElement;
        line: SVGPolylineElement;
        arc: SVGPolylineElement;
        markers: SVGGElement;
        label: HTMLSpanElement;
    }[] = [];
    let annotations: readonly MeasurementAnnotation[] = [], frame = 0;
    const draw = () => {
        frame = requestAnimationFrame(draw);
        root.hidden = !annotations.length;
        if (!annotations.length)
            return;
        const rect = viewport.getBoundingClientRect();
        annotations.forEach((annotation, index) => {
            let node = nodes[index];
            if (!node) {
                const group = document.createElementNS(ns, 'g'), line = document.createElementNS(ns, 'polyline'), arc = document.createElementNS(ns, 'polyline'), markers = document.createElementNS(ns, 'g'), label = document.createElement('span');
                arc.classList.add('cad-measure-arc');
                label.className = 'cad-measure-label';
                group.append(line, arc, markers);
                svg.append(group);
                root.append(label);
                node = { group, line, arc, markers, label };
                nodes.push(node);
            }
            const arc = annotation.angle ? angleArc(annotation.points) : [], world = [...annotation.points, ...arc];
            let points: ScreenPoint[] = [];
            window.dispatchEvent(new CustomEvent('aether-measure-project', { detail: { points: world, respond: (value: ScreenPoint[]) => { points = value; } } }));
            const hidden = points.length !== world.length || points.some(point => !point);
            node.group.style.display = hidden ? 'none' : '';
            node.label.hidden = hidden || !annotation.label;
            if (hidden)
                return;
            node.group.dataset.axis = annotation.axis === undefined ? '' : String(annotation.axis);
            const local = points.map(point => ({ x: point!.x - rect.left, y: point!.y - rect.top })), arms = local.slice(0, annotation.points.length), curved = local.slice(annotation.points.length);
            node.line.setAttribute('points', arms.map(p => `${p.x},${p.y}`).join(' '));
            node.arc.setAttribute('points', curved.map(p => `${p.x},${p.y}`).join(' '));
            while (node.markers.childElementCount < arms.length) {
                const circle = document.createElementNS(ns, 'circle');
                circle.setAttribute('r', '4');
                node.markers.append(circle);
            }
            [...node.markers.children].forEach((circle, i) => { circle.setAttribute('visibility', arms[i] ? 'visible' : 'hidden'); if (arms[i]) {
                circle.setAttribute('cx', String(arms[i].x));
                circle.setAttribute('cy', String(arms[i].y));
            } });
            const anchor = curved.length ? curved[Math.floor(curved.length / 2)] : { x: (arms[0].x + arms.at(-1)!.x) / 2, y: (arms[0].y + arms.at(-1)!.y) / 2 };
            node.label.textContent = annotation.label ?? '';
            node.label.style.left = `${Math.max(55, Math.min(rect.width - 55, anchor.x))}px`;
            node.label.style.top = `${Math.max(24, Math.min(rect.height - 24, anchor.y - 18 - index * 3))}px`;
        });
        for (let i = annotations.length; i < nodes.length; i++) {
            nodes[i].group.style.display = 'none';
            nodes[i].label.hidden = true;
        }
    };
    draw();
    return { set: (next: MeasurementAnnotation | readonly MeasurementAnnotation[] | null) => { annotations = next ? Array.isArray(next) ? next : [next as MeasurementAnnotation] : []; }, dispose: () => { cancelAnimationFrame(frame); root.remove(); } };
}
