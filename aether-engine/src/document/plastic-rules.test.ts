import { describe, expect, it } from "vitest";
import { PLASTIC_RULE_LIBRARY, assignPlasticRule, plasticRuleFor, removePlasticRule, setActivePlasticRule, setPlasticRule, validatePlasticRules } from "./plastic-rules";

describe("plastic rules", () => {
  const doc = { name: "Housing" };
  it("starts a rule from the library and makes the first one active", () => {
    const withRule = setPlasticRule(doc, { name: "Thin ABS", thicknessMillimeters: 1.2 });
    expect(withRule.plasticRules?.rules[0]).toMatchObject({ name: "Thin ABS", thicknessMillimeters: 1.2, draftDegrees: PLASTIC_RULE_LIBRARY[0].draftDegrees });
    expect(withRule.plasticRules?.active).toBe("Thin ABS");
    expect(plasticRuleFor(withRule)?.name).toBe("Thin ABS");
    expect(() => setPlasticRule(doc, { name: "Bad", draftDegrees: 60 })).toThrow(/draft/);
  });
  it("assigns rules to bodies, prefers the assignment, and cleans up on removal", () => {
    let d = setPlasticRule(setPlasticRule(doc, { name: "A" }), { name: "B", from: "PC (2mm)" } as never);
    d = setActivePlasticRule(d, "B");
    d = assignPlasticRule(d, ["body-1"], "A");
    expect(plasticRuleFor(d, "body-1")?.name).toBe("A");
    expect(plasticRuleFor(d, "body-2")?.name).toBe("B");
    expect(() => validatePlasticRules(d.plasticRules)).not.toThrow();
    d = removePlasticRule(d, "A");
    expect(plasticRuleFor(d, "body-1")?.name).toBe("B");
    expect(d.plasticRules?.assignments).toBeUndefined();
    expect(removePlasticRule(d, "B").plasticRules).toBeUndefined();
    expect(() => validatePlasticRules({ rules: [], active: "x" })).toThrow(/not defined/);
  });
});
