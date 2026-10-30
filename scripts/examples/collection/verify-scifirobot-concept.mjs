// Check saved geometry/poses against the concept, independently of its recipe.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { readAssemblyProjection } from "./read-assembly-projection.mjs";

const archive = resolve(process.argv[2] ?? "public/examples/scifirobot.acad.bin");
const out = resolve(process.argv[3] ?? "build/Example-Collection/scifirobot/concept");
const graph = readAssemblyProjection(archive, "assembly-000001");
const checks = [];
const check = (name, passed, actual) => checks.push({ name, passed, actual });
const near = (a, b, tolerance = 1e-6) => Math.abs(a - b) < tolerance;
const instance = (name) => {
  const found = graph.instances.find((item) => item.name === name);
  assert.ok(found, name);
  return found.solved_world_transform;
};
const axis = (name) => {
  const [x, y, z, w] = instance(name).rotation_quaternion_xyzw;
  return [2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)];
};
const direction = (name, expected) => {
  const actual = axis(name);
  check(`${name}: axis`, actual.every((value, index) => near(value, expected[index])), actual);
};
const position = (name) => instance(name).position_m.map((value) => value * 1000);
const appearance = (name) => {
  const part = graph.part_definitions.find((item) => item.name === name);
  assert.ok(part, name);
  return Object.values(part.feature_document.bodyProperties)[0].appearance;
};

direction("Optical carrier", [0, -1, 0]);
const barrels = graph.instances.filter((item) => / cooling duct \d$/.test(item.name));
const sensors = graph.instances.filter((item) => /^Sensor -?\d+ -?\d+$/.test(item.name));
check("Six cooling barrels", barrels.length === 6, barrels.length);
check("Four forward sensors", sensors.length === 4, sensors.length);
for (const item of [...barrels, ...sensors]) direction(item.name, [0, -1, 0]);
direction("Antenna mast", [0, 0, 1]);
direction("Top vent frame", [0, 0, 1]);
for (const side of ["Left", "Right"]) {
  const stack = [1, 2, 3].map((index) => position(`${side} cooling duct ${index}`));
  check(`${side}: straight vertical barrel stack`, stack.every((p) => near(p[0], stack[0][0]) && near(p[1], stack[0][1])), stack);
  check(`${side}: 24 mm barrel pitch`, near(stack[1][2] - stack[0][2], 24) && near(stack[2][2] - stack[1][2], 24), stack.map((p) => p[2]));
}
for (let index = 1; index <= 3; index++) {
  const left = position(`Left cooling duct ${index}`), right = position(`Right cooling duct ${index}`);
  check(`Barrel pair ${index}: mirror symmetry`, near(left[0], -right[0]) && near(left[1], right[1]) && near(left[2], right[2]), [left, right]);
  for (const side of ["Left", "Right"]) {
    const barrel = position(`${side} cooling duct ${index}`);
    const screen = position(`${side} duct screen ${index}`);
    // Barrel mouth is 45 mm forward of its flange; screen starts 22 mm forward.
    check(`${side} barrel ${index}: recessed screen`, near(barrel[1] - screen[1], 22), barrel[1] - screen[1]);
  }
}
for (const name of ["Auxiliary sensor housing", "Auxiliary sensor window", "Optical carrier"]) {
  const style = appearance(name);
  const channels = style.color.slice(1).match(/../g).map((v) => parseInt(v, 16));
  check(`${name}: dark opaque finish`, channels.every((v) => v < 50) && style.opacity === 1, style);
}

const result = { archive_sha256: createHash("sha256").update(readFileSync(archive)).digest("hex"), checks };
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "result.json"), JSON.stringify(result, null, 2) + "\n");
assert.deepEqual(checks.filter((item) => !item.passed), [], "Saved robot departed from its forward-facing concept");
console.log(`Passed ${checks.length} saved-assembly concept checks.`);
