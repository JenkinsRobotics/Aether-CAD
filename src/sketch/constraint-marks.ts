import { sketchContourPolyline, type SketchDrawing, type SketchEntityRef, type SketchPoint } from "@aether/core/sketch";
import { relationshipInteraction, type Relationship } from "../relationships/interaction";
import { constraintGeometry, constraintParticipants } from "./constraint-geometry";
import { isDimensionConstraint, sketchConstraintEntry } from "./constraint-catalog";
import { constraintIcon } from "./constraint-icons";
import "./constraint-marks.css";

const ns = "http://www.w3.org/2000/svg";
type Mark = { node: SVGGElement; relation: Relationship<SketchEntityRef>; x: number; y: number; size: number };
const displays = new WeakMap<SVGSVGElement, { marks: Mark[]; hover: (r: Relationship<SketchEntityRef> | null) => void }>();

function badgePosition(anchor: SketchPoint, size: number, marks: Mark[], geometryPoints: SketchPoint[]) {
  // Try nearby positions first; crowded anchors should not create a long
  // vertical column of badges detached from their geometry.
  for (let ring = 0; ; ring++) {
    for (const [dx, dy] of [[1, -1], [-1, -1], [1, 1], [-1, 1], [0, -1], [0, 1], [1, 0], [-1, 0]]) {
      const x = anchor[0] + dx * size * (1.15 + ring * 1.2) - size / 2;
      const y = -anchor[1] + dy * size * (1.15 + ring * 1.2) - size / 2;
      if (geometryPoints.some(p => p[0] >= x - size * .15 && p[0] <= x + size * 1.15 && -p[1] >= y - size * .15 && -p[1] <= y + size * 1.15)) continue;
      if (!marks.some(m => x < m.x + m.size * 1.15 && x + size * 1.15 > m.x && y < m.y + m.size * 1.15 && y + size * 1.15 > m.y)) return { x, y };
    }
  }
}

/** Ray/plane hit-testing also works when the viewer forwards events directly to
 * the SVG instead of its children. No browser-only DOM target assumption. */
export function pickConstraintMark(svg: SVGSVGElement, point: SketchPoint | null): string | undefined {
  return point ? displays.get(svg)?.marks.find(m => m.node.isConnected && point[0] >= m.x && point[0] <= m.x + m.size && -point[1] >= m.y && -point[1] <= m.y + m.size)?.relation.id : undefined;
}

export function hoverConstraintMark(svg: SVGSVGElement, point: SketchPoint | null, focus = false): boolean {
  const display = displays.get(svg);
  if (!display?.marks.some(m => m.node.isConnected)) {
    displays.delete(svg);
    svg.querySelector(".sketch-relationship-highlight")?.remove();
    return false;
  }
  const mark = point && display?.marks.find(m =>
    m.node.isConnected && point[0] >= m.x && point[0] <= m.x + m.size && -point[1] >= m.y && -point[1] <= m.y + m.size);
  display?.hover(mark ? mark.relation : null);
  if (mark && focus) mark.node.focus();
  return !!mark;
}

export function renderConstraintMarks(
  svg: SVGSVGElement,
  drawing: SketchDrawing,
  bounds: { x: number; y: number; width: number; height: number },
  size = bounds.width / 70,
) {
  svg.querySelector(".sketch-constraint-marks")?.remove();
  svg.querySelector(".sketch-relationship-highlight")?.remove();
  const layer = document.createElementNS(ns, "g");
  layer.setAttribute("class", "sketch-constraint-marks");
  svg.append(layer);
  const marks: Mark[] = [];
  const geometryPoints = drawing.contours.flatMap(c => c.type === "circle" ? [c.center, ...sketchContourPolyline(c)] : sketchContourPolyline(c));
  const interaction = relationshipInteraction<SketchEntityRef>(relation => {
    for (const mark of marks) mark.node.classList.toggle("relationship-active", mark.relation.id === relation?.id);
    svg.querySelector(".sketch-relationship-highlight")?.remove();
    if (!relation) return;
    const highlight = document.createElementNS(ns, "g");
    highlight.setAttribute("class", "sketch-relationship-highlight");
    highlight.setAttribute("pointer-events", "none");
    highlight.setAttribute("aria-label", relation.label);
    const seen = new Set<string>();
    for (const ref of relation.participants) {
      const geometry = constraintGeometry(drawing, ref, size * .22);
      if (!geometry) continue;
      const key = JSON.stringify(geometry);
      if (seen.has(key)) continue;
      seen.add(key);
      const node = document.createElementNS(ns, geometry.tag);
      for (const [key, value] of Object.entries(geometry.attrs)) node.setAttribute(key, String(value));
      node.setAttribute("data-relationship-target", JSON.stringify(ref));
      highlight.append(node);
    }
    svg.insertBefore(highlight, layer);
  });
  displays.set(svg, { marks, hover: interaction.hover });
  for (const constraint of drawing.constraints ?? []) {
    if (isDimensionConstraint(constraint.kind)) continue;
    const entry = sketchConstraintEntry(constraint.kind);
    if (!entry) continue;
    const participants = constraintParticipants(constraint);
    const relation = { id: constraint.id, label: `${entry.label} · ${participants.length} related ${participants.length === 1 ? "element" : "elements"}`, participants };
    const anchors: SketchPoint[] = [];
    for (const ref of participants) {
      const geometry = constraintGeometry(drawing, ref, size * .22);
      if (!geometry) continue;
      const anchor = geometry.anchor;
      if (anchors.some(a => Math.hypot(a[0] - anchor[0], a[1] - anchor[1]) < 1e-6)) continue;
      anchors.push(anchor);
      const { x, y } = badgePosition(anchor, size, marks, geometryPoints);
      const group = document.createElementNS(ns, "g");
      group.setAttribute("class", "sketch-constraint-mark");
      group.setAttribute("data-constraint-mark", constraint.kind);
      group.setAttribute("data-mark-for", constraint.id);
      const leader = document.createElementNS(ns, "line");
      leader.setAttribute("class", "constraint-leader");
      for (const [key, value] of Object.entries({ x1: anchor[0], y1: -anchor[1], x2: Math.max(x, Math.min(x + size, anchor[0])), y2: Math.max(y, Math.min(y + size, -anchor[1])) })) leader.setAttribute(key, String(value));
      const box = document.createElementNS(ns, "rect");
      box.setAttribute("class", "constraint-badge-box");
      for (const [key, value] of Object.entries({ x, y, width: size, height: size, rx: size * .08 })) box.setAttribute(key, String(value));
      const icon = constraintIcon(entry.icon, svg.ownerDocument);
      for (const [key, value] of Object.entries({ x: x + size * .12, y: y + size * .12, width: size * .76, height: size * .76 })) icon.setAttribute(key, String(value));
      const title = document.createElementNS(ns, "title"); title.textContent = relation.label;
      group.append(title, leader, box, icon);
      interaction.bind(group, relation);
      // Clicking an annotation must never place a sketch point or start a drag.
      group.addEventListener("pointerdown", e => e.stopPropagation());
      group.addEventListener("click", e => { e.stopPropagation(); group.focus(); });
      layer.append(group);
      marks.push({ node: group, relation, x, y, size });
    }
  }
}

/** Hovering geometry emphasizes its existing markers instead of creating a
 * second floating row disconnected from their actual anchor points. */
export function renderHoveredConstraints(svg: SVGSVGElement, drawing: SketchDrawing, entity: SketchEntityRef | null) {
  const matching = new Set((drawing.constraints ?? []).filter(c => constraintParticipants(c).some(ref => {
    if (!entity) return false;
    if (ref.projectedContourId !== entity.projectedContourId || ref.contour !== entity.contour) return false;
    if (ref.kind === "contour" || entity.kind === "contour") return true;
    if ((ref.kind === "point") !== (entity.kind === "point")) return false;
    return ref.index === entity.index && ref.control === entity.control;
  })).map(c => c.id));
  for (const mark of displays.get(svg)?.marks ?? []) mark.node.classList.toggle("relationship-nearby", matching.has(mark.relation.id));
}
