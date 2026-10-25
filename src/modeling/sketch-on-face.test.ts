/** Sketch on the top face of a fresh plate: the three non-UI refusals the pick
 *  flow can raise (no planar frame, an indistinguishable face, no source
 *  feature) must all stay silent for the simplest part there is. */
import { describe, expect, it } from "vitest";
import { evaluatePart } from "../engine/evaluate-part";
import { anchorForPlanarFace } from "../viewport/planar-face-reference";
import { supportForFace } from "./sketch-support";
import { PART_DOCUMENT_VERSION, type PartDocument } from "../part-document";

const plate: PartDocument = {
  format: "aether-part", formatVersion: PART_DOCUMENT_VERSION, documentId: "plate", name: "Part 1", units: "millimeter",
  features: [
    { id: "s", type: "profile", name: "Sketch 1", plane: "XY", offsetMillimeters: 0, suppressed: false,
      profile: { type: "polygon", pointsMillimeters: [[10, -15], [50, -15], [50, 15], [10, 15]] } },
    { id: "e", type: "extrude", name: "Extrude 1", profileFeatureId: "s", distanceMillimeters: 12, operation: "new", suppressed: false },
  ],
} as unknown as PartDocument;

describe("sketch on a face", () => {
  it("accepts the top face of an extruded plate", async () => {
    const model = await evaluatePart(plate);
    const part = model.parts[0];
    expect(part).toBeDefined();
    const planar = part.topology.filter((f) => f.surfaceType === "PLANE");
    const top = planar.find((f) => f.candidates.some((c) => c.kind === "face-center" && c.zAxis[2] > 0.999));
    expect(top, `planar faces: ${planar.map((f) => f.candidates.find((c) => c.kind === "face-center")?.zAxis.join(",")).join(" | ")}`).toBeDefined();
    const center = top!.candidates.find((c) => c.kind === "face-center")!;
    const anchor = anchorForPlanarFace(part.topology, top!.id);
    expect(anchor, "the top face must be distinguishable").not.toBeNull();
    const frame = { originMillimeters: [...center.origin] as [number, number, number], xDirection: [1, 0, 0] as [number, number, number], normal: [...center.zAxis] as [number, number, number] };
    const support = supportForFace(plate, part.id, frame, "Face 1 of Part 1", undefined, anchor ?? undefined);
    expect(support?.sourceFeatureId).toBe("e");
  }, 60000);
});
