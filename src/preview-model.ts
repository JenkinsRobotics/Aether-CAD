import { parsePartDocument } from '@aether/core/document';
import { readAetherCADText, writeAetherCAD, type AetherCADGraph } from './document/aethercad-archive';
import { AssemblyBridgeClient, type AssemblyProjectionV1 } from './cad-assembly-bridge';
import { evaluatePart } from './engine/evaluate-part';
import { bodiesForPlacements, type SolvedBody } from './startup/assembly-solve';

/** Native Part JSON and complete files share the same preview geometry path.
 * Assembly interpretation uses the canonical projection, never guessed poses. */
export async function previewBodies(content: string): Promise<SolvedBody[]> {
  const value = content.startsWith('PK') ? { graph: readAetherCADText(content).graph } : JSON.parse(content);
  if (value.previewProjection) return projectionBodies(value.previewProjection);
  const graph: AetherCADGraph | undefined = value.graph;
  if (graph?.assemblies.length && graph.instances.length) {
    const client = new AssemblyBridgeClient({ baseURL: '' });
    const bytes = writeAetherCAD(graph);
    let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    const workspace = await client.openWorkspace(btoa(binary));
    try {
      return await projectionBodies(await client.describeAssembly(workspace.handle, value.previewAssemblyId ?? workspace.root_assembly_id));
    } finally { await client.release(workspace.handle); }
  }
  const source = graph ? graph.part_definitions.find(part => part.feature_document)?.feature_document : value;
  if (!source) return [];
  const document = parsePartDocument(JSON.stringify(source));
  if (!document.features.length) return [];
  const model = await evaluatePart(document);
  return model.parts.filter(part => document.bodyProperties?.[part.id]?.visible !== false).map(data => ({ data, positionMillimeters: [0, 0, 0], quaternion: [0, 0, 0, 1] }));
}
async function projectionBodies(projection: AssemblyProjectionV1) {
  return bodiesForPlacements(projection, projection.instances.map(instance => ({ id: instance.id,
    placement_mm: instance.solved_world_transform.position_m.map(value => value * 1000) as [number, number, number],
    rotation: [...instance.solved_world_transform.rotation_quaternion_xyzw],
  })), { evaluate: evaluatePart, parseDocument: parsePartDocument });
}
