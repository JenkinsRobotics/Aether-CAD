/** The shipped example documents build on the Aether engine: every feature
 *  rebuilds (a failed feature throws), at least one body. The Scifirobot example has its
 *  own tip-by-tip proof in the engine package. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { evaluatePart } from "../engine/evaluate-part";
import { parsePartDocument } from "@aether/core/document";

const examples = ["examples/Train-Cart-Wheel.acpart", "examples/Bracket.cadpart"];

describe("example documents", () => {
  for (const path of examples) {
    it(`builds ${path}`, async () => {
      const document = parsePartDocument(readFileSync(new URL(`../../${path}`, import.meta.url), "utf8"));
      const model = await evaluatePart(document);
      expect(model.parts.length, `${path} produced no body`).toBeGreaterThan(0);
      for (const part of model.parts) expect(part.triangles.length).toBeGreaterThan(0);
    }, 120000);
  }
});
