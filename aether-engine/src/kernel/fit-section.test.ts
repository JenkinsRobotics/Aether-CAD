import { beforeAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import init from "replicad-opencascadejs";
import { setOC } from "replicad";
import { fitLinesAndArcs, sketchSectionContours } from "./sketch-section";
import type { PartDocument } from "../document/index";

beforeAll(async () => {
  setOC(await (init as any)({ wasmBinary: readFileSync(require.resolve("replicad-opencascadejs/src/replicad_single.wasm")) }));
}, 60000);

/** A 64-sided prism of radius 10 (z 0..20) and a 30 × 10 box beside it, as one OBJ mesh reference. */
function meshDocument(): PartDocument {
  const lines: string[] = [], n = 64;
  for (let i = 0; i < n; i++) { const a = (2 * Math.PI * i) / n; lines.push(`v ${10 * Math.cos(a)} ${10 * Math.sin(a)} 0`, `v ${10 * Math.cos(a)} ${10 * Math.sin(a)} 20`); }
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; lines.push(`f ${2 * i + 1} ${2 * j + 1} ${2 * j + 2} ${2 * i + 2}`); }
  const b = 2 * n;
  for (const [x, y, z] of [[20, -5, 0], [50, -5, 0], [50, 5, 0], [20, 5, 0], [20, -5, 20], [50, -5, 20], [50, 5, 20], [20, 5, 20]]) lines.push(`v ${x} ${y} ${z}`);
  for (const f of [[1, 4, 3, 2], [5, 6, 7, 8], [1, 2, 6, 5], [2, 3, 7, 6], [3, 4, 8, 7], [4, 1, 5, 8]]) lines.push(`f ${f.map((k) => k + b).join(" ")}`);
  return { format: "aether-part", formatVersion: 21, documentId: "m", name: "Mesh", units: "millimeter", features: [
    { id: "m", type: "import-cad", name: "Scan.obj", suppressed: false, operation: "new", bodyId: "m:body-m", sourceName: "Scan.obj", dataBase64: btoa(lines.join("\n")), format: "obj", meshMode: "reference", meshUnits: "mm" }] } as unknown as PartDocument;
}

it("fits a mesh's section with the sketch plane as lines and arcs", () => {
  const contours = sketchSectionContours(meshDocument(), { originMillimeters: [0, 0, 7], xDirection: [1, 0, 0], normal: [0, 0, 1] }, "fit");
  const circle = contours.find((c) => c.type === "circle");
  expect(circle).toMatchObject({ type: "circle" });
  expect((circle as { radius: number }).radius).toBeCloseTo(10, 1);
  const box = contours.find((c) => c.type === "path") as { segments: { type: string }[] };
  expect(box.segments.map((s) => s.type)).toEqual(["line", "line", "line", "line"]);
  // Nothing where the plane misses the mesh.
  expect(sketchSectionContours(meshDocument(), { originMillimeters: [0, 0, 50], xDirection: [1, 0, 0], normal: [0, 0, 1] }, "fit")).toEqual([]);
});

it("fits an open polyline as a line, then an arc", () => {
  const arc = Array.from({ length: 17 }, (_, i) => [10 + 5 * Math.sin((i / 16) * Math.PI / 2), 5 - 5 * Math.cos((i / 16) * Math.PI / 2)] as [number, number]);
  const points: [number, number][] = [[0, 0], [5, 0], [10, 0], ...arc.slice(1)];
  const [path] = fitLinesAndArcs(points, 0.01) as { type: "path"; segments: { type: string }[] }[];
  expect(path.segments.map((s) => s.type)).toEqual(["line", "arc"]);
});
