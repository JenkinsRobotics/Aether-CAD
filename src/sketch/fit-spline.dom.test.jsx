import { clickSketchControl, querySketchControl, querySketchControls } from "./test-controls";
import { createRequire } from "node:module";
import { beforeAll, afterAll, afterEach, expect, it, vi } from "vitest";
import {
  createEmptyPartDocument,
  parsePartDocument,
  serializePartDocument,
} from "@aether/core/document";
const require = createRequire(
  import.meta.url,
);
const { JSDOM } = require("jsdom");
let dom, open;
beforeAll(async () => {
  dom = new JSDOM('<div class="cad-studio-viewport"></div>', {
    url: "http://localhost/cad/",
  });
  for (const key of [
    "window",
    "document",
    "HTMLElement",
    "CustomEvent",
    "Event",
    "location",
  ])
    vi.stubGlobal(key, dom.window[key]);
  open = (await import("../sketch-workspace")).openSketchWorkspace;
});
afterAll(() => {
  dom.window.close();
  vi.unstubAllGlobals();
});
afterEach(() => { if (querySketchControl('.cad-sketch-workspace')) clickSketchControl('Cancel'); });
const click = clickSketchControl;
const tool = () =>
  window.dispatchEvent(
    new CustomEvent("aether-sketch-tool", { detail: "fit-spline" }),
  );
const point = (x, y) => {
  querySketchControl('[aria-label="X (mm)"]').value = x;
  querySketchControl('[aria-label="Y (mm)"]').value = y;
  click("Place point");
};
it("keeps a live curve between clicks, finishes once, undoes and reopens native curves", async () => {
  let doc = createEmptyPartDocument("Fit spline");
  const apply = vi.fn(async (next) => {
    doc = next;
  });
  open(() => doc, apply);
  click("Top (XY)");
  tool();
  point(0, 0);
  point(10, 8);
  point(20, 0);
  expect(
    querySketchControl(".sketch-preview-layer").getAttribute("d"),
  ).toContain("C");
  expect(querySketchControls(".sketch-contour")).toHaveLength(0);
  const canvas = querySketchControl(".cad-sketch-workspace svg");
  canvas.createSVGPoint = () => ({
    x: 0,
    y: 0,
    matrixTransform() {
      return { x: this.x, y: this.y };
    },
  });
  canvas.getScreenCTM = () => ({ inverse: () => ({}) });
  const beforePreview = querySketchControl(".sketch-preview-layer")
    .getAttribute("d");
  canvas.dispatchEvent(
    new dom.window.MouseEvent("pointermove", {
      clientX: 30,
      clientY: -10,
      bubbles: true,
    }),
  );
  expect(
    querySketchControl(".sketch-preview-layer").getAttribute("d"),
  ).not.toBe(beforePreview);
  click("Finish sketch");
  expect(apply).not.toHaveBeenCalled();
  expect(querySketchControl(".cad-sketch-workspace").textContent).toContain(
    "Finish spline or cancel",
  );
  click("Finish spline");
  expect(querySketchControls(".sketch-contour")).toHaveLength(1);
  click("Undo");
  expect(querySketchControls(".sketch-contour")).toHaveLength(0);
  click("Redo");
  click("Finish sketch");
  await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
  const saved = parsePartDocument(serializePartDocument(doc));
  expect(
    saved.features[0].profile.constraints.some(
      (c) => c.kind === "spline-shape",
    ),
  ).toBe(true);
  expect(saved.features[0].profile.contours[0].segments).toHaveLength(2);
  open(() => saved, apply, saved.features[0]);
  tool();
  point(30, 0);
  point(40, 5);
  const svg = querySketchControl(".cad-sketch-workspace svg");
  svg.dispatchEvent(
    new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  expect(querySketchControls(".sketch-contour")).toHaveLength(1);
  tool();
  point(30, 0);
  point(40, 5);
  svg.dispatchEvent(
    new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
  );
  expect(querySketchControls(".sketch-contour")).toHaveLength(2);
  click("Cancel");
});

it("previews closure at the start point and commits a periodic native loop", async () => {
  let doc = createEmptyPartDocument("Closed spline");
  const apply = vi.fn(async (next) => {
    doc = next;
  });
  open(() => doc, apply);
  click("Top (XY)");
  tool();
  point(0, 0);
  point(10, 0);
  point(10, 10);
  point(0, 10);
  const svg = querySketchControl(".cad-sketch-workspace svg");
  svg.createSVGPoint = () => ({
    x: 0,
    y: 0,
    matrixTransform() {
      return { x: this.x, y: this.y };
    },
  });
  svg.getScreenCTM = () => ({ inverse: () => ({}) });
  svg.dispatchEvent(
    new dom.window.MouseEvent("pointermove", {
      clientX: 0,
      clientY: 0,
      bubbles: true,
    }),
  );
  const preview = querySketchControl(".sketch-preview-layer")
    .getAttribute("d");
  expect(preview.match(/C/g) || []).toHaveLength(4);
  point(0, 0);
  expect(querySketchControls(".sketch-contour.closed")).toHaveLength(1);
  click("Undo");
  expect(querySketchControls(".sketch-contour")).toHaveLength(0);
  click("Redo");
  point(30, 0);
  point(40, 0);
  point(35, 10);
  click("Close spline");
  expect(querySketchControls(".sketch-contour.closed")).toHaveLength(2);
  click("Finish sketch");
  await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
  const saved = parsePartDocument(serializePartDocument(doc));
  expect(
    saved.features[0].profile.constraints.some(
      (c) => c.kind === "spline-shape",
    ),
  ).toBe(true);
  for (const c of saved.features[0].profile.contours)
    expect(c.segments.at(-1).end).toEqual(c.start);
});

function canvasWithCoordinates() {
  const svg = querySketchControl('.cad-sketch-workspace svg');
  svg.createSVGPoint = () => ({ x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } });
  svg.getScreenCTM = () => ({ inverse: () => ({}) });
  return svg;
}
const mouse = (svg, name, x, y, detail = 1) => svg.dispatchEvent(new dom.window.MouseEvent(name, {
  clientX: x, clientY: -y, button: 0, detail, bubbles: true, cancelable: true,
}));
const key = (svg, value, extra = {}) => svg.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
  key: value, bubbles: true, cancelable: true, ...extra,
}));

it('double-click finishes at the final clicked point exactly once and keeps the tool ready', async () => {
  let doc = createEmptyPartDocument('Double-click spline');
  const apply = vi.fn(async next => { doc = next; });
  open(() => doc, apply); click('Top (XY)'); tool();
  expect(document.querySelector('.cad-sketch-tool-window')).toBeNull();
  const svg = canvasWithCoordinates();
  mouse(svg, 'click', 10, 10); mouse(svg, 'click', 30, 30);
  mouse(svg, 'click', 50, 10); mouse(svg, 'click', 50, 10, 2); mouse(svg, 'dblclick', 50, 10, 2);
  expect(querySketchControls('.sketch-contour')).toHaveLength(1);
  expect(querySketchControl('.sketch-preview-layer')).toBeNull();
  expect(querySketchControls('.sketch-spline-control')).toHaveLength(4);
  expect(document.querySelector('[aria-label^="Spline 1, span 1, start tangent handle:"]')).toBeTruthy();
  click('Undo'); expect(querySketchControls('.sketch-contour')).toHaveLength(0);
  click('Redo'); expect(querySketchControls('.sketch-contour')).toHaveLength(1);
  // A new unfinished curve can be canceled without deleting the saved one.
  mouse(svg, 'click', 70, 10); key(svg, 'Escape');
  click('Finish sketch'); await vi.waitFor(() => expect(apply).toHaveBeenCalledOnce());
  const drawing = parsePartDocument(serializePartDocument(doc)).features[0].profile;
  expect(drawing.contours[0].segments).toHaveLength(2);
  expect(drawing.contours[0].segments.at(-1).end).toEqual([50, 10]);
});

it('double-click closure creates one periodic curve without starting a phantom next curve', async () => {
  let doc = createEmptyPartDocument('Periodic double-click');
  const apply = vi.fn(async next => { doc = next; });
  open(() => doc, apply); click('Top (XY)'); tool();
  const svg = canvasWithCoordinates();
  for (const [x, y] of [[10,10], [30,10], [30,30], [10,30]]) mouse(svg, 'click', x, y);
  mouse(svg, 'click', 10, 10); mouse(svg, 'click', 10, 10, 2); mouse(svg, 'dblclick', 10, 10, 2);
  expect(querySketchControls('.sketch-contour.closed')).toHaveLength(1);
  click('Finish sketch'); await vi.waitFor(() => expect(apply).toHaveBeenCalledOnce());
  expect(doc.features[0].profile.contours[0].segments).toHaveLength(4);
});

it('Backspace and undo/redo edit pending points before touching committed geometry', async () => {
  const doc = createEmptyPartDocument('Pending undo');
  open(() => doc, vi.fn()); click('Top (XY)'); tool();
  point(0, 0); point(20, 10); click('Finish spline');
  const svg = canvasWithCoordinates();
  point(40, 0); point(60, 20); point(80, 0);
  key(svg, 'Backspace');
  key(svg, 'z', { ctrlKey: true });
  expect(querySketchControls('.sketch-contour')).toHaveLength(1);
  expect([...querySketchControls('button')].find(b => b.textContent === 'Finish spline').disabled).toBe(true);
  key(svg, 'z', { ctrlKey: true, shiftKey: true });
  expect([...querySketchControls('button')].find(b => b.textContent === 'Finish spline').disabled).toBe(false);
  click('Remove last spline point'); click('Remove last spline point');
  expect(querySketchControls('.sketch-contour')).toHaveLength(1);
  click('Redo'); click('Redo');
  // A different point invalidates the abandoned pending branch.
  point(75, 30); click('Redo'); click('Finish spline');
  expect(querySketchControls('.sketch-contour')).toHaveLength(2);
  click('Undo'); expect(querySketchControls('.sketch-contour')).toHaveLength(1);
  click('Cancel');
});

it('Enter in coordinate fields stays local and a too-short spline is retained for correction', () => {
  const doc = createEmptyPartDocument('Input focus');
  open(() => doc, vi.fn()); click('Top (XY)'); tool(); point(10, 10);
  const svg = canvasWithCoordinates();
  key(svg, 'Enter');
  expect(querySketchControls('.sketch-contour')).toHaveLength(0);
  point(20, 20);
  const input = querySketchControl('[aria-label="X (mm)"]');
  key(input, 'Enter');
  expect(querySketchControls('.sketch-contour')).toHaveLength(0);
  key(svg, 'Enter'); expect(querySketchControls('.sketch-contour')).toHaveLength(1);
  click('Cancel');
});
