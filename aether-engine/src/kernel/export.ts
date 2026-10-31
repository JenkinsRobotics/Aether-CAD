/** STEP and mesh output of an evaluated document (FreeCAD's rules from
 *  `aether_freecad/exporting.py`): exact B-rep for STEP; STL, OBJ, glTF and 3MF
 *  meshed at the chosen chord tolerance, never the display mesh. */
import { makeCompound, type AnyShape, type Shape3D } from "replicad";
import { evaluatePartDocument } from "./part-evaluator";
import { availableBodies, type PartDocument } from "../document/index";
import type { ExportOptions, ExportResult } from "../contracts/index";
import { mesh3MF, meshGLB, meshOBJ, type NamedMesh } from "./mesh-writers";

const FORMATS = ["step", "stl", "obj", "gltf", "3mf"] as const;

export async function exportPart(document: PartDocument, options: ExportOptions): Promise<ExportResult> {
  if (!FORMATS.includes(options.format)) throw new Error("Choose STEP, STL, OBJ, glTF or 3MF.");
  let shapes = new Map<string, Shape3D>();
  evaluatePartDocument(document, { withBodies: (bodies) => { shapes = new Map(bodies); } });
  const ids = options.bodyIds ?? null;
  if (ids !== null && (!ids.length || ids.some((id) => !shapes.has(id)))) throw new Error("An export body is unavailable.");
  const selectedEntries = [...shapes].filter(([id]) => ids === null || ids.includes(id));
  const selected = selectedEntries.map(([, shape]) => shape);
  if (!selected.length) throw new Error("Import or create geometry before exporting.");
  const tolerance = options.toleranceMillimeters ?? 0.1;
  if (!Number.isFinite(tolerance) || tolerance < 0.001 || tolerance > 5) throw new Error("Mesh tolerance must be between 0.001 and 5 mm.");
  if (options.format === "obj" || options.format === "gltf" || options.format === "3mf") {
    const names = new Map(availableBodies(document).map((body) => [body.id, body.name]));
    const meshes: NamedMesh[] = selectedEntries.map(([id, shape]) => {
      const mesh = shape.mesh({ tolerance, angularTolerance: 0.35 });
      return { name: names.get(id) ?? id, mesh: { vertices: Float32Array.from(mesh.vertices), triangles: Uint32Array.from(mesh.triangles) } };
    });
    const bytes = options.format === "obj" ? new TextEncoder().encode(meshOBJ(meshes)) : options.format === "gltf" ? meshGLB(meshes) : mesh3MF(meshes);
    if (bytes.byteLength > 64 * 1024 * 1024) throw new Error("Export exceeds the 64 MB download limit.");
    return { format: options.format, units: "mm", body_count: selected.length, bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer };
  }
  // makeCompound consumes its inputs: hand it clones, never the cached bodies.
  const whole: AnyShape = selected.length === 1 ? selected[0] : makeCompound(selected.map((shape) => shape.clone()));
  try {
    const blob = options.format === "step" ? whole.blobSTEP() : whole.blobSTL({ tolerance, angularTolerance: 0.35, binary: true });
    const bytes = await blob.arrayBuffer();
    if (bytes.byteLength > 64 * 1024 * 1024) throw new Error("Export exceeds the 64 MB download limit.");
    return { format: options.format, units: "mm", body_count: selected.length, bytes };
  } finally { if (whole !== selected[0]) whole.delete(); }
}
