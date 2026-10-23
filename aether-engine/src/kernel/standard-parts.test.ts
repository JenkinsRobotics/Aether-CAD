import { beforeAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import init from "replicad-opencascadejs";
import { measureVolume, setOC, type Shape3D } from "replicad";
import { evaluatePartDocument } from "./part-evaluator";
import { STANDARD_PARTS, standardPartDocument, standardPartFromProperties, standardPartIssues, standardPartLibrary, standardPartProperties, standardPartVolume, type StandardPartRequest } from "../document/index";

beforeAll(async () => {
  setOC(await (init as any)({ wasmBinary: readFileSync(new URL("../../node_modules/replicad-opencascadejs/src/replicad_single.wasm", import.meta.url)) }));
}, 30000);
const volume = (r: StandardPartRequest) => { let v = 0; evaluatePartDocument(standardPartDocument(r), { withBodies: (b) => { for (const body of b.values()) v += measureVolume(body as Shape3D); } }); return v; };

it("builds every family at one size with the volume its dimensions give", () => {
  const requests: StandardPartRequest[] = [
    { family: "socket_head_cap_screw", size: "M6", length: 20 }, { family: "hex_bolt", size: "M8", length: 30 }, { family: "hex_nut", size: "M8" },
    { family: "washer", size: "M6" }, { family: "set_screw", size: "M5", length: 8 }, { family: "dowel_pin", size: "6", length: 20 }, { family: "bearing", size: "608" },
  ];
  for (const r of requests) expect(volume(r)).toBeCloseTo(standardPartVolume(r), 3);
});

it("lists the catalogue, refuses unknown sizes and round-trips its properties", () => {
  expect(standardPartLibrary().map((f) => f.family)).toEqual(Object.keys(STANDARD_PARTS));
  expect(standardPartLibrary("bearing")[0].dimensions?.["608"]).toEqual({ d: 8, D: 22, B: 7 });
  expect(standardPartIssues({ family: "hex_nut", size: "M7" })[0]).toMatch(/comes in M3/);
  expect(standardPartIssues({ family: "hex_bolt", size: "M6" })[0]).toMatch(/needs a length/);
  const r: StandardPartRequest = { family: "hex_bolt", size: "M6", length: 25 };
  expect(standardPartFromProperties(standardPartProperties(r))).toEqual(r);
  expect(standardPartDocument(r).name).toBe("ISO 4017 M6 × 25");
});
