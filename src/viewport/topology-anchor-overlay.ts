import type { Vector3 } from 'three/webgpu';
import { anchorWorldPoint, type AnchorPick } from './topology-anchors';
import './topology-anchor-overlay.css';

/** Screen-sized dots stay legible at any zoom. The canvas owns all picking. */
export class TopologyAnchorOverlay {
  readonly element = document.createElement('div');
  private pick: AnchorPick | null = null;
  private signature = '';
  constructor(container: HTMLElement) {
    this.element.className = 'cad-topology-anchors';
    this.element.setAttribute('aria-hidden', 'true');
    container.append(this.element);
  }
  set(pick: AnchorPick | null): void {
    this.pick = pick;
    const signature = JSON.stringify([pick?.anchors.map(anchor => [anchor.part.data.id, anchor.candidate.id]), pick?.snapped?.candidate.id]);
    if (signature === this.signature) return;
    this.signature = signature;
    this.element.replaceChildren();
    for (const anchor of pick?.anchors ?? []) {
      const dot = document.createElement('span');
      dot.className = 'cad-topology-anchor';
      dot.dataset.kind = anchor.candidate.kind;
      dot.dataset.candidate = anchor.candidate.id;
      const active = anchor.part === pick?.snapped?.part && anchor.candidate.id === pick?.snapped?.candidate.id;
      dot.dataset.active = String(active);
      if (active) {
        const label = document.createElement('span');
        label.className = 'cad-topology-anchor-label'; label.textContent = anchor.candidate.label;
        dot.append(label);
      }
      this.element.append(dot);
    }
  }
  render(project: (world: Vector3) => { x: number; y: number } | null): void {
    this.pick?.anchors.forEach((anchor, index) => {
      const dot = this.element.children[index] as HTMLElement;
      const point = project(anchorWorldPoint(anchor));
      dot.hidden = !point;
      if (point) { dot.style.left = `${point.x}px`; dot.style.top = `${point.y}px`; }
    });
  }
}
