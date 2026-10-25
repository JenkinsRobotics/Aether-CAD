import { beforeAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import init from "replicad-opencascadejs";
import { setOC, measureVolume, type Shape3D } from "replicad";
import initFull from "opencascade.js/dist/node.js";
import { loadExtendedKernel, needsExtendedKernel } from "./extended-kernel";
import { evaluatePartDocument } from "./part-evaluator";
import fixtures from "./oracle/fixtures.json";
import { parsePartDocument, type PartDocument } from "../document/index";
beforeAll(async () => {
  setOC(await (init as any)({ wasmBinary: readFileSync(new URL("../../node_modules/replicad-opencascadejs/src/replicad_single.wasm", import.meta.url)) }));
  await loadExtendedKernel(() => (initFull as unknown as () => Promise<unknown>)());
}, 120000);
const fixture = (name: string) => parsePartDocument(JSON.stringify((fixtures as unknown as PartDocument[]).find((f) => f.name === name)!));
const bodies = (doc: PartDocument) => { const out: { id: string; volume: number; bounds: number[][] }[] = []; evaluatePartDocument(doc, { withBodies: (b) => { for (const [id, s] of b) out.push({ id, volume: measureVolume(s as Shape3D), bounds: (s as Shape3D).boundingBox.bounds.map((v) => [...v].map((x) => +x.toFixed(3) + 0)) }); } }); return out; };

it("knows which documents need the full build", () => {
  expect(needsExtendedKernel(fixture("transform-scale-xyz"))).toBe(true);
  expect(needsExtendedKernel(fixture("import-iges-solid"))).toBe(true);
  expect(needsExtendedKernel(fixture("extrude-up-to-cone"))).toBe(true);
  expect(needsExtendedKernel(fixture("transform-scale"))).toBe(false);
  expect(needsExtendedKernel(fixture("extrude-up-to-cylinder"))).toBe(false);
});

it("scales a part differently on each axis about the chosen centre (FreeCAD's transformGeometry)", () => {
  const [plate] = bodies(fixture("transform-scale-xyz"));
  expect(plate.volume).toBeCloseTo(48000, 4); // 2 × 1 × 0.5
  expect(plate.bounds).toEqual([[-60, -20, 0], [60, 20, 10]]);
});

it("imports IGES solids, sewing surface-only files into closed solids", () => {
  const [cube] = bodies(fixture("import-iges-solid"));
  expect(cube.id).toBe("oracle-import-iges-solid:body-m");
  expect(cube.volume).toBeCloseTo(1000, 3);
});

it("stops an extrusion at a conical face through the full build's half-space", () => {
  const [plate] = bodies(fixture("extrude-up-to-cone"));
  // The boss column (x 6–16) leaves the lower nappe highest at its innermost point: z = 60 − 6·1.5.
  expect(plate.bounds[1][2]).toBeCloseTo(60 - 6 * 1.5, 2);
  expect(plate.volume).toBeGreaterThan(48000);
});
