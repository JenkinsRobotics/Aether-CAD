import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { translateDocument } from "../freecad-translate";
import { createSprocketDocument, defaultSprocketParameters, reopenTestDocument, stageDocument } from "./sprocket";

it.skipIf(process.env.AETHER_FREECAD_INTEGRATION !== "1")("rebuilds every sprocket stage, real edits and serialized rollback through FreeCAD", () => {
  const sample = createSprocketDocument(), changed = createSprocketDocument({ ...defaultSprocketParameters, teeth: 11, boreDiameterMillimeters: 18 });
  const documents = [...Array.from({ length: 8 }, (_, index) => stageDocument(sample.document, sample.stages, index)), changed.document,
    reopenTestDocument(stageDocument(sample.document, sample.stages, 3)), reopenTestDocument(sample.document)];
  const jobs = documents.map(document => { const t = translateDocument(document); expect(t.untranslated).toEqual([]); return { protocol: 1, features: t.features }; });
  const result = spawnSync(process.env.AETHER_PYTHON ?? "python3", ["-c", `
import json,sys
sys.path.insert(0,sys.argv[1])
from aether_freecad import FreeCADEngine
from aether_freecad.protocol import job_from_json
with FreeCADEngine() as engine:
 out=[]
 for job in json.load(sys.stdin):
  r=engine.build(job_from_json(job))
  out.append({'status':r.status,'diagnostics':r.diagnostics,'bodies':[{'id':b.id,'volume':b.volume_mm3,'faces':b.face_count,'triangles':len(b.triangles)//3,'edges':len(b.edge_lines)//6} for b in r.bodies]})
 print(json.dumps(out))
`, `${process.cwd()}/freecad-engine`], { input: JSON.stringify(jobs), encoding: "utf8", timeout: 120000 });
  if (result.status !== 0) throw new Error(result.stderr || String(result.error));
  const results = JSON.parse(result.stdout) as { status: string; diagnostics: unknown[]; bodies: { id: string; volume: number; faces: number; triangles: number; edges: number }[] }[];
  results.forEach((r, index) => { expect(r.status, `stage ${index}: ${JSON.stringify(r)}`).toBe("ok"); expect(r.diagnostics, `stage ${index}`).toEqual([]); });
  expect(results[0].bodies).toHaveLength(0);
  for (const r of results.slice(1)) { expect(r.bodies).toHaveLength(1); expect(r.bodies[0].id).toBe("test-sprocket-body"); expect(r.bodies[0].triangles).toBeGreaterThan(100); expect(r.bodies[0].edges).toBeGreaterThan(0); }
  const blankVolume = Math.PI * (14 ** 2 * 32 + (23 ** 2 - 14 ** 2) * 8);
  expect(results[1].bodies[0].volume).toBeCloseTo(blankVolume, 5);
  for (let i = 2; i <= 7; i++) expect(results[i].bodies[0].volume, `cut ${i}`).toBeLessThan(results[i - 1].bodies[0].volume);
  expect(results[8].bodies[0].volume).not.toBeCloseTo(results[7].bodies[0].volume, 3);
  expect(results[9].bodies).toEqual(results[3].bodies);
  expect(results[10].bodies).toEqual(results[7].bodies);
  console.log("Native sprocket stages", JSON.stringify(results));
}, 125000);
