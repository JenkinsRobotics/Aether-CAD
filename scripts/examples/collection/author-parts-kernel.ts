import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { initNodeKernel } from "../../../aether-engine/src/kernel/node-kernel";
import { evaluatePartDocument } from "../../../aether-engine/src/kernel/part-evaluator";
import {
  createEmptyPartDocument,
  serializePartDocument,
  parsePartDocument,
} from "../../../aether-engine/src/document";
import {
  prepareSavedProgramStep,
  acceptSavedProgramStep,
} from "../../../src/automation/saved-program";
import { measureVolume } from "replicad";

const out = process.argv[2];
await initNodeKernel(
  readFileSync(
    "aether-engine/node_modules/replicad-opencascadejs/src/replicad_single.wasm",
  ),
);
for (const part of JSON.parse(readFileSync(join(out, "recipe.json"), "utf8"))) {
  let content = serializePartDocument(createEmptyPartDocument(part.name));
  const references = {},
    holeChecks = [];
  let volume = 0;
  for (const step of part.steps) {
    const prepared = prepareSavedProgramStep(content, step, references);
    const before = volume;
    const result = evaluatePartDocument(parsePartDocument(prepared.candidate), {
      withBodies(bodies) {
        volume = [...bodies.values()].reduce(
          (sum, body) => sum + measureVolume(body),
          0,
        );
      },
    });
    const accepted = acceptSavedProgramStep({
      content: prepared.candidate,
      pending: prepared.pending,
      body_outputs: result.bodyOutputs ?? {},
      sketch_frames: result.sketchFrames ?? {},
      scope_resolutions: result.scopeResolutions ?? {},
    });
    content = accepted.content;
    references[step.id] = accepted.reference;
    if (step.arguments.feature_json?.type === "hole") {
      assert.ok(volume < before - 1e-5, "Hole must remove real material");
      holeChecks.push({
        feature: step.arguments.feature_json.name,
        before,
        after: volume,
        removedMm3: before - volume,
      });
    }
  }
  assert.ok(volume > 0, `${part.name}: positive solid volume`);
  writeFileSync(
    join(out, part.key + ".json"),
    JSON.stringify({
      fingerprint: createHash("sha256")
        .update(JSON.stringify(part))
        .digest("hex"),
      document: parsePartDocument(content),
      holeChecks,
    }),
  );
  console.log(`Authored ${part.name}: ${part.steps.length} validated steps`);
}
