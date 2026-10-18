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
it("evaluates a fractional radius in inches, rejects bad arithmetic, and persists the driver", async () => {
  const { applyDocumentUnits } = await import("../document-preferences");
  let doc = createEmptyPartDocument("Calculated radius");
  const apply = vi.fn(async (next) => {
    doc = next;
  });
  open(() => doc, apply);
  click("Top (XY)");
  tool("circle");
  point(0, 0);
  point(5, 0);
  applyDocumentUnits({ length: { unit: "in", decimals: 3 } });
  try {
    const input = querySketchControl(
      '[aria-label="New curve radius (in)"]',
    );
    input.value = "1/0";
    click("Set radius");
    expect(querySketchControl(".sketch-contour").getAttribute("r")).toBe(
      "5",
    );
    expect(querySketchControl('[role="status"]').textContent).toContain(
      "finite",
    );
    input.value = "1/8";
    click("Set radius");
    expect(
      Number(querySketchControl(".sketch-contour").getAttribute("r")),
    ).toBeCloseTo(3.175);
    click("Undo");
    expect(querySketchControl(".sketch-contour").getAttribute("r")).toBe(
      "5",
    );
    click("Redo");
    click("Finish sketch");
    await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    doc = parsePartDocument(serializePartDocument(doc));
    expect(
      doc.features[0].profile.constraints.find((c) => c.kind === "radius")
        .value,
    ).toBeCloseTo(3.175);
  } finally {
    applyDocumentUnits({});
  }
});
it("commits calculated ellipse diameters atomically", async () => {
  let doc = createEmptyPartDocument("Calculated ellipse");
  const apply = vi.fn(async (next) => {
    doc = next;
  });
  open(() => doc, apply);
  click("Top (XY)");
  tool("ellipse");
  point(0, 0);
  point(5, 0);
  point(0, 3);
  const primary = querySketchControl(
    '[aria-label="New ellipse primary diameter (mm)"]',
  );
  const secondary = querySketchControl(
    '[aria-label="New ellipse secondary diameter (mm)"]',
  );
  const before = querySketchControl(".sketch-contour").getAttribute("d");
  primary.value = "2*(3+4)";
  secondary.value = "2+";
  click("Set ellipse diameters");
  expect(querySketchControl(".sketch-contour").getAttribute("d")).toBe(
    before,
  );
  secondary.value = "2^3";
  click("Set ellipse diameters");
  click("Finish sketch");
  await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
  doc = parsePartDocument(serializePartDocument(doc));
  const arc = doc.features[0].profile.contours[0].segments[0];
  expect(arc.radiusX).toBeCloseTo(7, 8);
  expect(arc.radiusY).toBeCloseTo(4, 8);
});
