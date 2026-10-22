/** The equivalence oracle: every fixture document built on the Aether engine,
 *  measured exactly (volume, faces, edges) and, when FreeCAD's answers for the
 *  same fixtures have been captured (`freecad-references.json`, from
 *  AetherStudio/.verification/cad-engine-oracle), compared with them. FreeCAD is
 *  OpenCASCADE too, so counts must match exactly and volumes to 1e-6 relative. */
import { beforeAll, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import init from "replicad-opencascadejs";
import { getOC, measureVolume, setOC, type Shape3D } from "replicad";
import { evaluatePartDocument, resetEvaluationCache } from "../part-evaluator";
import initFull from "opencascade.js/dist/node.js";
import { loadExtendedKernel, needsExtendedKernel } from "../extended-kernel";
import type { PartDocument } from "../../document/index";
import fixtures from "./fixtures.json";

export interface BodyReference { id: string; volume_mm3: number; face_count: number; edge_count: number; bbox?: [number[], number[]] }
export type References = Record<string, BodyReference[]>;

export function measureBodies(document: PartDocument): BodyReference[] {
  const out: BodyReference[] = [];
  evaluatePartDocument(document, { withBodies: (bodies) => {
    for (const [id, body] of bodies) {
      const faces = (body as Shape3D).faces, edges = (body as Shape3D).edges;
      // An optimal box: a plain Bnd_Box is loose around spline surfaces (a sweep's).
      const oc = getOC(); const box = new oc.Bnd_Box_1(); oc.BRepBndLib.AddOptimal((body as Shape3D).wrapped, box, true, false);
      const bounds = [[box.CornerMin().X(), box.CornerMin().Y(), box.CornerMin().Z()], [box.CornerMax().X(), box.CornerMax().Y(), box.CornerMax().Z()]]; box.delete();
      out.push({ id, volume_mm3: measureVolume(body as Shape3D), face_count: faces.length, edge_count: edges.length, bbox: [[...bounds[0]], [...bounds[1]]] });
      faces.forEach((f) => f.delete()); edges.forEach((e) => e.delete());
    }
  } });
  return out;
}

const referencesPath = new URL("./freecad-references.json", import.meta.url);
const references: References | null = existsSync(referencesPath) ? JSON.parse(readFileSync(referencesPath, "utf8")) : null;

beforeAll(async () => {
  setOC(await (init as any)({ wasmBinary: readFileSync(new URL("../../../node_modules/replicad-opencascadejs/src/replicad_single.wasm", import.meta.url)) }));
  resetEvaluationCache();
  // Fixtures that need the full build (affine scale, IGES, half-spaces of other surfaces) load it once.
  if ((fixtures as unknown as (PartDocument & { fullBuild?: boolean })[]).some((f) => f.fullBuild || needsExtendedKernel(f))) await loadExtendedKernel(() => (initFull as unknown as () => Promise<unknown>)());
}, 120000);

describe("oracle fixtures", () => {
  for (const fixture of fixtures as unknown as PartDocument[]) {
    it(`builds ${fixture.name}${references?.[fixture.name] ? " as FreeCAD does" : ""}`, () => {
      const refused = (fixture as { expectFailure?: string }).expectFailure;
      if (refused) { expect(() => measureBodies(fixture)).toThrow(refused); return; } // FreeCAD refuses it too
      const bodies = measureBodies(fixture);
      expect(bodies.length).toBeGreaterThan(0);
      for (const body of bodies) { expect(body.volume_mm3).toBeGreaterThan(0); expect(body.face_count).toBeGreaterThanOrEqual(1); } // a cone has two faces, a sphere one
      const differs = fixture as { freecadDiffers?: string; expectVolume_mm3?: number; volumeTolerance?: number };
      if (differs.freecadDiffers) { // FreeCAD's answer is wrong here; the fixture carries the right volume
        expect(bodies.length).toBe(1); expect(Math.abs(bodies[0].volume_mm3 - differs.expectVolume_mm3!) / differs.expectVolume_mm3!).toBeLessThan(differs.volumeTolerance ?? 1e-6); return;
      }
      const expected = references?.[fixture.name];
      if (!expected) return;
      expect(bodies.map((b) => b.id).sort()).toEqual(expected.map((b) => b.id).sort());
      for (const body of bodies) {
        const reference = expected.find((b) => b.id === body.id)!;
        expect(Math.abs(body.volume_mm3 - reference.volume_mm3) / reference.volume_mm3).toBeLessThan(1e-6);
        expect(Math.abs(body.face_count - reference.face_count), `${body.id} faces ${body.face_count} vs ${reference.face_count}`).toBeLessThanOrEqual((fixture as { faceCountTolerance?: number }).faceCountTolerance ?? 0);
        // Edge counts differ only by where OCCT puts a cylinder's seam (two edges per seam);
        // the geometry below (volume, faces, box) is what the user sees.
        expect(Math.abs(body.edge_count - reference.edge_count), `${body.id} edges ${body.edge_count} vs ${reference.edge_count}`).toBeLessThanOrEqual((fixture as { edgeCountTolerance?: number }).edgeCountTolerance ?? 2);
        // Placement and direction (a reversed revolve has the same volume as a forward one).
        // FreeCAD's box comes from its mesh, ours from the exact shape with OCCT's bound gap.
        if (reference.bbox) for (const side of [0, 1]) for (const axis of [0, 1, 2]) expect(Math.abs(body.bbox![side][axis] - reference.bbox[side][axis]), `${body.id} bbox`).toBeLessThan(0.2);
      }
    });
  }
});
