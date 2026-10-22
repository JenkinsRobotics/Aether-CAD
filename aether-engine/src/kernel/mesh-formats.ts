/** Triangle meshes from the interchange files FreeCAD's Mesh module read for us
 *  (`aether_freecad/cad_import.py`): STL (ASCII or binary), OBJ, OFF and PLY
 *  (ASCII or binary little-endian). Output is flat: three vertices per triangle. */
export interface TriangleMesh { vertices: Float32Array; triangles: Uint32Array }

export type MeshFormat = "stl" | "obj" | "ply" | "off";

const text = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);

function indexed(points: number[], faces: number[][]): TriangleMesh {
  const vertices: number[] = [], triangles: number[] = [];
  const count = points.length / 3;
  for (const face of faces) {
    if (face.length < 3) continue;
    for (let k = 1; k + 1 < face.length; k++) {
      for (const index of [face[0], face[k], face[k + 1]]) {
        if (!Number.isInteger(index) || index < 0 || index >= count) throw new Error("Mesh face refers to a missing vertex.");
        triangles.push(vertices.length / 3);
        vertices.push(points[index * 3], points[index * 3 + 1], points[index * 3 + 2]);
      }
    }
  }
  return { vertices: Float32Array.from(vertices), triangles: Uint32Array.from(triangles) };
}

function parseSTL(bytes: Uint8Array): TriangleMesh {
  const binarySize = bytes.length >= 84 ? 84 + 50 * new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(80, true) : -1;
  if (binarySize === bytes.length && bytes.length >= 84) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const count = view.getUint32(80, true);
    const vertices = new Float32Array(count * 9), triangles = new Uint32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const at = 84 + i * 50 + 12;
      for (let k = 0; k < 9; k++) vertices[i * 9 + k] = view.getFloat32(at + k * 4, true);
      triangles[i * 3] = i * 3; triangles[i * 3 + 1] = i * 3 + 1; triangles[i * 3 + 2] = i * 3 + 2;
    }
    return { vertices, triangles };
  }
  const vertices: number[] = [];
  for (const line of text(bytes).split(/\r?\n/)) {
    const m = /^\s*vertex\s+(\S+)\s+(\S+)\s+(\S+)/i.exec(line);
    if (m) vertices.push(Number(m[1]), Number(m[2]), Number(m[3]));
  }
  if (!vertices.length || vertices.length % 9) throw new Error("STL could not be read.");
  return { vertices: Float32Array.from(vertices), triangles: Uint32Array.from({ length: vertices.length / 3 }, (_, i) => i) };
}

function parseOBJ(bytes: Uint8Array): TriangleMesh {
  const points: number[] = [], faces: number[][] = [];
  for (const raw of text(bytes).split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("v ")) { const p = line.split(/\s+/).slice(1, 4).map(Number); if (p.length === 3) points.push(...p); }
    else if (line.startsWith("f ")) {
      const count = points.length / 3;
      faces.push(line.split(/\s+/).slice(1).map((token) => { const i = Number(token.split("/")[0]); return i < 0 ? count + i : i - 1; }));
    }
  }
  if (!faces.length) throw new Error("OBJ could not be read.");
  return indexed(points, faces);
}

function parseOFF(bytes: Uint8Array): TriangleMesh {
  const lines = text(bytes).split(/\r?\n/).map((l) => l.replace(/#.*/, "").trim()).filter(Boolean);
  if (!/^OFF/i.test(lines[0] ?? "")) throw new Error("OFF could not be read.");
  const header = lines[0].length > 3 ? lines[0].slice(3).trim() : lines[1];
  const [nv, nf] = header.split(/\s+/).map(Number);
  let at = lines[0].length > 3 ? 1 : 2;
  const points: number[] = [], faces: number[][] = [];
  for (let i = 0; i < nv; i++) points.push(...lines[at++].split(/\s+/).slice(0, 3).map(Number));
  for (let i = 0; i < nf; i++) { const f = lines[at++].split(/\s+/).map(Number); faces.push(f.slice(1, 1 + f[0])); }
  return indexed(points, faces);
}

function parsePLY(bytes: Uint8Array): TriangleMesh {
  const headerEnd = text(bytes.subarray(0, Math.min(bytes.length, 65536))).indexOf("end_header");
  if (headerEnd < 0) throw new Error("PLY could not be read.");
  const headerText = text(bytes.subarray(0, headerEnd));
  const bodyStart = headerEnd + "end_header".length + (bytes[headerEnd + 10] === 13 ? 2 : 1);
  const lines = headerText.split(/\r?\n/).map((l) => l.trim());
  const format = lines.find((l) => l.startsWith("format"))?.split(/\s+/)[1];
  if (!format || !["ascii", "binary_little_endian"].includes(format)) throw new Error("PLY must be ASCII or binary little-endian.");
  type Prop = { name: string; type: string; list?: [string, string] };
  const elements: { name: string; count: number; props: Prop[] }[] = [];
  for (const line of lines) {
    const parts = line.split(/\s+/);
    if (parts[0] === "element") elements.push({ name: parts[1], count: Number(parts[2]), props: [] });
    else if (parts[0] === "property" && elements.length) elements[elements.length - 1].props.push(parts[1] === "list" ? { name: parts[4], type: "list", list: [parts[2], parts[3]] } : { name: parts[2], type: parts[1] });
  }
  const sizes: Record<string, number> = { char: 1, uchar: 1, int8: 1, uint8: 1, short: 2, ushort: 2, int16: 2, uint16: 2, int: 4, uint: 4, int32: 4, uint32: 4, float: 4, float32: 4, double: 8, float64: 8 };
  const points: number[] = [], faces: number[][] = [];
  if (format === "ascii") {
    const tokens = text(bytes.subarray(bodyStart)).split(/\s+/).filter(Boolean);
    let at = 0;
    for (const element of elements) for (let i = 0; i < element.count; i++) {
      const values: Record<string, number | number[]> = {};
      for (const prop of element.props) {
        if (prop.type === "list") { const n = Number(tokens[at++]); values[prop.name] = tokens.slice(at, at + n).map(Number); at += n; }
        else values[prop.name] = Number(tokens[at++]);
      }
      if (element.name === "vertex") points.push(values.x as number, values.y as number, values.z as number);
      if (element.name === "face") faces.push((values.vertex_indices ?? values.vertex_index ?? []) as number[]);
    }
  } else {
    const view = new DataView(bytes.buffer, bytes.byteOffset + bodyStart, bytes.byteLength - bodyStart);
    let at = 0;
    const read = (type: string) => {
      const size = sizes[type]; if (!size) throw new Error(`PLY property type ${type} is not supported.`);
      const value = type.startsWith("float") || type === "double" ? (size === 4 ? view.getFloat32(at, true) : view.getFloat64(at, true))
        : type.startsWith("u") ? (size === 1 ? view.getUint8(at) : size === 2 ? view.getUint16(at, true) : view.getUint32(at, true))
        : (size === 1 ? view.getInt8(at) : size === 2 ? view.getInt16(at, true) : view.getInt32(at, true));
      at += size; return value;
    };
    for (const element of elements) for (let i = 0; i < element.count; i++) {
      const values: Record<string, number | number[]> = {};
      for (const prop of element.props) {
        if (prop.type === "list") { const n = read(prop.list![0]); const list: number[] = []; for (let k = 0; k < n; k++) list.push(read(prop.list![1])); values[prop.name] = list; }
        else values[prop.name] = read(prop.type);
      }
      if (element.name === "vertex") points.push(values.x as number, values.y as number, values.z as number);
      if (element.name === "face") faces.push((values.vertex_indices ?? values.vertex_index ?? []) as number[]);
    }
  }
  return indexed(points, faces);
}

export function parseMesh(bytes: Uint8Array, format: MeshFormat): TriangleMesh {
  const mesh = format === "stl" ? parseSTL(bytes) : format === "obj" ? parseOBJ(bytes) : format === "off" ? parseOFF(bytes) : parsePLY(bytes);
  const count = mesh.triangles.length / 3;
  if (!(count > 0 && count <= 100_000)) throw new Error("Mesh must contain 1–100,000 triangles.");
  for (const v of mesh.vertices) if (!Number.isFinite(v)) throw new Error("Mesh coordinates must be finite and within 1,000 km.");
  return mesh;
}

/** Flat (per-triangle) normals, as FreeCAD's mesh bodies carried them. */
export function flatNormals(mesh: TriangleMesh): Float32Array {
  const normals = new Float32Array(mesh.vertices.length);
  const v = mesh.vertices;
  for (let i = 0; i + 8 < v.length; i += 9) {
    const ax = v[i + 3] - v[i], ay = v[i + 4] - v[i + 1], az = v[i + 5] - v[i + 2];
    const bx = v[i + 6] - v[i], by = v[i + 7] - v[i + 1], bz = v[i + 8] - v[i + 2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const length = Math.hypot(nx, ny, nz) || 1;
    nx /= length; ny /= length; nz /= length;
    for (let k = 0; k < 3; k++) { normals[i + k * 3] = nx; normals[i + k * 3 + 1] = ny; normals[i + k * 3 + 2] = nz; }
  }
  return normals;
}

/** True when every triangle edge is shared by exactly two triangles (a closed mesh). */
export function meshIsClosed(mesh: TriangleMesh): boolean {
  const key = (i: number) => `${mesh.vertices[i * 3]},${mesh.vertices[i * 3 + 1]},${mesh.vertices[i * 3 + 2]}`;
  const edges = new Map<string, number>();
  for (let t = 0; t < mesh.triangles.length; t += 3) {
    const k = [key(mesh.triangles[t]), key(mesh.triangles[t + 1]), key(mesh.triangles[t + 2])];
    for (let e = 0; e < 3; e++) { const a = k[e], b = k[(e + 1) % 3]; const name = a < b ? `${a}|${b}` : `${b}|${a}`; edges.set(name, (edges.get(name) ?? 0) + 1); }
  }
  for (const count of edges.values()) if (count !== 2) return false;
  return true;
}

/** Binary STL bytes of a mesh, the form the kernel's STL reader turns into a solid. */
export function binarySTL(mesh: TriangleMesh, scale = 1): Uint8Array {
  const count = mesh.triangles.length / 3;
  const out = new Uint8Array(84 + 50 * count);
  const view = new DataView(out.buffer);
  view.setUint32(80, count, true);
  const normals = flatNormals(mesh);
  for (let i = 0; i < count; i++) {
    const at = 84 + i * 50;
    for (let k = 0; k < 3; k++) view.setFloat32(at + k * 4, normals[i * 9 + k], true);
    for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) view.setFloat32(at + 12 + c * 12 + k * 4, mesh.vertices[mesh.triangles[i * 3 + c] * 3 + k] * scale, true);
  }
  return out;
}
