import { sketchPointRole } from "./point-roles";
import { renderConicManipulators } from './conic-manipulators';
import { renderEllipseManipulators } from './ellipse-manipulators';
import { sketchFaceRegions } from '@aether/core/sketch/reference/connected-sketch-regions';
import { updateSketchEnvironment } from "./environment-appearance";
import { renderGeometryConstraintColors } from "./geometry-constraint-colors";
import {
  contourClosed,
  sketchRegionOrder,
  type SketchDrawing,
  type SketchPoint,
} from "@aether/core/sketch";
import { contourPath } from "./svg-geometry";
import { renderDimensionAnnotations } from "./dimension-annotations";
/** The sketch plane square: half-width in millimetres, centred on the frame
 * origin. Larger than the 110 mm datum planes so it frames them. */
export const SKETCH_PLANE_HALF_MILLIMETRES = 80;
export const SKETCH_GRID_MILLIMETRES = 10;
export function renderSketchCanvas(
  svg: SVGSVGElement,
  drawing: SketchDrawing,
  bounds: { x: number; y: number; width: number; height: number },
  pending: SketchPoint[],
  dimensionPositions: Record<string,SketchPoint> = {},
) {
  const el = (tag: string, attrs: Record<string, string | number>) => {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key, value] of Object.entries(attrs))
      node.setAttribute(key, String(value));
    svg.append(node);
    return node;
  };
  svg.replaceChildren();
  // In the 3D view the viewer sets the viewBox to the part of the plane on screen.
  if (!svg.dataset.surfaceView) svg.setAttribute(
    "viewBox",
    `${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`,
  );
  // The sketch plane is one square: an origin, a size, an area. Everything that
  // describes the plane — face, grid, axes, origin — is drawn inside it, so it
  // reads as a drawn object, not as viewport decoration. It never moves or
  // resizes with pan/zoom; it is the selected plane (or planar face) frame.
  const half = SKETCH_PLANE_HALF_MILLIMETRES;
  el("rect", {
    x: -half,
    y: -half,
    width: half * 2,
    height: half * 2,
    class: "sketch-plane-face",
  });
  const name = svg.dataset.sketchName;
  if (name) {
    const label = el("text", {
      x: -half * 0.96,
      y: -half * 0.9,
      "font-size": 5, // mm, the same as the plane labels
      class: "sketch-plane-title",
    });
    label.textContent = name;
  }
  updateSketchEnvironment(svg);
  // The sketch origin IS the plane frame origin — mark it so the alignment is
  // visible, as Onshape does.
  el("circle", {
    cx: 0,
    cy: 0,
    r: 0.001,
    class: "sketch-origin",
  });
  const regions = drawing.contours
    .map((c, index) => ({ c, index }))
    .filter(({ c }) => !c.construction && contourClosed(c));
  const order = drawing.contours.some((c) => c.hole)
    ? [
        ...sketchRegionOrder(regions.map(({ c }) => c)).map(
          (i) => regions[i].index,
        ),
        ...drawing.contours.flatMap((c, i) =>
          c.construction || !contourClosed(c) ? [i] : [],
        ),
      ]
    : drawing.contours.map((_, i) => i);
  const faces = sketchFaceRegions(drawing);
  const arranged = faces.some(region => region.cell);
  for (const region of faces) {
    if ((region.cell || region.sourceContourIndices.length > 1) && region.contour.type === 'path') el('path', {
      d: [region.contour, ...(region.holes ?? [])].map(contourPath).join(' '), 'data-region-index': region.contourIndex,
      'fill-rule': 'evenodd',
      class: 'closed sketch-region-fill derived-region',
    });
  }
  order.forEach((index) => {
    const c = drawing.contours[index];
    const isPoint = c.type === "path" && !c.segments.length;
    const attrs = {
      "data-contour-index": index,
      ...(arranged && !isPoint ? { style: "fill: none" } : {}),
      class: `sketch-contour ${isPoint ? "point" : contourClosed(c) ? "closed" : "open"}${c.hole ? " hole" : ""}${c.construction ? " construction" : ""}`,
    };
    if (c.type === "circle")
      el("circle", {
        cx: c.center[0],
        cy: -c.center[1],
        r: c.radius,
        ...attrs,
      });
    else if (isPoint)
      el("circle", {
        cx: c.start[0],
        cy: -c.start[1],
        r: 0.001,
        ...attrs,
      });
    else {
      // An infinite line: the segment itself stays pickable; its extension across
      // the whole view is decoration through the same two points.
      if (c.type === "path" && c.infinite && c.segments.length === 1 && c.segments[0].type === "line") {
        const [ax, ay] = c.start, [bx, by] = c.segments[0].end, dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
        if (len > 1e-9) {
          const reach = 2 * Math.hypot(bounds.width, bounds.height) + Math.hypot(ax - bounds.x, ay + bounds.y);
          const ux = dx / len, uy = dy / len;
          el("path", { d: `M ${ax - ux * reach} ${-(ay - uy * reach)} L ${bx + ux * reach} ${-(by + uy * reach)}`, class: "sketch-contour construction infinite-extension", "pointer-events": "none" });
        }
      }
      el("path", { d: contourPath(c), ...attrs });
    }
  });
  for (const [contour, c] of drawing.contours.entries()) {
    const points =
      c.type === "circle"
        ? [c.center]
        : [c.start, ...c.segments.map((s) => s.end)];
    for (const [index, p] of points.entries()) {
      const role = sketchPointRole(drawing, { contour, kind: "point", index }) ?? "Endpoint";
      const node = el("circle", {
        cx: p[0],
        cy: -p[1],
        r: 0.001,
        class: `sketch-vertex${/center/i.test(role) ? " sketch-center-node" : ""}`,
        "data-node-role": role,
        "data-node-contour": contour,
        "data-node-index": index,
      });
      const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
      title.textContent = role; node.append(title);
    }
  }
  for (const [contourIndex, c] of drawing.contours.entries())
    if (c.type === "path") {
      let previous = c.start;
      for (const [segmentIndex, segment] of c.segments.entries()) {
        if (segment.type === 'conic') {
          for (const a of [previous,segment.end]) el('line',{x1:a[0],y1:-a[1],x2:segment.control[0],y2:-segment.control[1],class:'sketch-preview-guide'});
          el('circle',{cx:segment.control[0],cy:-segment.control[1],r:.001,class:'sketch-point sketch-conic-control',
            'data-node-label':`Conic ${contourIndex+1}, tangent control`,'data-node-contour':contourIndex,'data-node-index':segmentIndex,'data-node-control':0});
        }
        if (segment.type === "bezier") {
          for (const [a, b] of [
            [previous, segment.controls[0]],
            [segment.end, segment.controls[1]],
          ])
            el("line", {
              x1: a[0],
              y1: -a[1],
              x2: b[0],
              y2: -b[1],
              class: "sketch-preview-guide",
            });
          for (const [controlIndex, p] of segment.controls.entries())
            el("circle", {
              cx: p[0],
              cy: -p[1],
              r: 0.001,
              class: "sketch-point sketch-spline-control",
              "data-node-label": `Spline ${contourIndex + 1}, span ${segmentIndex + 1}, ${controlIndex === 0 ? "start" : "end"} tangent handle`,
              "data-node-contour": contourIndex,
              "data-node-index": segmentIndex,
              "data-node-control": controlIndex,
            });
        }
        previous = segment.end;
      }
    }
  renderGeometryConstraintColors(svg, drawing);
  renderEllipseManipulators(svg, drawing, bounds.width);
  renderConicManipulators(svg, drawing);
  renderDimensionAnnotations(svg, drawing, bounds.width, dimensionPositions);
  for (const p of pending)
    el("circle", {
      cx: p[0],
      cy: -p[1],
      r: 0.001,
      class: "sketch-point",
    });
}
