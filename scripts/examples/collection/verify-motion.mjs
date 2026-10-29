import { readAssemblyProjection } from "./read-assembly-projection.mjs";
import assert from "node:assert/strict";
import { rotate } from "./model-kit.mjs";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const runner = join(root, "service/aether_cad_service/runtime/runner.mjs");
function run(input) {
  const result = JSON.parse(
    execFileSync(process.execPath, [runner], {
      input: JSON.stringify(input),
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    }),
  );
  assert.ok(!result.error, result.error);
  return result;
}
const inverse = (q) => [-q[0], -q[1], -q[2], q[3]];
const multiply = (a, b) => {
  const [x, y, z, w] = a,
    [X, Y, Z, W] = b;
  return [
    w * X + x * W + y * Z - z * Y,
    w * Y - x * Z + y * W + z * X,
    w * Z + x * Y - y * X + z * W,
    w * W - x * X - y * Y - z * Z,
  ];
};
const relative = (solution, joint) => {
  const a = solution.instances.find((i) => i.id === joint.a.instance),
    b = solution.instances.find((i) => i.id === joint.b.instance),
    q = inverse(a.rotation);
  return [
    ...rotate(
      q,
      b.placement_mm.map((v, i) => v - a.placement_mm[i]),
    ),
    ...multiply(q, b.rotation),
  ];
};
const vectorError = (a, b) => Math.max(...a.map((v, k) => Math.abs(v - b[k])));
for (const name of process.env.AETHER_EXAMPLE_MODELS?.split(",") ?? [
  "car",
  "airplane",
  "wrench",
]) {
  const model = (await import("./models/" + name + ".mjs")).default,
    folder = join(root, "build/Example-Collection", model.id);
  const report = JSON.parse(
    await readFile(join(folder, "evidence/result.json"), "utf8"),
  );
  for (const configuration of report.configurations ?? [
    { id: "assembly-000001", movable: true },
  ]) {
    if (!configuration.movable) continue;
    const graph = readAssemblyProjection(
      join(folder, model.name + ".acad"),
      configuration.id,
    );
    const translated = run({ phase: "assembly", projection: graph });
    assert.equal(translated.untranslated.length, 0);
    const job = translated.job,
      base = run({ phase: "assembly_solve", job });
    assert.equal(base.status, "ok");
    const fixed = job.instances.filter((i) => i.grounded);
    assert.equal(fixed.length, 1);
    const checks = [];
    for (const joint of job.joints.filter(
      (j) => j.kind !== "fixed" && j.kind !== "fastened",
    )) {
      const kind = joint.kind === "revolute" ? "rotation" : "translation",
        value = kind === "rotation" ? 45 : 5;
      const dof = kind === "rotation" ? "rotation" : "translation";
      const candidate = structuredClone(job),
        target = candidate.joints.find((j) => j.id === joint.id);
      target.parameters = {
        ...target.parameters,
        dofs: [{ name: dof, kind, axis: "z", value }],
      };
      const moved = run({ phase: "assembly_solve", job: candidate });
      assert.equal(moved.status, "ok", JSON.stringify(moved));
      for (const item of fixed) {
        const before = base.instances.find((i) => i.id === item.id),
          after = moved.instances.find((i) => i.id === item.id);
        assert.ok(vectorError(before.placement_mm, after.placement_mm) < 1e-7);
        assert.ok(vectorError(before.rotation, after.rotation) < 1e-7);
      }
      const before = base.instances.find((i) => i.id === joint.b.instance),
        after = moved.instances.find((i) => i.id === joint.b.instance);
      if (kind === "rotation") {
        const dot = Math.abs(
          before.rotation.reduce((n, v, k) => n + v * after.rotation[k], 0),
        );
        assert.ok(
          Math.abs((2 * Math.acos(Math.min(1, dot)) * 180) / Math.PI - 45) <
            1e-4,
        );
      } else
        assert.ok(
          Math.abs(
            Math.hypot(
              ...before.placement_mm.map((x, k) => after.placement_mm[k] - x),
            ) - 5,
          ) < 1e-4,
        );
      for (const rigid of job.joints.filter((j) =>
        ["fixed", "fastened"].includes(j.kind),
      )) {
        const first = relative(base, rigid),
          last = relative(moved, rigid);
        assert.ok(vectorError(first.slice(0, 3), last.slice(0, 3)) < 1e-5);
        assert.ok(
          Math.abs(
            Math.abs(
              first.slice(3).reduce((n, v, k) => n + v * last[k + 3], 0),
            ) - 1,
          ) < 1e-6,
        );
      }
      checks.push({
        rigidChildrenRetainRelativePose: true,
        joint: joint.id,
        kind,
        value,
        groundedBaseUnchanged: true,
        solved: true,
      });
    }
    assert.ok(checks.length);
    await writeFile(
      join(folder, "evidence/motion-" + configuration.id + "-checks.json"),
      JSON.stringify(checks, null, 2),
    );
    console.log(
      model.name,
      configuration.id,
      checks.length,
      "independent joint motions verified",
    );
  }
}
