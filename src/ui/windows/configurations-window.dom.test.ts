// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { createEmptyPartDocument, type PartDocument, type PartFeature } from "@aether/core/document";
import { openConfigurationsWindow } from "./configurations-window";

it("adds columns and rows, activates a row and applies the document", async () => {
  document.body.innerHTML = '<div class="cad-studio-viewport"></div>';
  let doc = createEmptyPartDocument("Cfg");
  doc.variables = [{ name: "width", kind: "length", expression: "40 mm" }];
  doc.features.push({ id: "s", type: "profile", name: "Sketch 1", plane: "XY", offsetMillimeters: 0, suppressed: false, profile: { type: "polygon", pointsMillimeters: [[0, 0], [10, 0], [10, 10], [0, 10]] } } as PartFeature,
    { id: "e", type: "extrude", name: "Extrude 2", profileFeatureId: "s", distanceMillimeters: 5, operation: "new", suppressed: false } as PartFeature);
  const apply = vi.fn(async (next: PartDocument) => { doc = next; });
  openConfigurationsWindow(() => doc, apply);
  const win = document.querySelector(".cad-configurations-window")!;
  const button = (text: string) => [...win.querySelectorAll("button")].find((b) => b.textContent === text)!;
  (win.querySelector('[aria-label="Variable column"]') as HTMLSelectElement).value = "width"; button("Add variable").click();
  (win.querySelector('[aria-label="Feature column"]') as HTMLSelectElement).value = "e"; button("Add feature").click();
  (win.querySelector('[aria-label="New configuration name"]') as HTMLInputElement).value = "Small"; button("Add row from current values").click();
  (win.querySelector('[aria-label="New configuration name"]') as HTMLInputElement).value = "Large"; button("Add row from current values").click();
  const widthInput = win.querySelector('[aria-label="Large · width"]') as HTMLInputElement;
  widthInput.value = "80 mm"; widthInput.dispatchEvent(new Event("change"));
  const suppress = win.querySelector('[aria-label="Large · Extrude 2 (suppressed)"]') as HTMLInputElement;
  suppress.checked = true; suppress.dispatchEvent(new Event("change"));
  (win.querySelector('[aria-label="Configuration row"]') as HTMLSelectElement).value = "Large"; win.querySelector('[aria-label="Configuration row"]')!.dispatchEvent(new Event("change"));
  button("Activate").click();
  (win.querySelector('[data-feature-action="accept"]') as HTMLButtonElement).click();
  await Promise.resolve(); await Promise.resolve();
  expect(apply).toHaveBeenCalledTimes(1);
  expect(doc.variables?.[0].expression).toBe("80 mm");
  expect(doc.features[1].suppressed).toBe(true);
  expect(doc.configurations?.activeRow).toBe("Large");
  expect(doc.configurations?.rows.map((r) => r.name)).toEqual(["Small", "Large"]);
});

it("adds a rule, previews a row it refuses, and activates through the rules", async () => {
  document.body.innerHTML = '<div class="cad-studio-viewport"></div>';
  let doc = createEmptyPartDocument("Rules");
  doc.variables = [{ name: "width", kind: "length", expression: "40 mm" }, { name: "holes", kind: "number", expression: "2" }];
  const apply = vi.fn(async (next: PartDocument) => { doc = next; });
  openConfigurationsWindow(() => doc, apply);
  const win = document.querySelector(".cad-configurations-window")!;
  const button = (text: string) => [...win.querySelectorAll("button")].find((b) => b.textContent === text)!;
  const field = <T extends HTMLElement>(label: string) => win.querySelector(`[aria-label="${label}"]`) as T;
  const choose = (label: string, value: string) => { const el = field<HTMLSelectElement>(label); el.value = value; el.dispatchEvent(new Event("change")); };
  choose("Variable column", "width"); button("Add variable").click();
  choose("Variable column", "holes"); button("Add variable").click();
  field<HTMLInputElement>("New configuration name").value = "Small"; button("Add row from current values").click();
  field<HTMLInputElement>("New configuration name").value = "Huge"; button("Add row from current values").click();
  const huge = field<HTMLInputElement>("Huge · width"); huge.value = "500 mm"; huge.dispatchEvent(new Event("change"));
  // When width > 50 (mm), holes = 4.
  choose("Rule condition variable", "width"); choose("Rule comparison", "gt"); field<HTMLInputElement>("Rule condition value").value = "50";
  choose("Rule effect", "drive_parameter"); choose("Rule target", "holes"); field<HTMLInputElement>("Rule value").value = "4";
  field<HTMLInputElement>("Rule name").value = "Wide"; button("Add rule").click();
  // Always keep width within 10..100 mm.
  choose("Rule comparison", "always"); choose("Rule effect", "parameter_range"); choose("Rule target", "width"); field<HTMLInputElement>("Rule value").value = "10 mm..100 mm";
  field<HTMLInputElement>("Rule name").value = "Range"; button("Add rule").click();
  expect(doc.configurations).toBeUndefined();
  choose("Configuration row", "Huge"); button("Preview").click();
  expect(win.textContent).toMatch(/Huge would fail: Rule Range/);
  choose("Configuration row", "Small"); button("Preview").click();
  expect(win.textContent).toMatch(/Small: no change\. Rules matched: Range/);
  const hugeTooBig = field<HTMLInputElement>("Small · width"); hugeTooBig.value = "70 mm"; hugeTooBig.dispatchEvent(new Event("change"));
  button("Activate").click();
  (win.querySelector('[data-feature-action="accept"]') as HTMLButtonElement).click();
  await Promise.resolve(); await Promise.resolve();
  expect(doc.variables?.find((v) => v.name === "holes")?.expression).toBe("4");
  expect(doc.configurations?.rules?.map((r) => r.name)).toEqual(["Wide", "Range"]);
});
