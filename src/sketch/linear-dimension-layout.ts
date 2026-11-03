import { linearDimension, dimensionStyle } from "@aether/core/annotation/dimension-geometry";
/** Relocate a linear dimension from its label: the dimension line passes through the label,
 *  the text sits on the line (past an arrow when dragged outside), and the leader is the run
 *  to an outside label. Source endpoints are render-time attributes, never a second model. */
export function updateLinearDimensionLayout(label: SVGTextElement) {
  const group = label.parentElement, axis = group?.getAttribute("data-dimension-axis") as "x" | "y" | "aligned" | null;
  if (!group || !axis) return;
  const extensions = Array.from(group.querySelectorAll<SVGLineElement>("[data-dimension-extension]"));
  const measure = group.querySelector<SVGLineElement>("[data-dimension-measure]");
  if (extensions.length !== 2 || !measure) return;
  const read = (node: Element, x: string, y: string): [number, number] => [Number(node.getAttribute(x)), -Number(node.getAttribute(y))];
  const a = read(extensions[0], "x1", "y1"), b = read(extensions[1], "x1", "y1");
  const dragged: [number, number] = [Number(label.getAttribute("x")), -Number(label.getAttribute("y"))];
  const g = linearDimension(a, b, dragged, dimensionStyle(Number(group.getAttribute("data-dimension-unit")) || 1, 0), axis);
  const write = (node: Element, p: [number, number], q: [number, number]) => { for (const [key, value] of Object.entries({ x1: p[0], y1: -p[1], x2: q[0], y2: -q[1] })) node.setAttribute(key, String(value)); };
  write(extensions[0], g.extensions[0][0], g.extensions[0][1]);
  write(extensions[1], g.extensions[1][0], g.extensions[1][1]);
  write(measure, g.line[0], g.line[1]);
  label.setAttribute("x", String(g.text.at[0]));
  label.setAttribute("y", String(-g.text.at[1]));
  const guide = g.run ? g.run[0] : g.text.at;
  label.setAttribute("data-guide-x", String(guide[0]));
  label.setAttribute("data-guide-y", String(-guide[1]));
  group.toggleAttribute("data-label-outside", g.outside);
}
