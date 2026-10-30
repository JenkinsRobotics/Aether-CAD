import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import init from "../../../aether-engine/node_modules/replicad-opencascadejs/src/replicad_single.js";
import {
  setOC,
  isShape3D,
  measureVolume,
  measureDistanceBetween,
  type Shape3D,
} from "replicad";
import { evaluatePartDocument } from "../../../aether-engine/src/kernel/part-evaluator";

const out = process.argv[2];
const graph = JSON.parse(readFileSync(join(out, "projection.json"), "utf8"));
const oc = await (init as any)({
  wasmBinary: readFileSync(
    "aether-engine/node_modules/replicad-opencascadejs/src/replicad_single.wasm",
  ),
});
setOC(oc);
const parts = new Map<string, Shape3D>();
const placed = new Map<string, Shape3D>();
try {
  for (const p of graph.part_definitions) {
    evaluatePartDocument(p.feature_document, {
      withBodies(bodies) {
        assert.equal(bodies.size, 1, `${p.name}: one connected body`);
        const body = [...bodies.values()][0];
        assert.ok(measureVolume(body) > 0, `${p.name}: positive volume`);
        const validity = new oc.BRepCheck_Analyzer(body.wrapped, true, false);
        const explorer = new oc.TopExp_Explorer_2(
          body.wrapped,
          oc.TopAbs_ShapeEnum.TopAbs_SOLID,
          oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
        );
        try {
          assert.ok(validity.IsValid_2(), `${p.name}: valid exact B-rep`);
          let count = 0;
          for (; explorer.More(); explorer.Next()) count++;
          assert.equal(
            count,
            1,
            `${p.name}: one connected solid, not loose bodies`,
          );
        } finally {
          validity.delete();
          explorer.delete();
        }
        parts.set(p.id, body.clone());
      },
    });
  }
  for (const i of graph.instances) {
    assert.ok(
      !i.suppressed,
      `${i.name}: no hidden interference by suppression`,
    );
    const t = i.solved_world_transform;
    const q = t.rotation_quaternion_xyzw,
      s = Math.hypot(...q.slice(0, 3));
    let shape = parts.get(i.definition_id)!.clone();
    if (s > 1e-12)
      shape = shape.rotate(
        (2 * Math.atan2(s, q[3]) * 180) / Math.PI,
        [0, 0, 0],
        q.slice(0, 3).map((v: number) => v / s),
      ) as Shape3D;
    shape = shape.translate(
      t.position_m.map((v: number) => v * 1000),
    ) as Shape3D;
    placed.set(i.name, shape);
  }
  const items = [...placed.entries()];
  const overlaps = [],
    seats = [];
  let checked = 0;
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++) {
      const [an, a] = items[i],
        [bn, b] = items[j];
      const common = a.intersect(b);
      try {
        const volume = isShape3D(common) ? measureVolume(common) : 0;
        assert.ok(Number.isFinite(volume));
        if (volume > 1e-6) overlaps.push({ a: an, b: bn, volume_mm3: volume });
      } finally {
        common.delete();
      }
      checked++;
    }
  // Check physical seating separately: zero interference alone also permits floating parts.
  const contractPath = process.env.AETHER_FIT_SEATS;
  if (contractPath)
    for (const [a, b, expected = 0] of JSON.parse(
      readFileSync(contractPath, "utf8"),
    )) {
      assert.ok(
        placed.has(a) && placed.has(b),
        `Missing seating pair: ${a}/${b}`,
      );
      const gap = measureDistanceBetween(placed.get(a)!, placed.get(b)!);
      seats.push({ a, b, gap_mm: gap, expected_mm: expected });
    }
  const result = {
    ...JSON.parse(readFileSync(join(out, "source.json"), "utf8")),
    parts: parts.size,
    instances: placed.size,
    checked_pairs: checked,
    overlaps,
    seats,
  };
  writeFileSync(
    join(out, "result.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result, null, 2));
  if (process.env.AETHER_FIT_BASELINE !== "1") {
    assert.deepEqual(
      overlaps,
      [],
      "Saved assembly contains interfering solids",
    );
    assert.deepEqual(
      seats.filter((s) => Math.abs(s.gap_mm - s.expected_mm) >= 0.005),
      [],
      "Unseated mating components",
    );
  }
} finally {
  for (const shape of placed.values()) shape.delete();
  for (const shape of parts.values()) shape.delete();
}
