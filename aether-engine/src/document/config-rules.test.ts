import { describe, expect, it } from "vitest";
import { createRectanglePartDocument } from "./part-document";
import { addConfigurationColumn, addConfigurationRow, setConfigurationValue } from "./configurations";
import { activateConfiguration, previewConfiguration, removeConfigRule, setConfigRule, type ConfigRule } from "./config-rules";

function base() {
  let doc = createRectanglePartDocument("Plate", { widthMillimeters: 30, heightMillimeters: 20, depthMillimeters: 10 });
  doc = { ...doc, variables: [{ name: "width", kind: "length", expression: "30 mm" }, { name: "holes", kind: "number", expression: "2" }] };
  doc = addConfigurationColumn(doc, { kind: "param", name: "width" });
  doc = addConfigurationColumn(doc, { kind: "param", name: "holes" });
  doc = addConfigurationColumn(doc, { kind: "suppress", featureId: doc.features[1].id });
  doc = addConfigurationRow(doc, "Small"); doc = addConfigurationRow(doc, "Large");
  doc = setConfigurationValue(doc, "Large", "param:width", "80 mm");
  return doc;
}
const rule = (over: Partial<ConfigRule>): ConfigRule => ({ id: "r1", name: "Wide gets holes", enabled: true, condition: { type: "parameter", parameter: "width", operator: "gt", expression: "50" }, effect: { type: "drive_parameter", parameter: "holes", expression: "4" }, ...over });

describe("configuration rules", () => {
  it("drives a variable when its condition holds, bare numbers read in mm", () => {
    const doc = setConfigRule(base(), rule({}));
    expect(activateConfiguration(doc, "Large").document.variables?.find((v) => v.name === "holes")?.expression).toBe("4");
    const small = activateConfiguration(doc, "Small");
    expect(small.document.variables?.find((v) => v.name === "holes")?.expression).toBe("2");
    expect(small.trace).toEqual([expect.objectContaining({ id: "r1", matched: false })]);
  });
  it("drives a suppression, nests all/any/not, and skips disabled rules", () => {
    const start = base(), extrude = start.features[1].id;
    let doc = setConfigRule(start, rule({ id: "s", name: "Narrow drops the body", condition: { type: "all", conditions: [{ type: "not", condition: { type: "parameter", parameter: "width", operator: "ge", expression: "50 mm" } }, { type: "any", conditions: [{ type: "always" }] }] }, effect: { type: "drive_suppression", featureId: extrude, value: true } }));
    expect(activateConfiguration(doc, "Small").document.features[1].suppressed).toBe(true);
    expect(activateConfiguration(doc, "Large").document.features[1].suppressed).toBe(false);
    doc = setConfigRule(doc, { ...doc.configurations!.rules![0], enabled: false });
    expect(activateConfiguration(doc, "Small").document.features[1].suppressed).toBe(false);
  });
  it("refuses a row outside a range or a value list, and preview says why without changing anything", () => {
    let doc = setConfigRule(base(), rule({ id: "range", name: "Width range", condition: { type: "always" }, effect: { type: "parameter_range", parameter: "width", minimum: "10 mm", maximum: "60 mm" } }));
    expect(() => activateConfiguration(doc, "Large")).toThrow(/between 10 mm and 60 mm/);
    const preview = previewConfiguration(doc, "Large");
    expect(preview).toEqual({ ok: false, error: expect.stringMatching(/Width range/) });
    expect(doc.variables?.find((v) => v.name === "width")?.expression).toBe("30 mm");
    doc = setConfigRule(removeConfigRule(doc, "range"), rule({ id: "list", name: "Hole counts", condition: { type: "always" }, effect: { type: "allow_parameter_values", parameter: "holes", expressions: ["2", "4"] } }));
    expect(previewConfiguration(doc, "Large")).toMatchObject({ ok: true, changes: ["width: 30 mm → 80 mm"] });
  });
  it("validates references: unknown variables and targets that are not columns", () => {
    expect(() => setConfigRule(base(), rule({ condition: { type: "parameter", parameter: "nope", operator: "eq", expression: "1" } }))).toThrow(/unknown variable nope/);
    const start = base(), doc = { ...start, variables: [...start.variables!, { name: "extra", kind: "number" as const, expression: "1" }] };
    expect(() => setConfigRule(doc, rule({ effect: { type: "drive_parameter", parameter: "extra", expression: "2" } }))).toThrow(/not a configuration column/);
  });
});
