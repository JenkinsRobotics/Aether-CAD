import { expect, it } from "vitest";
import { createEmptyPartDocument, type PartFeature } from "./index";
import { addConfigurationColumn, addConfigurationRow, applyConfigurationRow, configurationMatches, removeConfigurationRow, setConfigurationValue, validateConfigurations } from "./configurations";

it("configures variables and suppressions by row, activates them, and knows when the design drifts", () => {
  const doc = createEmptyPartDocument("Cfg");
  doc.variables = [{ name: "width", kind: "length", expression: "40 mm" }];
  doc.features.push({ id: "s", type: "profile", name: "s", plane: "XY", offsetMillimeters: 0, suppressed: false, profile: { type: "polygon", pointsMillimeters: [[0, 0], [10, 0], [10, 10], [0, 10]] } } as PartFeature,
    { id: "e", type: "extrude", name: "E", profileFeatureId: "s", distanceMillimeters: 5, operation: "new", suppressed: false } as PartFeature);
  let next = addConfigurationColumn(doc, { kind: "param", name: "width" });
  next = addConfigurationColumn(next, { kind: "suppress", featureId: "e" });
  next = addConfigurationRow(next, "Small");
  expect(next.configurations?.rows[0].values).toEqual({ "param:width": "40 mm", "suppress:e": false });
  expect(next.configurations?.activeRow).toBe("Small");
  next = addConfigurationRow(next, "Large", "Small");
  next = setConfigurationValue(next, "Large", "param:width", "80 mm");
  next = setConfigurationValue(next, "Large", "suppress:e", true);
  const large = applyConfigurationRow(next, "Large");
  expect(large.variables?.[0].expression).toBe("80 mm");
  expect(large.features[1].suppressed).toBe(true);
  expect(large.configurations?.activeRow).toBe("Large");
  expect(configurationMatches(large)).toBe(true);
  // Editing the variable by hand drifts from the active row; activating Small restores and re-matches.
  const drifted = { ...large, variables: [{ ...large.variables![0], expression: "81 mm" }] };
  expect(configurationMatches(drifted)).toBe(false);
  const small = applyConfigurationRow(drifted, "Small");
  expect(small.variables?.[0].expression).toBe("40 mm"); expect(small.features[1].suppressed).toBe(false); expect(configurationMatches(small)).toBe(true);
  expect(() => addConfigurationColumn(next, { kind: "param", name: "nope" })).toThrow(/No variable/);
  expect(() => addConfigurationRow(next, "Small")).toThrow(/already exists/);
  expect(removeConfigurationRow(small, "Small").configurations?.activeRow).toBeUndefined();
  expect(() => validateConfigurations({ columns: [{ kind: "param", name: "ghost" }], rows: [] }, small)).toThrow(/unknown variable/);
  validateConfigurations(small.configurations, small);
});
