import { clickSketchControl, querySketchControl, querySketchControls } from "./test-controls";
import { createRequire } from "node:module";
import { beforeAll, afterAll, expect, it, vi } from "vitest";
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
const click = clickSketchControl;
const tool = (name) =>
  window.dispatchEvent(new CustomEvent("aether-sketch-tool", { detail: name }));
const point = (x, y) => {
  querySketchControl('[aria-label="X (mm)"]').value = x;
  querySketchControl('[aria-label="Y (mm)"]').value = y;
  click("Place point");
};
it("previews the construction ellipse then commits and reopens an editable elliptical arc", async () => {
  let doc = createEmptyPartDocument("Elliptical arc");
  const apply = vi.fn(async (next) => {
    doc = next;
  });
  open(() => doc, apply);
  click("Top (XY)");
  tool("elliptical-arc");
  point(0, 0);
  point(5, 0);
  const svg = querySketchControl('[aria-label="2D sketch canvas"]');
  svg.createSVGPoint = () => ({
    x: 0,
    y: 0,
    matrixTransform() {
      return { x: this.x, y: this.y };
    },
  });
  svg.getScreenCTM = () => ({ a: 1, b: 0, inverse: () => ({}) });
  const move = (x, y) =>
    svg.dispatchEvent(
      new dom.window.MouseEvent("pointermove", {
        clientX: x,
        clientY: -y,
        bubbles: true,
      }),
    );
  move(0, 3);
  expect(querySketchControl(".sketch-ellipse-guide")).toBeTruthy();
  expect(querySketchControl(".sketch-contour")).toBeNull();
  point(0, 3);
  move(5, 0);
  const preview = () =>
    querySketchControl(".sketch-preview-layer path:not(.sketch-ellipse-guide)")
      .getAttribute("d");
  const ccw = preview();
  const direction = querySketchControl('[aria-label="Arc direction"]');
  direction.value = "clockwise";
  direction.dispatchEvent(new Event("change"));
  expect(preview()).not.toBe(ccw);
  const expected = preview();
  point(5, 0);
  expect(querySketchControl(".sketch-contour").getAttribute("d")).toBe(
    expected,
  );
  expect(querySketchControl(".sketch-ellipse-guide")).toBeNull();
  click("Undo");
  expect(querySketchControl(".sketch-contour")).toBeNull();
  click("Redo");
  click("Finish sketch");
  await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
  doc = parsePartDocument(serializePartDocument(doc));
  const d = doc.features[0].profile;
  expect(d).not.toHaveProperty("projectionContext");
  expect(d.contours).toHaveLength(2);
  expect(d.contours[0].segments[0]).toMatchObject({
    type: "ellipse",
    radiusX: 5,
    radiusY: 3,
    sweep: false,
    largeArc: false,
  });
  expect(d.constraints.some((c) => c.kind === "concentric")).toBe(true);
  open(() => doc, apply, doc.features[0]);
  expect(querySketchControl(".sketch-contour").getAttribute("d")).toBe(
    expected,
  );
  click("Cancel");
});
