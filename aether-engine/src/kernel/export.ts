/** STEP and STL output of an evaluated document (FreeCAD's rules from
 *  `aether_freecad/exporting.py`): exact B-rep for STEP, a mesh at the chosen
 *  chord tolerance for STL, never the display mesh. */
import { makeCompound, type AnyShape, type Shape3D } from "replicad";
import { evaluatePartDocument } from "./part-evaluator";
import type { PartDocument } from "../document/index";
import type { ExportOptions, ExportResult } from "../contracts/index";

export async function exportPart(document: PartDocument, options: ExportOptions): Promise<ExportResult> {
  if (options.format !== "step" && options.format !== "stl") throw new Error("Choose STEP or STL.");
  let shapes = new Map<string, Shape3D>();
  evaluatePartDocument(document, { withBodies: (bodies) => { shapes = new Map(bodies); } });
  const ids = options.bodyIds ?? null;
  if (ids !== null && (!ids.length || ids.some((id) => !shapes.has(id)))) throw new Error("An export body is unavailable.");
  const selected = [...shapes].filter(([id]) => ids === null || ids.includes(id)).map(([, shape]) => shape);
  if (!selected.length) throw new Error("Import or create geometry before exporting.");
  const tolerance = options.toleranceMillimeters ?? 0.1;
  if (!Number.isFinite(tolerance) || tolerance < 0.001 || tolerance > 5) throw new Error("Mesh tolerance must be between 0.001 and 5 mm.");
  // makeCompound consumes its inputs: hand it clones, never the cached bodies.
  const whole: AnyShape = selected.length === 1 ? selected[0] : makeCompound(selected.map((shape) => shape.clone()));
  try {
    const blob = options.format === "step" ? whole.blobSTEP() : whole.blobSTL({ tolerance, angularTolerance: 0.35, binary: true });
    const bytes = await blob.arrayBuffer();
    if (bytes.byteLength > 64 * 1024 * 1024) throw new Error("Export exceeds the 64 MB download limit.");
    return { format: options.format, units: "mm", body_count: selected.length, bytes };
  } finally { if (whole !== selected[0]) whole.delete(); }
}
