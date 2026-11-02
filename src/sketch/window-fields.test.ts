// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { mountSketchWindowFields } from "./window-fields";

/** The flip box is SolidCraft's `flip`: present only when the host handles it, and it reports its state. */
describe("sketch window fields", () => {
  const win = () => {
    const rows: [string, HTMLElement][] = [];
    return { rows, panel: document.createElement("div"), row: (label: string, el: HTMLElement) => { rows.push([label, el]); }, entitiesBox: () => ({ render() {}, element: document.createElement("div") }) };
  };
  it("hides the flip box for hosts that do not handle it", () => {
    const w = win();
    mountSketchWindowFields(w as never, { changePlane() {}, onConstraintsChange() {}, onExpressionsChange() {}, onErrorsChange() {} });
    expect(w.rows.some(([label]) => label === "Flip sketch plane")).toBe(false);
  });
});
