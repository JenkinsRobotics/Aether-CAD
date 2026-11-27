/** STEP and mesh output of an evaluated document (FreeCAD's rules from
 *  `aether_freecad/exporting.py`): exact B-rep for STEP; STL (binary or ASCII), OBJ,
 *  glTF and 3MF meshed at the chosen chord tolerance, plus reference mesh fallback. */
import { makeCompound, type AnyShape, type Shape3D } from "replicad";
import { evaluatePartDocument } from "./part-evaluator";
import { availableBodies, findPhysicalMaterial, type PartDocument } from "../document/index";
import type { ExportOptions, ExportResult } from "../contracts/index";
import { mesh3MFCompressed, meshGLB, meshOBJ, meshOBJWithMTL, type NamedMesh } from "./mesh-writers";
import { binarySTL } from "./mesh-formats";

const FORMATS = ["step", "stl", "obj", "gltf", "3mf"] as const;

function asciiSTL(meshes: NamedMesh[]): Uint8Array {
  const lines: string[] = ["solid aether"];
  for (const { mesh } of meshes) {
    const v = mesh.vertices, t = mesh.triangles;
    for (let i = 0; i < t.length; i += 3) {
      const i0 = t[i] * 3, i1 = t[i + 1] * 3, i2 = t[i + 2] * 3;
      const ax = v[i1] - v[i0], ay = v[i1 + 1] - v[i0 + 1], az = v[i1 + 2] - v[i0 + 2];
      const bx = v[i2] - v[i0], by = v[i2 + 1] - v[i0 + 1], bz = v[i2 + 2] - v[i0 + 2];
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const len = Math.hypot(nx, ny, nz);
      if (len > 1e-12) { nx /= len; ny /= len; nz /= len; }
      lines.push(
        `  facet normal ${nx.toExponential(6)} ${ny.toExponential(6)} ${nz.toExponential(6)}`,
        `    outer loop`,
        `      vertex ${v[i0]} ${v[i0 + 1]} ${v[i0 + 2]}`,
        `      vertex ${v[i1]} ${v[i1 + 1]} ${v[i1 + 2]}`,
        `      vertex ${v[i2]} ${v[i2 + 1]} ${v[i2 + 2]}`,
        `    endloop`,
        `  endfacet`,
      );
    }
  }
  lines.push("endsolid aether", "");
  return new TextEncoder().encode(lines.join("\n"));
}

export async function exportPart(document: PartDocument, options: ExportOptions): Promise<ExportResult> {
  if (!FORMATS.includes(options.format)) throw new Error("Choose STEP, STL, OBJ, glTF or 3MF.");
  let shapes = new Map<string, Shape3D>();
  let refMeshes = new Map<string, { vertices: Float32Array; triangles: Uint32Array }>();
  evaluatePartDocument(document, {
    withBodies: (bodies) => { shapes = new Map(bodies); },
    withMeshes: (meshes) => { refMeshes = new Map(meshes); },
  });
  const ids = options.bodyIds ?? null;
  const availableKeys = new Set([...shapes.keys(), ...(options.format === "step" ? [] : refMeshes.keys())]);
  if (ids !== null && (!ids.length || ids.some((id) => !availableKeys.has(id)))) throw new Error("An export body is unavailable.");
  const selectedEntries = [...shapes].filter(([id]) => ids === null || ids.includes(id));
  const selectedRefEntries = options.format === "step" ? [] : [...refMeshes].filter(([id]) => !shapes.has(id) && (ids === null || ids.includes(id)));
  const totalBodies = selectedEntries.length + selectedRefEntries.length;
  if (!totalBodies) throw new Error("Import or create geometry before exporting.");
  const tolerance = options.toleranceMillimeters ?? 0.1;
  if (!Number.isFinite(tolerance) || tolerance < 0.001 || tolerance > 5) throw new Error("Mesh tolerance must be between 0.001 and 5 mm.");

  const names = new Map(availableBodies(document).map((body) => [body.id, body.name]));
  const collectMeshes = (): NamedMesh[] => [
    ...selectedEntries.map(([id, shape]) => {
      const mesh = shape.mesh({ tolerance, angularTolerance: 0.35 });
      return { name: names.get(id) ?? id, mesh: { vertices: Float32Array.from(mesh.vertices), triangles: Uint32Array.from(mesh.triangles) } };
    }),
    ...selectedRefEntries.map(([id, mesh]) => ({ name: names.get(id) ?? id, mesh })),
  ];

  if (options.format === "obj" || options.format === "gltf" || options.format === "3mf") {
    const meshes = collectMeshes();
    const bytes = options.format === "obj"
      ? new TextEncoder().encode(meshOBJ(meshes))
      : options.format === "gltf"
        ? meshGLB(meshes)
        : await mesh3MFCompressed(meshes);
    if (bytes.byteLength > 64 * 1024 * 1024) throw new Error("Export exceeds the 64 MB download limit.");
    return { format: options.format, units: "mm", body_count: totalBodies, bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer };
  }
  if (options.format === "stl" && (options.ascii || selectedRefEntries.length > 0)) {
    const meshes = collectMeshes();
    let bytes: Uint8Array;
    if (options.ascii) {
      bytes = asciiSTL(meshes);
    } else {
      // Combine all solid + reference meshes into one binary STL buffer.
      const totalV = meshes.reduce((s, m) => s + m.mesh.vertices.length, 0);
      const totalT = meshes.reduce((s, m) => s + m.mesh.triangles.length, 0);
      const verts = new Float32Array(totalV);
      const tris = new Uint32Array(totalT);
      let vOff = 0, tOff = 0;
      for (const m of meshes) {
        verts.set(m.mesh.vertices, vOff);
        const baseVert = vOff / 3;
        for (let i = 0; i < m.mesh.triangles.length; i++) tris[tOff + i] = m.mesh.triangles[i] + baseVert;
        vOff += m.mesh.vertices.length;
        tOff += m.mesh.triangles.length;
      }
      bytes = binarySTL({ vertices: verts, triangles: tris }, 1);
    }
    if (bytes.byteLength > 64 * 1024 * 1024) throw new Error("Export exceeds the 64 MB download limit.");
    return { format: "stl", units: "mm", body_count: totalBodies, bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer };
  }

  const selected = selectedEntries.map(([, shape]) => shape);
  // makeCompound consumes its inputs: hand it clones, never the cached bodies.
  const whole: AnyShape = selected.length === 1 ? selected[0] : makeCompound(selected.map((shape) => shape.clone()));
  try {
    const blob = options.format === "step" ? whole.blobSTEP() : whole.blobSTL({ tolerance, angularTolerance: 0.35, binary: true });
    const bytes = await blob.arrayBuffer();
    if (bytes.byteLength > 64 * 1024 * 1024) throw new Error("Export exceeds the 64 MB download limit.");
    return { format: options.format, units: "mm", body_count: selected.length, bytes };
  } finally { if (whole !== selected[0]) whole.delete(); }
}

/** Export Wavefront OBJ together with a companion `.mtl` material library using each body's
 *  assigned physical material and color (`bodyProperties`). */
export function exportPartOBJWithMTL(
  document: PartDocument,
  options?: { bodyIds?: string[] | null; toleranceMillimeters?: number; mtlFileName?: string },
): { obj: string; mtl: string; bodyCount: number } {
  let shapes = new Map<string, Shape3D>();
  let refMeshes = new Map<string, { vertices: Float32Array; triangles: Uint32Array }>();
  evaluatePartDocument(document, {
    withBodies: (bodies) => { shapes = new Map(bodies); },
    withMeshes: (meshes) => { refMeshes = new Map(meshes); },
  });
  const ids = options?.bodyIds ?? null;
  const tol = options?.toleranceMillimeters ?? 0.1;
  const names = new Map(availableBodies(document).map((b) => [b.id, b.name]));
  const colorFor = (id: string) => {
    const props = document.bodyProperties?.[id];
    const card = props?.material?.name ? findPhysicalMaterial(props.material.name) : undefined;
    return { materialName: props?.material?.name ?? names.get(id) ?? id, colorHex: props?.appearance?.color ?? card?.colorHex };
  };
  const meshes: NamedMesh[] = [
    ...[...shapes].filter(([id]) => ids === null || ids.includes(id)).map(([id, shape]) => {
      const m = shape.mesh({ tolerance: tol, angularTolerance: 0.35 });
      return { name: names.get(id) ?? id, mesh: { vertices: Float32Array.from(m.vertices), triangles: Uint32Array.from(m.triangles) }, ...colorFor(id) };
    }),
    ...[...refMeshes].filter(([id]) => !shapes.has(id) && (ids === null || ids.includes(id))).map(([id, mesh]) => ({
      name: names.get(id) ?? id, mesh, ...colorFor(id),
    })),
  ];
  if (!meshes.length) throw new Error("Import or create geometry before exporting OBJ+MTL.");
  const { obj, mtl } = meshOBJWithMTL(meshes, options?.mtlFileName ?? `${document.name || "part"}.mtl`);
  return { obj, mtl, bodyCount: meshes.length };
}
