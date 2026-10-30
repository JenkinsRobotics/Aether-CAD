import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { initNodeKernel } from "../../../aether-engine/src/kernel/node-kernel";
import { evaluatePartDocument } from "../../../aether-engine/src/kernel/part-evaluator";
import { getOC, measureVolume, type Shape3D } from "replicad";
const out = process.argv[2];
const source = JSON.parse(readFileSync(join(out, "source.json"), "utf8"));
await initNodeKernel(
  readFileSync(
    "aether-engine/node_modules/replicad-opencascadejs/src/replicad_single.wasm",
  ),
);
const oc = getOC();
type Bounds = { min: number[]; max: number[] };
const boxes: Map<string, Bounds>[] = [];
const shapes = new Map<string, Shape3D>();
const checks: object[] = [];
function bounds(shape: Shape3D): Bounds {
  const box = new oc.Bnd_Box_1();
  oc.BRepBndLib.AddOptimal(shape.wrapped, box, false, false);
  const a = box.CornerMin(),
    b = box.CornerMax();
  try {
    return { min: [a.X(), a.Y(), a.Z()], max: [b.X(), b.Y(), b.Z()] };
  } finally {
    a.delete();
    b.delete();
    box.delete();
  }
}
function combined(items: Bounds[]) {
  assert.ok(items.length, "Measurement must include actual geometry");
  const min = [0, 1, 2].map((k) => Math.min(...items.map((b) => b.min[k])));
  const max = [0, 1, 2].map((k) => Math.max(...items.map((b) => b.max[k])));
  return { min, max, size: max.map((v, k) => v - min[k]) };
}
function check(
  label: string,
  actual: number,
  expected: number,
  tolerance = 0.02,
) {
  assert.ok(Number.isFinite(actual));
  checks.push({
    label,
    actual_mm: actual,
    expected_mm: expected,
    tolerance_mm: tolerance,
    passed: Math.abs(actual - expected) <= tolerance,
  });
}
try {
  for (const graph of source.graphs) {
    const placed = new Map<string, Bounds>();
    for (const p of graph.part_definitions)
      if (!shapes.has(p.id)) {
        evaluatePartDocument(p.feature_document, {
          withBodies(bodies) {
            assert.equal(bodies.size, 1, `${p.name}: one solid body`);
            const shape = [...bodies.values()][0] as Shape3D;
            assert.ok(measureVolume(shape) > 0);
            const valid = new oc.BRepCheck_Analyzer(shape.wrapped, true, false);
            try {
              assert.ok(valid.IsValid_2(), `${p.name}: valid B-rep`);
            } finally {
              valid.delete();
            }
            shapes.set(p.id, shape.clone());
          },
        });
      }
    for (const i of graph.instances) {
      assert.ok(!i.suppressed);
      const t = i.solved_world_transform,
        q = t.rotation_quaternion_xyzw;
      const s = Math.hypot(...q.slice(0, 3));
      let shape = shapes.get(i.definition_id)!.clone();
      if (s > 1e-12)
        shape = shape.rotate(
          (2 * Math.atan2(s, q[3]) * 180) / Math.PI,
          [0, 0, 0],
          q.slice(0, 3).map((v: number) => v / s),
        ) as Shape3D;
      shape = shape.translate(
        t.position_m.map((v: number) => v * 1000),
      ) as Shape3D;
      try {
        placed.set(i.name, bounds(shape));
      } finally {
        shape.delete();
      }
    }
    boxes.push(placed);
  }
  const [launch, orbit] = boxes;
  const launchBounds = combined([...launch.values()]),
    orbitBounds = combined([...orbit.values()]);
  // Independent reference values transcribed from NASA/HAER sheets, deliberately
  // not imported from the recipe. Metres at full scale become mm at 1:100 ×10.
  check("Launch stack height — TX-116-J/3: 56.40 m", launchBounds.size[2], 564);
  check(
    "Orbiter overall length — TX-116-A/4: 37.04 m",
    orbitBounds.size[2],
    370.4,
  );
  check("Orbiter span — TX-116-A/5,7: 23.80 m", orbitBounds.size[0], 238);
  check(
    "Orbiter flight height — TX-116-J/3: 14.09 m",
    orbitBounds.size[1],
    140.9,
  );
  check(
    "Fuselage plus nose — TX-116-A/4: 32.89 m",
    combined(["Orbiter fuselage", "Nose cap"].map((n) => orbit.get(n)!))
      .size[2],
    328.9,
  );
  check(
    "Tank length — TX-116-J/3: 46.69 m",
    combined([launch.get("External tank — grounded")!]).size[2],
    466.9,
  );
  check(
    "Tank diameter — NASA: 8.38 m",
    combined([launch.get("External tank — grounded")!]).size[0],
    83.8,
  );
  for (const side of [-1, 1]) {
    const booster = [...launch.entries()]
      .filter(([n]) => n.startsWith(`Booster ${side} `))
      .map(([, b]) => b);
    check(
      `Booster ${side} overall length — TX-116-J/3: 45.72 m`,
      combined(booster).size[2],
      457.2,
    );
    const casing = launch.get(`Booster ${side} segment 1`)!;
    check(
      `Booster ${side} motor diameter — NASA: 3.71 m`,
      combined([casing]).size[0],
      37.1,
    );
    check(
      `Booster ${side} centre offset — TX-116-J/3: 6.36 m`,
      Math.abs((casing.max[0] + casing.min[0]) / 2),
      63.6,
    );
  }
  for (const side of ["Port", "Starboard"])
    check(
      `${side} door length — TX-116-A/4: 61 ft 0.5 in`,
      combined([orbit.get(`${side} payload door`)!]).size[2],
      186.055,
    );
  const result = {
    archive_sha256: source.archive_sha256,
    scale: "1:100",
    method:
      "Exact OCCT B-rep bounds of both reopened native assemblies; no display-mesh measurements.",
    valid_parts: shapes.size,
    checks,
    launchBounds,
    orbitBounds,
  };
  writeFileSync(
    join(out, "result.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(checks, null, 2));
  if (process.env.AETHER_DIMENSION_BASELINE !== "1")
    assert.deepEqual(
      checks.filter((c: any) => !c.passed),
      [],
      "NASA reference dimensions must match the built assembly",
    );
} finally {
  for (const shape of shapes.values()) shape.delete();
}
