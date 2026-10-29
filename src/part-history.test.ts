import { describe, expect, it } from "vitest";
import type { PartTransform, TransformFeature } from "@aether/core/document";
import { isPartPlacementAction } from "./part-history";
import { createRectanglePartDocument } from "./part-document";
import { buildPartFeatureTree, buildPartHistory } from "./part-feature-tree";

const move: TransformFeature = { id: "move", name: "Move parts", type: "transform", suppressed: false, bodyIds: ["b"], transform: { kind: "translate", translationMillimeters: [10, 0, 0] } };

describe("Part placement history", () => {
  it.each(["translate", "rotate", "translate-reference", "rotate-reference", "align"])("keeps %s in History independently of its name", kind => {
    const action = { ...move, name: "Custom name", transform: { kind } as PartTransform };
    expect(isPartPlacementAction(action)).toBe(true);
    expect(isPartPlacementAction({ ...action, copyBodyIds: { b: "copy" } })).toBe(false);
  });
  it.each(["copy", "mirror", "scale", "scale-reference"])("keeps %s in the modeling tree", kind => {
    expect(isPartPlacementAction({ ...move, transform: { kind } as PartTransform })).toBe(false);
  });
  it("preserves the stored replay list and status while projecting only modeling features", () => {
    const part = createRectanglePartDocument("Block", { widthMillimeters: 20, heightMillimeters: 20, depthMillimeters: 5 });
    const document = { ...part, features: [...part.features, move, { ...move, id: "move2", suppressed: true }], rollbackIndex: 2 };
    const before = JSON.stringify(document);
    expect(buildPartFeatureTree(document).children.map(row => row.kind)).toEqual(["sketch", "extrude", "body"]);
    expect(buildPartHistory(document).slice(2)).toMatchObject([{ id: "move", detail: "Rolled back" }, { id: "move2", detail: "Suppressed" }]);
    expect(JSON.stringify(document)).toBe(before);
  });
});
