/** The Scifirobot example (120 features, 39 bodies, authored for FreeCAD) rebuilt tip by tip
 *  on the Aether engine against the volumes and face counts FreeCAD recorded in its proof. */
import { beforeAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import init from "replicad-opencascadejs";
import { setOC, measureVolume } from "replicad";
import { evaluatePartDocument } from "./part-evaluator";
beforeAll(async () => { setOC(await (init as any)({ wasmBinary: readFileSync(new URL("../../node_modules/replicad-opencascadejs/src/replicad_single.wasm", import.meta.url)) })); }, 60000);
it("rebuilds every Scifirobot body tip as FreeCAD recorded it", () => {
  const dir = new URL("../../../scripts/examples/scifirobot/generated/", import.meta.url).pathname;
  const doc = JSON.parse(readFileSync(dir + "Scifirobot.acpart", "utf8")), presentation = JSON.parse(readFileSync(dir + "presentation.json", "utf8")), proof = JSON.parse(readFileSync(dir + "proof.json", "utf8"));
  const owner: Record<string, string> = Object.fromEntries(presentation.features.map((r: any) => [r.id, r.bodyID]));
  const expected = new Map<string, any>(proof.tips.map((t: any) => [t.featureID, t]));
  const out: string[] = []; let ok = 0;
  for (const bodyId of presentation.bodies.map((b: any) => b.id)) {
    const own = doc.features.filter((f: any) => owner[f.id] === bodyId);
    own.forEach((feature: any, i: number) => {
      if (feature.type === "profile" || feature.type === "sketch") return;
      const want = expected.get(feature.id);
      try {
        let volume = NaN, faces = 0;
        evaluatePartDocument({ ...doc, documentId: "scifi-" + bodyId, features: own.slice(0, i + 1) }, { withBodies: (b) => { const shape: any = [...b.values()][0]; volume = measureVolume(shape); const fs = shape.faces; faces = fs.length; fs.forEach((f: any) => f.delete()); } });
        if (!want) { out.push(`${feature.id}: no proof entry`); return; }
        const rel = Math.abs(volume - want.volume_mm3) / want.volume_mm3;
        if (rel > 1e-6 || faces !== want.faces) out.push(`${feature.id} (${feature.type}): volume ${volume.toFixed(3)} vs ${want.volume_mm3.toFixed(3)} (rel ${rel.toExponential(2)}), faces ${faces} vs ${want.faces}`); else ok++;
      } catch (e) { out.push(`${feature.id} (${feature.type}): FAILED ${(e as Error).message.slice(0, 140)}`); }
    });
  }
  expect(out, out.join("\n")).toEqual([]);
  expect(ok).toBe(expected.size);
}, 600000);
