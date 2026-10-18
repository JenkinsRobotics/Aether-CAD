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
it.each(["length", "radius", "angle"])(
  "creates a persistent %s formula and excludes formulas from reference measurements",
  async (kind) => {
    let doc = createEmptyPartDocument("Calculated constraint");
    doc.variables = [
      {
        name: "target",
        kind: kind === "angle" ? "angle" : "length",
        expression: kind === "angle" ? "90 deg" : "8 mm",
      },
    ];
    const apply = vi.fn(async (next) => {
      doc = next;
    });
    open(() => doc, apply);
    click("Top (XY)");
    let a, b;
    if (kind === "radius") {
      tool("circle");
      point(10, 10);
      point(15, 10);
      a = { contour: 0, kind: "circle" };
    } else {
      tool("line");
      point(10, 10);
      point(20, 10);
      a = { contour: 0, kind: "line", index: 0 };
      if (kind === "angle") {
        click("New contour");
        point(10, 10);
        point(10, 20);
        b = { contour: 1, kind: "line", index: 0 };
      }
    }
    window.dispatchEvent(
      new CustomEvent("aether-sketch-constraint", { detail: kind }),
    );
    querySketchControl('[aria-label="Entity A"]').value = JSON.stringify(a);
    if (b)
      querySketchControl('[aria-label="Entity B"]').value =
        JSON.stringify(b);
    const enabled = querySketchControl(
      '[aria-label="Use constraint formula"]',
    );
    enabled.checked = true;
    enabled.dispatchEvent(new Event("change"));
    const formula = querySketchControl('[aria-label="Constraint formula"]');
    expect(
      querySketchControl('[aria-label="Constraint value"]').disabled,
    ).toBe(true);
    formula.value = "#missing";
    click("Apply constraint");
    expect(querySketchControls("input[data-dimension-id]")).toHaveLength(
      0,
    );
    expect(document.body.textContent).toContain("Unknown variable #missing");
    formula.value = "#target";
    click("Apply constraint");
    const value = () =>
      querySketchControl(`input[aria-label="${kind} value"]`);
    expect(Number(value().value)).toBeCloseTo(kind === "angle" ? 90 : 8);
    expect(value().readOnly).toBe(true);
    click("Undo");
    expect(querySketchControls("input[data-dimension-id]")).toHaveLength(
      0,
    );
    click("Redo");
    expect(value().readOnly).toBe(true);
    formula.value = "#invalid";
    const reference = querySketchControl(
      '[aria-label="Reference dimension"]',
    );
    reference.checked = true;
    reference.dispatchEvent(new Event("change"));
    click("Apply constraint");
    click("Finish sketch");
    await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    doc = parsePartDocument(serializePartDocument(doc));
    const constraints = doc.features[0].profile.constraints.filter(
      (c) => c.kind === kind,
    );
    expect(constraints[0].valueExpression).toBe("#target");
    expect(constraints[0].value).toBeCloseTo(kind === "angle" ? 90 : 8);
    expect(constraints[1].reference).toBe(true);
    expect(constraints[1].valueExpression).toBeUndefined();
  },
);
