import { createRequire } from "node:module";
import { beforeAll, afterAll, beforeEach, expect, it, vi } from "vitest";
import { renderConstraintMarks, hoverConstraintMark } from "./constraint-marks";
const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom");
let dom, svg;
beforeAll(() => {
  dom = new JSDOM("<body></body>");
  vi.stubGlobal("document", dom.window.document);
});
afterAll(() => { dom.window.close(); vi.unstubAllGlobals(); });
beforeEach(() => {
  document.body.innerHTML = '<svg class="cad-sketch-canvas"></svg>';
  svg = document.querySelector("svg");
});
const line = (x, y, dx = 20, dy = 0) => ({ type: "path", start: [x, y], segments: [{ type: "line", end: [x + dx, y + dy] }] });
const ref = contour => ({ kind: "line", contour, index: 0 });
const bounds = { x: -50, y: -50, width: 100, height: 100 };
const targets = () => [...svg.querySelectorAll("[data-relationship-target]")].map(n => JSON.parse(n.dataset.relationshipTarget));
const center = mark => { const r = mark.querySelector("rect"); return [Number(r.getAttribute("x")) + Number(r.getAttribute("width")) / 2, -Number(r.getAttribute("y")) - Number(r.getAttribute("height")) / 2]; };

it("links both parallel edges on hover/focus, clears hover, and leaves unrelated geometry alone", () => {
  const drawing = { type: "drawing", contours: [line(0, 0), line(0, 20), line(30, 0)], constraints: [{ id: "parallel", kind: "parallel", a: ref(0), b: ref(1) }] };
  const before = JSON.stringify(drawing);
  renderConstraintMarks(svg, drawing, bounds);
  const marks = svg.querySelectorAll('[data-mark-for="parallel"]');
  expect(marks.length).toBe(2);
  expect(hoverConstraintMark(svg, center(marks[0]))).toBe(true);
  expect(targets().map(r => r.contour)).toEqual([0, 1]);
  expect(svg.querySelectorAll(".relationship-active").length).toBe(2);
  hoverConstraintMark(svg, null);
  expect(targets()).toEqual([]);
  marks[1].dispatchEvent(new dom.window.Event("focus"));
  expect(targets().map(r => r.contour)).toEqual([0, 1]);
  marks[1].dispatchEvent(new dom.window.Event("blur"));
  expect(targets()).toEqual([]);
  expect(JSON.stringify(drawing)).toBe(before);
  for (const mark of marks) {
    const box = mark.querySelector("rect"), icon = mark.querySelector("svg");
    expect(mark.querySelector("text")).toBeNull();
    for (const axis of ["x", "y"]) {
      const span = axis === "x" ? "width" : "height";
      expect(Number(box.getAttribute(axis)) + Number(box.getAttribute(span)) / 2).toBeCloseTo(Number(icon.getAttribute(axis)) + Number(icon.getAttribute(span)) / 2);
    }
  }
});

it("shows both symmetry points and the symmetry axis, and keeps colocated badges separate", () => {
  const a = { kind: "point", contour: 0, index: 0 }, b = { kind: "point", contour: 1, index: 0 };
  const drawing = { type: "drawing", contours: [line(-10, 0), line(10, 0), line(0, -20, 0, 40)], constraints: [
    { id: "sym", kind: "symmetric", a, b, axis: ref(2) }, { id: "fixed", kind: "fix", a, point: [-10, 0] },
  ] };
  renderConstraintMarks(svg, drawing, bounds);
  const sym = svg.querySelector('[data-mark-for="sym"]');
  hoverConstraintMark(svg, center(sym));
  expect(targets().map(r => r.contour)).toEqual([0, 1, 2]);
  const fixed = svg.querySelector('[data-mark-for="fixed"]');
  expect(center(fixed)).not.toEqual(center(sym));
  hoverConstraintMark(svg, center(fixed));
  expect(targets()).toEqual([a]);
});

it("highlights stable projected segments after reorder and never guesses a broken reference", () => {
  const projected = { ...line(0, 0), id: "source", segments: [{ type: "line", id: "other", end: [20, 0] }, { type: "line", id: "selected", end: [20, 20] }] };
  const a = { kind: "line", contour: -1, index: 0, projectedContourId: "source", segmentId: "selected" };
  const drawing = { type: "drawing", contours: [], projectionContext: [projected], constraints: [{ id: "v", kind: "vertical", a }] };
  renderConstraintMarks(svg, drawing, bounds);
  hoverConstraintMark(svg, center(svg.querySelector('[data-mark-for="v"]')));
  expect(svg.querySelector('[data-relationship-target]').getAttribute('d')).toBe('M20,0L20,-20');
  a.segmentId = "missing";
  renderConstraintMarks(svg, drawing, bounds);
  expect(svg.querySelector('[data-mark-for="v"]')).toBeNull();
  expect(targets()).toEqual([]);
});

it("merges coincident anchors and highlights circles and curved segments without extending them", () => {
  const a = { kind: "point", contour: 0, index: 0 }, b = { kind: "point", contour: 1, index: 0 };
  const drawing = { type: "drawing", contours: [line(0, 0), line(0, 0, 0, 20), { type: "circle", center: [40, 0], radius: 5 },
    { type: "path", start: [50, 0], segments: [{ type: "arc", middle: [55, 5], end: [60, 0] }] }], constraints: [
    { id: "join", kind: "coincident", a, b }, { id: "equal", kind: "equal", a: { kind: "circle", contour: 2 }, b: { kind: "arc", contour: 3, index: 0 } },
  ] };
  renderConstraintMarks(svg, drawing, bounds);
  expect(svg.querySelectorAll('[data-mark-for="join"]').length).toBe(1);
  hoverConstraintMark(svg, center(svg.querySelector('[data-mark-for="equal"]')));
  expect(targets().map(r => r.kind)).toEqual(["circle", "arc"]);
  expect(svg.querySelector('.sketch-relationship-highlight path').getAttribute('d')).toContain('A');
  expect(svg.querySelector('.sketch-relationship-highlight circle').getAttribute('r')).toBe('5');
});
