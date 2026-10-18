import { describe, it, expect } from "vitest";
import { appendSTEP } from "./step-import";
import { availableBodies, parsePartDocument, serializePartDocument, setFeatureSuppressed, removeFeature, insertFeature } from "@aether/core/document";
import { translateDocument } from "../freecad-translate";

describe("saved native STEP import", () => {
  const file = () => new File(["ISO-10303-21;fixture"], "bracket.step");
  it("preserves source and body identity across save/reopen and targets subsequent cuts", async () => {
    const first = await appendSTEP(null, file());
    const body = availableBodies(first)[0];
    const second = await appendSTEP(first, file());
    expect(first.features).toHaveLength(1);
    const opened = parsePartDocument(serializePartDocument(second));
    expect(availableBodies(opened).map(b => b.id)).toEqual(availableBodies(second).map(b => b.id));
    expect(translateDocument(opened).features[0]).toMatchObject({ kind: "import-step", parameters: { body_id: body.id, data_base64: btoa("ISO-10303-21;fixture") }});
    let cut = insertFeature(opened, { id: "s", type: "profile", name: "Hole", suppressed: false, plane: "XY", offsetMillimeters: 10, profile: { type: "circle", radiusMillimeters: 2, centerMillimeters: [5,5] } });
    cut = insertFeature(cut, { id: "cut", type: "extrude", name: "Cut", suppressed: false, operation: "cut", targetBodyId: body.id, profileFeatureId: "s", distanceMillimeters: 10 });
    expect(translateDocument(cut).features.at(-1)?.parameters.body_id).toBe(body.id);
    expect(availableBodies(setFeatureSuppressed(cut, first.features[0].id, true))).toHaveLength(1);
    expect(removeFeature(cut, first.features[0].id).features.some(f => f.id === "cut")).toBe(true);
  });
  it("rejects empty or oversized source without changing the current document", async () => {
    await expect(appendSTEP(null, new File([], "empty.step"))).rejects.toThrow(/nonempty/);
    await expect(appendSTEP(null, new File([new Uint8Array(3*1024*1024+1)], "large.step"))).rejects.toThrow(/3 MiB/);
  });
});
