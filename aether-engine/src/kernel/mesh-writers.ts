/** Mesh file writers for export: Wavefront OBJ, glTF 2.0 binary (GLB) and 3MF.
 *  Each takes the kernel's tessellation; none reads a display mesh. Units in: mm. */
import { flatNormals, type TriangleMesh } from "./mesh-formats";

export interface NamedMesh { name: string; mesh: TriangleMesh }

const safeName = (name: string) => name.replace(/[\r\n]/g, " ").trim() || "Body";

/** OBJ in millimetres: one object per body, 1-based shared vertex indices. */
export function meshOBJ(meshes: NamedMesh[]): string {
  const lines = ["# Aether CAD export, millimetres"];
  let offset = 1;
  for (const { name, mesh } of meshes) {
    lines.push(`o ${safeName(name)}`);
    for (let i = 0; i < mesh.vertices.length; i += 3) lines.push(`v ${mesh.vertices[i]} ${mesh.vertices[i + 1]} ${mesh.vertices[i + 2]}`);
    for (let i = 0; i < mesh.triangles.length; i += 3) lines.push(`f ${mesh.triangles[i] + offset} ${mesh.triangles[i + 1] + offset} ${mesh.triangles[i + 2] + offset}`);
    offset += mesh.vertices.length / 3;
  }
  return lines.join("\n") + "\n";
}

/** GLB in metres with +Y up (glTF convention): CAD (x, y, z) becomes (x, z, -y).
 *  Vertices are unwelded so every triangle carries its flat normal. */
export function meshGLB(meshes: NamedMesh[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const bufferViews: object[] = [], accessors: object[] = [], gltfMeshes: object[] = [], nodes: object[] = [];
  let byteOffset = 0;
  const pushView = (bytes: Uint8Array, target: number) => {
    chunks.push(bytes); const view = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset, byteLength: bytes.byteLength, target });
    byteOffset += bytes.byteLength;
    const pad = (4 - (bytes.byteLength % 4)) % 4;
    if (pad) { chunks.push(new Uint8Array(pad)); byteOffset += pad; }
    return view;
  };
  for (const { name, mesh } of meshes) {
    const count = mesh.triangles.length, normals = flatNormals(mesh);
    const positions = new Float32Array(count * 3), normal = new Float32Array(count * 3), indices = new Uint32Array(count);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < count; i++) {
      const v = mesh.triangles[i] * 3, n = Math.floor(i / 3) * 9;
      const p = [mesh.vertices[v] / 1000, mesh.vertices[v + 2] / 1000, -mesh.vertices[v + 1] / 1000];
      const nn = [normals[n], normals[n + 2], -normals[n + 1]];
      for (let k = 0; k < 3; k++) { positions[i * 3 + k] = p[k]; normal[i * 3 + k] = nn[k]; min[k] = Math.min(min[k], p[k]); max[k] = Math.max(max[k], p[k]); }
      indices[i] = i;
    }
    const position = accessors.length;
    accessors.push({ bufferView: pushView(new Uint8Array(positions.buffer), 34962), componentType: 5126, count, type: "VEC3", min, max });
    accessors.push({ bufferView: pushView(new Uint8Array(normal.buffer), 34962), componentType: 5126, count, type: "VEC3" });
    accessors.push({ bufferView: pushView(new Uint8Array(indices.buffer), 34963), componentType: 5125, count, type: "SCALAR" });
    nodes.push({ name: safeName(name), mesh: gltfMeshes.length });
    gltfMeshes.push({ name: safeName(name), primitives: [{ attributes: { POSITION: position, NORMAL: position + 1 }, indices: position + 2, mode: 4 }] });
  }
  const json = JSON.stringify({ asset: { version: "2.0", generator: "Aether CAD" }, scene: 0, scenes: [{ nodes: nodes.map((_, i) => i) }], nodes, meshes: gltfMeshes, accessors, bufferViews, buffers: [{ byteLength: byteOffset }] });
  const jsonBytes = new TextEncoder().encode(json), jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  const total = 12 + 8 + jsonBytes.length + jsonPad + 8 + byteOffset;
  const out = new Uint8Array(total), view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, total, true);
  view.setUint32(12, jsonBytes.length + jsonPad, true); view.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20); out.fill(0x20, 20 + jsonBytes.length, 20 + jsonBytes.length + jsonPad);
  let at = 20 + jsonBytes.length + jsonPad;
  view.setUint32(at, byteOffset, true); view.setUint32(at + 4, 0x004e4942, true); at += 8;
  for (const chunk of chunks) { out.set(chunk, at); at += chunk.byteLength; }
  return out;
}

const xml = (text: string) => text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

/** 3MF core: a stored (uncompressed) OPC zip with one model in millimetres. */
export function mesh3MF(meshes: NamedMesh[]): Uint8Array {
  const objects = meshes.map(({ name, mesh }, index) => {
    const vertices: string[] = [], triangles: string[] = [];
    for (let i = 0; i < mesh.vertices.length; i += 3) vertices.push(`<vertex x="${mesh.vertices[i]}" y="${mesh.vertices[i + 1]}" z="${mesh.vertices[i + 2]}"/>`);
    for (let i = 0; i < mesh.triangles.length; i += 3) triangles.push(`<triangle v1="${mesh.triangles[i]}" v2="${mesh.triangles[i + 1]}" v3="${mesh.triangles[i + 2]}"/>`);
    return `<object id="${index + 1}" name="${xml(safeName(name))}" type="model"><mesh><vertices>${vertices.join("")}</vertices><triangles>${triangles.join("")}</triangles></mesh></object>`;
  });
  const model = `<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><metadata name="Application">Aether CAD</metadata><resources>${objects.join("")}</resources><build>${meshes.map((_, i) => `<item objectid="${i + 1}"/>`).join("")}</build></model>`;
  return storedZip([
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`],
    ["3D/3dmodel.model", model],
  ]);
}

const crcTable = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Minimal zip writer: stored entries, no compression, enough for OPC readers. */
export function storedZip(entries: [name: string, content: string][]): Uint8Array {
  const encoder = new TextEncoder(), locals: Uint8Array[] = [], centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const nameBytes = encoder.encode(name), data = encoder.encode(content), crc = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length + data.length), lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(8, 0, true); lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true); lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30); local.set(data, 30 + nameBytes.length);
    const central = new Uint8Array(46 + nameBytes.length), cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true); cv.setUint16(28, nameBytes.length, true); cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    locals.push(local); centrals.push(central); offset += local.length;
  }
  const centralSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true); ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + centralSize + 22);
  let at = 0;
  for (const part of [...locals, ...centrals, end]) { out.set(part, at); at += part.length; }
  return out;
}
