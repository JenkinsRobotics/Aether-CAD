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
it("authors, edits and reopens a scaled dimension relationship", async () => {
  let doc = createEmptyPartDocument("Linked dimensions");
  const apply = vi.fn(async (next) => {
    doc = next;
  });
  open(() => doc, apply);
  click("Top (XY)");
  for (const [i, x] of [10, 40].entries()) {
    tool("circle");
    point(x, 10);
    point(x + 5, 10);
    window.dispatchEvent(
      new CustomEvent("aether-sketch-constraint", { detail: "radius" }),
    );
    querySketchControl('[aria-label="Entity A"]').value = JSON.stringify({
      contour: i,
      kind: "circle",
    });
    querySketchControl('[aria-label="Constraint value"]').value = "5";
    click("Apply constraint");
  }
  const dimensions = () => [
    ...querySketchControls('input[aria-label="radius value"]'),
  ];
  const [driver, follower] = dimensions().map((i) => i.dataset.dimensionId);
  const entry = (name) =>
    querySketchControl(`[aria-label="${name} for ${follower}"]`);
  entry("Driver").value = driver;
  entry("Multiplier").value = "2";
  entry("Offset").value = "1";
  entry("Driver").closest("details").querySelector("button").click();
  expect(Number(dimensions()[1].value)).toBeCloseTo(11);
  click("Undo");
  expect(Number(dimensions()[1].value)).toBe(5);
  click("Redo");
  dimensions()[0].value = "3";
  dimensions()[0].parentElement.querySelector("button").click();
  expect(Number(dimensions()[1].value)).toBeCloseTo(7);
  click("Finish sketch");
  await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
  doc = parsePartDocument(serializePartDocument(doc));
  expect(
    doc.features[0].profile.constraints.find((c) => c.id === follower),
  ).toMatchObject({ valueFrom: driver, valueScale: 2, valueOffset: 1 });
  open(() => doc, apply, doc.features[0]);
  expect(Number(dimensions()[1].value)).toBeCloseTo(7);
  // Invalid cycle fails without replacing the persisted relationship.
  querySketchControl(`[aria-label="Driver for ${driver}"]`).value =
    follower;
  querySketchControl(`[aria-label="Driver for ${driver}"]`)
    .closest("details")
    .querySelector("button")
    .click();
  expect(querySketchControl('[role="status"]').textContent).toContain(
    "Cyclic",
  );
  expect(Number(dimensions()[0].value)).toBe(3);
  const relation = entry("Driver").closest("details");
  [...relation.querySelectorAll("button")]
    .find((b) => b.textContent === "Unlink dimension")
    .click();
  expect(Number(dimensions()[1].value)).toBe(7);
  expect(entry("Driver").value).toBe("");
  click("Undo");
  expect(entry("Driver").value).toBe(driver);
  click("Redo");
  expect(entry("Driver").value).toBe("");
  dimensions()[0].value = "4";
  dimensions()[0].parentElement.querySelector("button").click();
  expect(Number(dimensions()[1].value)).toBe(7);
  click("Finish sketch");
  await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(2));
  doc = parsePartDocument(serializePartDocument(doc));
  const independent = doc.features[0].profile.constraints.find(
    (c) => c.id === follower,
  );
  expect(independent.value).toBe(7);
  expect(independent.valueFrom).toBeUndefined();
  expect(independent.valueScale).toBeUndefined();
  expect(independent.valueOffset).toBeUndefined();
});
