import { insertFeature, setFeatureSuppressed, type PartDocument, type PartFeature } from "@aether/core/document";
import { cadCommands } from "./cad-command-registry";
import { cadSelection } from "./cad-selection-store";
import { analyzePart } from "./modeling/part-analysis";
import { cadPresentation } from "./cad-presentation-store";

/** Convert Mesh (SolidCraft's mesh.convert): the selected constant-section mesh import becomes a
 *  sketch on its lower cap plus an extrusion, and the import is suppressed (kept in history). */
export function mountMeshConvertCommand(getDocument: () => PartDocument | null, apply: (doc: PartDocument) => Promise<void>) {
  const report = (message: string, error = false) => cadPresentation.patch({ statusMessage: message, statusTone: error ? "error" : "success" });
  const release = cadCommands.register("mesh-convert", () => {
    const doc = getDocument();
    if (!doc) { report("Open a part first.", true); return; }
    const meshImports = doc.features.filter((f) => f.type === "import-cad" && f.meshMode === "reference" && !f.suppressed) as (PartFeature & { bodyId: string; name: string })[];
    const picked = new Set(cadSelection.snapshot().items.map((i) => i.partId));
    const source = meshImports.find((f) => picked.has(f.bodyId)) ?? (meshImports.length === 1 ? meshImports[0] : undefined);
    if (!source) { report(meshImports.length ? "Select the mesh body to convert." : "This part has no mesh reference to convert.", true); return; }
    void analyzePart(doc, { kind: "mesh_convert" as never, bodyIds: [source.bodyId] } as never).then(async (result) => {
      const profile = result.measurements[0] as { frame: { originMillimeters: [number, number, number]; xDirection: [number, number, number]; normal: [number, number, number] }; depthMillimeters: number; contours: unknown[] };
      const sketchId = crypto.randomUUID(), extrudeId = crypto.randomUUID();
      let next = insertFeature(structuredClone(doc), { id: sketchId, type: "profile", name: `${source.name} profile`, plane: "XY", offsetMillimeters: 0, frame: profile.frame, suppressed: false, profile: { type: "drawing", contours: profile.contours } } as PartFeature);
      next = insertFeature(next, { id: extrudeId, type: "extrude", name: `${source.name} solid`, profileFeatureId: sketchId, distanceMillimeters: Math.round(profile.depthMillimeters * 1e6) / 1e6, operation: "new", suppressed: false } as PartFeature);
      next = setFeatureSuppressed(next, source.id, true);
      await apply(next);
      report(`${source.name} converted: a ${profile.contours.length}-curve sketch extruded ${profile.depthMillimeters.toFixed(3)} mm. The mesh import is suppressed, not deleted.`);
    }).catch((error: unknown) => report(error instanceof Error ? error.message : String(error), true));
  });
  cadCommands.setEnabled("mesh-convert", true);
  return release;
}
