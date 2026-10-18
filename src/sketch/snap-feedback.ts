import type { SketchPoint } from "@aether/core/sketch";
const INFERENCE_GLYPHS: Record<string, string> = {
  Horizontal: "\u2014",
  Vertical: "\u2758",
  Endpoint: "\u25CF",
  Midpoint: "\u25B8",
  Center: "\u2299",
  "Arc center": "\u2299",
  Quadrant: "\u25C6",
  Origin: "\u2A00",
};

/** Show the acquired target even before the first point of a drawing gesture. */
export function renderSnapFeedback(svg: SVGSVGElement, p: SketchPoint, snapLabel: string, width: number) {
  const bounds = {width};
  const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  group.setAttribute("class", "sketch-snap-feedback");
  const add = (tag: string, attrs: Record<string, string | number>) => {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    group.append(node); return node;
  };
  svg.append(group);
  if (snapLabel) {
    const radius = bounds.width / 180;
    if (/midpoint/i.test(snapLabel)) {
      add("rect", { x: p[0] - radius, y: -p[1] - radius, width: radius * 2, height: radius * 2, class: "sketch-snap-target", "aria-label": "Midpoint snap target" });
    } else if (/center|origin/i.test(snapLabel)) {
      add("circle", { cx: p[0], cy: -p[1], r: radius, class: "sketch-snap-target", "aria-label": `${snapLabel} snap target` });
      add("line", { x1: p[0]-radius*1.5, x2: p[0]+radius*1.5, y1: -p[1], y2: -p[1], class: "sketch-snap-target" });
      add("line", { x1: p[0], x2: p[0], y1: -p[1]-radius*1.5, y2: -p[1]+radius*1.5, class: "sketch-snap-target" });
    }
    const glyph = INFERENCE_GLYPHS[snapLabel];
    const size = bounds.width / 60;
    const bx = p[0] + bounds.width / 80;
    const by = -p[1] + bounds.width / 55;
    add("rect", {
      x: bx,
      y: by - size * 0.8,
      width: size,
      height: size,
      rx: size / 6,
      class: "sketch-inference-badge",
    });
    const mark = add("text", {
      x: bx + size / 2,
      y: by + size * 0.08,
      "font-size": size * 0.72,
      "text-anchor": "middle",
      class: "sketch-inference-glyph",
    });
    mark.textContent = glyph ?? snapLabel.slice(0, 1);
    mark.setAttribute("aria-label", snapLabel);
    // Name the relationship without spelling it into the dimension readout:
    // a native SVG tooltip, and the accessible name for the glyph.
    const title = add("title", {});
    title.textContent = snapLabel;
    svg.setAttribute("data-inferred-constraint", snapLabel);
  } else svg.removeAttribute("data-inferred-constraint");
}
