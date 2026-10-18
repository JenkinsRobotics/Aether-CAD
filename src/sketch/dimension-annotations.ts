import { refreshDimensionLabelUnits } from "./dimension-label-units";
import { referencedConic } from '../../freecad-engine/browser/conic-constraints';
import { conicPoint } from '../../freecad-engine/browser/conic-geometry';
import { referencedContour } from '../../aether-engine/src/sketch/solver/projected-context';
import { resolveSegmentReference } from '../../aether-engine/src/sketch/solver/segment-reference';
import {
  dimensionValue,
  pointLineMeasurement,
  lineLineMeasurement,
  offsetDistanceHandle,
  slotWidthHandle,
  resolve,
  type SketchDrawing,
  type SketchPoint,
} from "@aether/core/sketch";
import { angularDimensionLayout } from "./angular-dimension-layout";
import { updateDimensionLabelLeader } from "./dimension-label-leader";

/** Presentation of solved dimensions. Values and referenced geometry always
 * come from Core; selecting a label opens the existing constraint editor. */
export function renderDimensionAnnotations(
  svg: SVGSVGElement,
  drawing: SketchDrawing,
  viewWidth: number,
  positions: Record<string, SketchPoint> = {},
) {
  const ns = "http://www.w3.org/2000/svg",
    scale = viewWidth / 120;
  const layer = document.createElementNS(ns, "g");
  layer.setAttribute("class", "sketch-dimension-annotations");
  svg.append(layer);
  const arrowID = `sketch-dimension-arrow-${crypto.randomUUID()}`;
  const defs = document.createElementNS(ns, "defs"), marker = document.createElementNS(ns, "marker"), tip = document.createElementNS(ns, "path");
  marker.id = arrowID;
  for (const [key, value] of Object.entries({ viewBox: "0 0 10 10", refX: "10", refY: "5", markerWidth: String(1.4 * scale), markerHeight: String(1.4 * scale), markerUnits: "userSpaceOnUse", orient: "auto-start-reverse" })) marker.setAttribute(key, value);
  tip.setAttribute("d", "M0 0L10 5L0 10Z"); tip.style.fill = "var(--aether-color-text)";
  marker.append(tip); defs.append(marker); layer.append(defs);
  const arrows = (node: SVGElement, both = true) => {
    node.style.markerEnd = `url(#${arrowID})`;
    if (both) node.style.markerStart = `url(#${arrowID})`;
  };
  for (const c of drawing.constraints ?? []) {
    try {
      const a = resolve(drawing, c.kind === 'conic-rho' ? { ...c.a, parameter: .5 } : c.a);
      let p: SketchPoint,
        q: SketchPoint,
        prefix = "";
      const guides: [SketchPoint, SketchPoint][] = [];
      let angular: ReturnType<typeof angularDimensionLayout> | undefined;
      if (c.kind === 'conic-rho') {
        const contour=referencedContour(drawing,c.a),ref=resolveSegmentReference(contour,c.a),s=referencedConic(drawing,c.a);
        if(contour?.type!=='path') continue;
        const start=ref.index===0?contour.start:contour.segments[ref.index!-1].end;
        p=[(start[0]+s.end[0])/2,(start[1]+s.end[1])/2];q=conicPoint(start,s,.5);prefix='ρ ';
      } else if (c.kind === "offset") {
        const handle = offsetDistanceHandle(drawing, c.id);
        if (!handle) continue;
        p = handle.origin;
        q = handle.position;
        prefix = "Offset ";
      } else if (c.kind === "slot") {
        const handle = slotWidthHandle(drawing, c.id);
        if (!handle) continue;
        p = [
          handle.origin[0] - (handle.normal[0] * handle.width) / 2,
          handle.origin[1] - (handle.normal[1] * handle.width) / 2,
        ];
        q = handle.position;
        prefix = "Width ";
      } else if (c.kind === "angle" && c.b && a.line) {
        const b = resolve(drawing, c.b);
        if (!b.line) continue;
        angular = angularDimensionLayout(a.line, b.line, 8 * scale);
        p = angular.start;
        q = angular.end;
        guides.push([angular.center, p], [angular.center, q]);
      } else if (c.kind === "radius" || c.kind === "diameter") {
        if (!a.circle) continue;
        const { center, radius } = a.circle;
        const direction = a.arc
          ? [
              (a.arc.midpoint[0] - center[0]) / radius,
              (a.arc.midpoint[1] - center[1]) / radius,
            ]
          : [Math.SQRT1_2, Math.SQRT1_2];
        p =
          c.kind === "radius"
            ? [...center]
            : [
                center[0] - radius * direction[0],
                center[1] - radius * direction[1],
              ];
        q = [
          center[0] + radius * direction[0],
          center[1] + radius * direction[1],
        ];
        prefix = c.kind === "radius" ? "R " : "Ø ";
      } else if (c.kind === "length" && a.line) [p, q] = a.line;
      else if (
        ["distance", "horizontal-distance", "vertical-distance"].includes(
          c.kind,
        ) &&
        c.b
      ) {
        const b = resolve(drawing, c.b);
        if (a.point && b.point) {
          p = [...a.point];
          q = [...b.point];
        } else if (c.kind === "distance" && a.point && b.line) {
          p = [...a.point];
          q = pointLineMeasurement(p, b.line).foot;
        } else if (c.kind === "distance" && a.line && b.point) {
          p = [...b.point];
          q = pointLineMeasurement(p, a.line).foot;
        } else if (c.kind === "distance" && a.line && b.line) {
          const measurement = lineLineMeasurement(a.line, b.line);
          p = measurement.point;
          q = measurement.foot;
        } else continue;
        if (c.kind === "horizontal-distance") {
          const y = Math.max(p[1], q[1]) + 6 * scale;
          guides.push([[...p], [p[0], y]], [[...q], [q[0], y]]);
          p[1] = y;
          q[1] = y;
          prefix = "X ";
        }
        if (c.kind === "vertical-distance") {
          const x = Math.max(p[0], q[0]) + 6 * scale;
          guides.push([[...p], [x, p[1]]], [[...q], [x, q[1]]]);
          p[0] = x;
          q[0] = x;
          prefix = "Y ";
        }
      } else continue;
      if (c.kind === "length" || c.kind === "distance") {
        const dx = q[0] - p[0],
          dy = q[1] - p[1],
          length = Math.hypot(dx, dy);
        if (length < 1e-10) continue;
        const offset: SketchPoint = [
          (-dy / length) * 6 * scale,
          (dx / length) * 6 * scale,
        ];
        const a: SketchPoint = [p[0] + offset[0], p[1] + offset[1]],
          b: SketchPoint = [q[0] + offset[0], q[1] + offset[1]];
        guides.push([[...p], a], [[...q], b]);
        p = a;
        q = b;
      }
      const value = dimensionValue(drawing, c);
      const group = document.createElementNS(ns, "g");
      group.setAttribute("class", "sketch-dimension");
      group.setAttribute("data-constraint-id", c.id);
      if (angular)
        group.setAttribute(
          "data-curved-dimension",
          JSON.stringify({
            kind: "angle",
            center: angular.center,
            startAngle: angular.startAngle,
            sweep: angular.sweep,
          }),
        );
      else if ((c.kind === "radius" || c.kind === "diameter") && a.circle)
        group.setAttribute(
          "data-curved-dimension",
          JSON.stringify({
            kind: c.kind,
            center: a.circle.center,
            radius: a.circle.radius,
            ...(a.arc
              ? { startAngle: a.arc.startAngle, sweep: a.arc.sweep }
              : {}),
          }),
        );
      if (
        [
          "horizontal-distance",
          "vertical-distance",
          "length",
          "distance",
        ].includes(c.kind)
      ) {
        group.setAttribute(
          "data-dimension-axis",
          c.kind === "horizontal-distance"
            ? "x"
            : c.kind === "vertical-distance"
              ? "y"
              : "aligned",
        );
        group.setAttribute("data-label-gap", String(2 * scale));
      }
      layer.append(group);
      const appendLine = (
        p: SketchPoint,
        q: SketchPoint,
        extension = false,
      ) => {
        const line = document.createElementNS(ns, "line");
        for (const [key, n] of Object.entries({
          x1: p[0],
          y1: -p[1],
          x2: q[0],
          y2: -q[1],
        }))
          line.setAttribute(key, String(n));
        group.append(line);
        line.setAttribute(
          extension ? "data-dimension-extension" : "data-dimension-measure",
          "",
        );
        if (!extension) arrows(line, c.kind !== "radius");
      };
      guides.forEach(([p, q]) => appendLine(p, q, true));
      if (angular) {
        const arc = document.createElementNS(ns, "path");
        arc.setAttribute("d", angular.path);
        arrows(arc);
        group.append(arc);
      } else appendLine(p, q);
      const text = document.createElementNS(ns, "text");
      text.setAttribute(
        "x",
        String(angular ? angular.label[0] : (p[0] + q[0]) / 2),
      );
      text.setAttribute(
        "y",
        String(angular ? -angular.label[1] : -(p[1] + q[1]) / 2 - 2 * scale),
      );
      const position = positions[c.id];
      const guide = angular
        ? [
            angular.center[0] + (angular.label[0] - angular.center[0]) / 1.3,
            angular.center[1] + (angular.label[1] - angular.center[1]) / 1.3,
          ]
        : [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      text.setAttribute("data-guide-x", String(guide[0]));
      text.setAttribute("data-guide-y", String(-guide[1]));
      if (position) {
        text.setAttribute("data-manual-position", "");
        text.setAttribute("x", String(position[0]));
        text.setAttribute("y", String(-position[1]));
      }
      text.setAttribute("font-size", String(2 * scale));
      text.style.fontSize = `${2 * scale}px`;
      text.setAttribute("text-anchor", "middle");
      text.dataset.dimensionValue = String(value);
      text.dataset.dimensionKind = c.kind;
      text.dataset.dimensionPrefix = prefix;
      text.dataset.dimensionLinked = String(!!c.valueFrom);
      text.dataset.dimensionReference = String(!!c.reference);
      if (c.valueExpression) text.dataset.dimensionExpression = c.valueExpression;

      text.setAttribute("role", "button");
      text.setAttribute("tabindex", "0");
      text.setAttribute(
        "aria-label",
        `Edit ${c.kind.replaceAll("-", " ")} ${text.textContent}`,
      );
      const activate = () => {
        const win = svg.ownerDocument.defaultView;
        if (win)
          win.dispatchEvent(
            new win.CustomEvent("aether-sketch-edit-dimension", {
              detail: c.id,
            }),
          );
      };
      text.addEventListener("pointerdown", (e) => e.stopPropagation());
      text.addEventListener("click", (e) => {
        e.stopPropagation();
        activate();
      });
      text.addEventListener("keydown", (e) => {
        const key = (e as KeyboardEvent).key;
        if (key === "Enter" || key === " ") {
          e.preventDefault();
          e.stopPropagation();
          activate();
        }
      });
      group.append(text);
      if (position) updateDimensionLabelLeader(text);
    } catch {
      /* Invalid references remain reported by sketch diagnostics. */
    }
  }
  refreshDimensionLabelUnits(svg);
}
