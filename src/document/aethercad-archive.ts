/** The `.aethercad` document container, read and written in the browser.
 *
 * The container is the Aether workspace archive: a stored (uncompressed) zip
 * holding `manifest.json` and `state/graph.json`. The Python codec in the CAD
 * service (`aether_animation.aether_workspace`) is the reference; this module
 * writes bytes that codec reads unchanged and reads the bytes it writes.
 * Output is deterministic for a given graph, so autosave snapshots compare by
 * bytes. No dependency: the zip, CRC-32 and SHA-256 fit in this one file. */
import { AETHER_CAD_EXTENSION, type DocumentKind } from "@aether/core/document/file-types";

export interface PartDefinition {
  id: string;
  name: string;
  feature_document?: Record<string, unknown>;
  [key: string]: unknown;
}
export interface DrawingEntry { id: string; name: string; document: Record<string, unknown> }
export interface AetherCADGraph {
  schema_version: number;
  workspace_id: string;
  name: string;
  revision: string;
  id_counter: number;
  part_definitions: PartDefinition[];
  assemblies: unknown[];
  instances: unknown[];
  connector_definitions: unknown[];
  mates: unknown[];
  relations: unknown[];
  configurations: unknown[];
  drawings?: DrawingEntry[];
  [key: string]: unknown;
}
export interface AetherCADDocument { name: string; kind: DocumentKind; graph: AetherCADGraph }

const FORMAT = "aether-workspace";
const GRAPH_PATH = "state/graph.json";

/** What a document holds. Same rule as `AetherWorkspace.kind` in the codec. */
export function documentKind(graph: AetherCADGraph): DocumentKind {
  const present: DocumentKind[] = [];
  if (graph.part_definitions.some((part) => part.feature_document)) present.push("part");
  if (graph.instances.length || graph.mates.length) present.push("assembly");
  if (graph.drawings?.length) present.push("drawing");
  return present.length === 1 ? present[0] : present.length ? "mixed" : "part";
}

export function readAetherCAD(bytes: Uint8Array): AetherCADDocument {
  const entries = readStoredZip(bytes);
  const manifestBytes = entries.get("manifest.json");
  if (!manifestBytes) throw new Error("Not an Aether CAD document: no manifest.");
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as { format?: string; name?: string; graph_path?: string };
  if (manifest.format !== FORMAT) throw new Error("Not an Aether CAD document.");
  const graphBytes = entries.get(manifest.graph_path ?? GRAPH_PATH);
  if (!graphBytes) throw new Error("The document archive has no graph.");
  const graph = JSON.parse(new TextDecoder().decode(graphBytes)) as AetherCADGraph;
  return { name: manifest.name ?? graph.name, kind: documentKind(graph), graph };
}

export function writeAetherCAD(graph: AetherCADGraph): Uint8Array<ArrayBuffer> {
  const graphBytes = new TextEncoder().encode(JSON.stringify(graph) + "\n");
  const manifest = {
    format: FORMAT,
    format_version: 1,
    workspace_id: graph.workspace_id,
    name: graph.name,
    core_semantics_version: "1",
    graph_path: GRAPH_PATH,
    graph_sha256: hex(sha256(graphBytes)),
    root_view_ids: [
      ...(graph.drawings ?? []).map((d) => d.id).sort(),
      ...(graph.assemblies as { id: string }[]).map((a) => a.id).sort(),
      ...graph.part_definitions.filter((p) => p.feature_document).map((p) => p.id).sort(),
    ],
    display_unit_system: "metric",
    app: "cad",
    kind: documentKind(graph),
  };
  return writeStoredZip([
    ["manifest.json", new TextEncoder().encode(JSON.stringify(manifest) + "\n")],
    [GRAPH_PATH, graphBytes],
  ]);
}

/** An empty document: a Main Assembly and a Default configuration, nothing placed. */
export function emptyGraph(name: string, workspaceId: string): AetherCADGraph {
  return {
    schema_version: 3,
    workspace_id: workspaceId,
    name,
    revision: "1",
    id_counter: 2,
    part_definitions: [],
    assemblies: [{ description: null, id: "assembly-000001", name: "Main Assembly" }],
    instances: [],
    connector_definitions: [],
    mates: [],
    relations: [],
    configurations: [{ active: true, id: "configuration-000002", name: "Default", overridden_dof_ids: [], suppressed_instance_ids: [] }],
    document_settings: {},
  };
}
/** A document holding one Part Studio. The part keeps its own document id. */
export function partGraph(document: { documentId: string; name: string }, workspaceId = document.documentId): AetherCADGraph {
  const graph = emptyGraph(document.name, workspaceId);
  graph.id_counter = 3;
  graph.revision = "2";
  graph.part_definitions = [{
    custom_properties: [], description: null, id: document.documentId, mass_kg: null, material_id: null,
    name: document.name, part_number: null,
    source: { asset_ref: null, kind: "authored", label: document.name, status: "resolved" },
    feature_document: { ...document },
  }];
  return graph;
}
/** A document holding one Drawing. */
export function drawingGraph(document: { documentId: string; name: string }, workspaceId = document.documentId): AetherCADGraph {
  const graph = emptyGraph(document.name, workspaceId);
  graph.drawings = [{ id: document.documentId, name: document.name, document: { ...document } }];
  return graph;
}

// ---- zip (stored entries only, as the codec writes) ----------------------
function readStoredZip(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error("Not an Aether CAD document: not a zip archive.");
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const entries = new Map<string, Uint8Array>();
  const decoder = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error("The document archive is damaged.");
    const method = view.getUint16(offset + 10, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (method !== 0) throw new Error(`The document archive entry ${name} is compressed; Aether CAD documents are stored.`);
    const dataStart = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    entries.set(name, bytes.subarray(dataStart, dataStart + size));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function writeStoredZip(files: [string, Uint8Array][]): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [], centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, data] of files) {
    const nameBytes = encoder.encode(name), crc = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(8, 0, true);
    lv.setUint16(10, 0, true); lv.setUint16(12, 0x21, true); // 1980-01-01 00:00, as the codec stamps
    lv.setUint32(14, crc, true); lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30); local.set(data, 30 + nameBytes.length);
    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
    cv.setUint16(12, 0, true); cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true); cv.setUint32(38, 0o100644 << 16, true); cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    locals.push(local); centrals.push(central); offset += local.length;
  }
  const directorySize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
  ev.setUint32(12, directorySize, true); ev.setUint32(16, offset, true);
  const out = new Uint8Array(new ArrayBuffer(offset + directorySize + 22));
  let at = 0;
  for (const chunk of [...locals, ...centrals, end]) { out.set(chunk, at); at += chunk.length; }
  return out;
}

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// ---- SHA-256 (synchronous; snapshots are taken synchronously) ------------
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
export function sha256(data: Uint8Array): Uint8Array {
  const length = data.length, padded = new Uint8Array(((length + 9 + 63) >> 6) << 6);
  padded.set(data); padded[length] = 0x80;
  new DataView(padded.buffer).setUint32(padded.length - 4, length * 8, false);
  new DataView(padded.buffer).setUint32(padded.length - 8, Math.floor((length * 8) / 2 ** 32), false);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64), view = new DataView(padded.buffer);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let block = 0; block < padded.length; block += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(block + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) new DataView(out.buffer).setUint32(i * 4, h[i], false);
  return out;
}
const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

/** The working bytes of one tab: a document holding just that Part Studio or
 * Drawing. Autosave, recovery downloads and copies all carry this shape. */
export function tabArchive(document: { documentId: string; name: string }, kind: "part" | "drawing") {
  return { name: document.name + AETHER_CAD_EXTENSION, bytes: writeAetherCAD(kind === "drawing" ? drawingGraph(document) : partGraph(document)) };
}

/** The graph of a document whose bytes arrived decoded as text (Studio's file
 * preview hands every app a string). The archive is stored, so the graph JSON
 * survives the lossy decode intact between its entry name and the central
 * directory; only binary header bytes become U+FFFD.
 * ponytail: text contract; goes away when the preview contract passes bytes. */
export function readAetherCADText(text: string): AetherCADDocument {
  if (!text.startsWith("PK")) throw new Error("Not an Aether CAD document.");
  // The manifest also names the graph path; the entry is the occurrence followed by its JSON.
  let entry = text.indexOf(GRAPH_PATH);
  while (entry >= 0 && text[entry + GRAPH_PATH.length] !== "{") entry = text.indexOf(GRAPH_PATH, entry + 1);
  const directory = text.indexOf("PK\u0001\u0002", entry);
  if (entry < 0 || directory < 0) throw new Error("The document archive has no graph.");
  const graph = JSON.parse(text.slice(entry + GRAPH_PATH.length, directory).trim()) as AetherCADGraph;
  return { name: graph.name, kind: documentKind(graph), graph };
}
