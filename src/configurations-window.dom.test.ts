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
