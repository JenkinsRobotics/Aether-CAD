// Exact saved-assembly checks, independent of the authoring recipe and viewport.
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readAssemblyProjection } from "./read-assembly-projection.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const archive = resolve(
  process.argv[2] ?? "public/examples/scifirobot.aethercad.bin",
);
const out = resolve(
  process.argv[3] ?? "build/Example-Collection/scifirobot/fit",
);
mkdirSync(out, { recursive: true });
const projection = readAssemblyProjection(archive, "assembly-000001");
writeFileSync(resolve(out, "projection.json"), JSON.stringify(projection));
const run = (request) =>
  JSON.parse(
    execFileSync(
      process.execPath,
      [resolve(root, "service/aether_cad_service/runtime/runner.mjs")],
      {
        input: JSON.stringify(request),
        maxBuffer: 32 * 1024 * 1024,
        encoding: "utf8",
      },
    ),
  );
const translated = run({
  phase: "assembly",
  projection: structuredClone(projection),
});
assert.deepEqual(translated.untranslated, []);
const job = translated.job,
  original = run({ phase: "assembly_solve", job });
assert.equal(original.status, "ok");
for (const instance of projection.instances) {
  const solved = original.instances.find((i) => i.id === instance.id);
  assert.ok(solved, `${instance.name}: present in the fresh solve`);
  instance.solved_world_transform.position_m.forEach((v, k) =>
    assert.ok(
      Math.abs(v * 1000 - solved.placement_mm[k]) < 1e-6,
      `${instance.name}: reopened placement`,
    ),
  );
  const q = instance.solved_world_transform.rotation_quaternion_xyzw;
  assert.ok(
    Math.abs(
      Math.abs(q.reduce((sum, v, k) => sum + v * solved.rotation[k], 0)) - 1,
    ) < 1e-8,
    `${instance.name}: reopened orientation`,
  );
}
let rigidFollowChecked = 0;
if (job.joints.every((j) => j.kind === "fastened")) {
  const ground = job.instances.filter((i) => i.grounded);
  assert.equal(ground.length, 1);
  const delta = [17, -23, 11];
  ground[0].placement_mm = ground[0].placement_mm.map((v, k) => v + delta[k]);
  const moved = run({ phase: "assembly_solve", job });
  assert.equal(moved.status, "ok");
  for (const before of original.instances) {
    const after = moved.instances.find((i) => i.id === before.id);
    assert.ok(after);
    before.placement_mm.forEach((v, k) =>
      assert.ok(Math.abs(after.placement_mm[k] - v - delta[k]) < 1e-6),
    );
    assert.ok(
      Math.abs(
        Math.abs(
          before.rotation.reduce((s, v, k) => s + v * after.rotation[k], 0),
        ) - 1,
      ) < 1e-8,
    );
    rigidFollowChecked++;
  }
}
writeFileSync(
  resolve(out, "source.json"),
  JSON.stringify({
    archive_sha256: createHash("sha256")
      .update(readFileSync(archive))
      .digest("hex"),
    rigid_follow_checked: rigidFollowChecked,
  }),
);
const env = { ...process.env };
if (archive.toLowerCase().includes("scifirobot") && !env.AETHER_FIT_SEATS) {
  const { seatingPairs } = await import("./models/scifirobot-design.mjs");
  env.AETHER_FIT_SEATS = resolve(out, "seats.json");
  writeFileSync(env.AETHER_FIT_SEATS, JSON.stringify(seatingPairs));
}
await build({
  entryPoints: [
    resolve(root, "scripts/examples/collection/verify-fit-kernel.ts"),
  ],
  outfile: resolve(out, "check.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  nodePaths: [resolve(root, "aether-engine/node_modules")],
  banner: {
    js: "import {createRequire} from 'node:module'; import {fileURLToPath} from 'node:url'; import {dirname} from 'node:path'; const require=createRequire(import.meta.url); const __filename=fileURLToPath(import.meta.url); const __dirname=dirname(__filename);",
  },
});
execFileSync(process.execPath, [resolve(out, "check.mjs"), out], {
  cwd: root,
  stdio: "inherit",
  env,
});
