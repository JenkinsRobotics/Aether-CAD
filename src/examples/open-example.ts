import { AssemblyBridgeClient } from "../cad-assembly-bridge";
import type { Project } from "../host-library";
import { cadExample, readExample, base64 } from "./catalog";

/** Read a packaged Hybrid into an ephemeral workspace. This never creates a
 * Studio file; only the explicit Save copy action enters the user's library. */
export async function openExample(
  query: URLSearchParams,
): Promise<{ file: File; project: Project }> {
  const example = cadExample(query.get("example")),
    file = await readExample(example);
  const client = new AssemblyBridgeClient({ baseURL: "" });
  const workspace = await client.openWorkspace(
    base64(new Uint8Array(await file.arrayBuffer())),
  );
  try {
    const assemblyID = query.get("assembly") ?? example.assemblyId;
    const projection = await client.describeAssembly(
      workspace.handle,
      assemblyID,
    );
    const project: Project = {
      id: projection.workspace_id,
      parts: projection.part_definitions.map((part) => ({
        id: part.id,
        name: part.name,
        document: part.feature_document,
      })),
      assemblies: projection.assemblies.map((assembly) => ({
        id: assembly.id,
        name: assembly.name,
      })),
    };
    const partID = query.get("part");
    if (partID) {
      const part = project.parts.find((p) => p.id === partID);
      if (!part?.document) throw Error("This example Part is not available.");
      return {
        project,
        file: new File([JSON.stringify(part.document)], part.name + ".acpart"),
      };
    }
    query.set("assembly", assemblyID);
    return { project, file };
  } finally {
    await client.release(workspace.handle);
  }
}
