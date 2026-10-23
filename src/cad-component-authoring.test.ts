import { describe, expect, it } from "vitest";
import { bodiesToComponentDraftIssues, defaultBodiesToComponentDraft, parseCustomProperties, partPropertiesDraftFrom, partPropertiesDraftIssues } from "./cad-component-authoring";

describe("component authoring drafts", () => {
  it("round-trips custom properties as key = value lines", () => {
    const draft = partPropertiesDraftFrom({ part_number: "P-1", description: null, custom_properties: [{ key: "finish", value: "anodised" }, { key: "vendor", value: "" }] });
    expect(draft.properties).toBe("finish = anodised\nvendor = ");
    expect(parseCustomProperties(draft.properties)).toEqual([{ key: "finish", value: "anodised" }, { key: "vendor", value: "" }]);
    expect(partPropertiesDraftIssues(draft)).toEqual([]);
    expect(partPropertiesDraftIssues({ ...draft, properties: "finish = a\nfinish = b" })).toEqual(["A property key repeats."]);
    expect(partPropertiesDraftIssues({ ...draft, properties: "no equals" })[0]).toMatch(/not key = value/);
  });
  it("needs a source, a pick, and a target that is not the source", () => {
    expect(bodiesToComponentDraftIssues(defaultBodiesToComponentDraft())).toHaveLength(2);
    expect(bodiesToComponentDraftIssues({ ...defaultBodiesToComponentDraft("i1"), bodyIDs: ["b"], target: "i1" })).toEqual(["The target is the source occurrence."]);
    expect(bodiesToComponentDraftIssues({ ...defaultBodiesToComponentDraft("i1"), sketchIDs: ["s"] })).toEqual([]);
  });
});
