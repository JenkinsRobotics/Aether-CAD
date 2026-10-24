/** The kernel in Node (the headless runner, tests): the wasm bytes are the caller's,
 *  the OCCT instance is installed for replicad once. Lives in the engine package so
 *  its own dependencies resolve wherever the runner bundle is built from. */
import init from "replicad-opencascadejs";
import { setOC, measureVolume, type Shape3D } from "replicad";
import { kernelDiagnostic } from './node-operation';
export { runNodeOperation } from './node-operation';

let installed: Promise<void> | undefined;
export function initNodeKernel(wasmBinary: ArrayBuffer | Uint8Array): Promise<void> {
  if (!installed) installed = (async () => { setOC(await (init as unknown as (options: object) => Promise<never>)({ wasmBinary, print: kernelDiagnostic, printErr: kernelDiagnostic })); })();
  return installed;
}

/** A solid's exact volume and its face and edge counts, the measures the agent answers carry. */
export function solidMeasures(shape: Shape3D): { volume_mm3: number; face_count: number; edge_count: number } {
  const faces = shape.faces, edges = shape.edges;
  const measures = { volume_mm3: measureVolume(shape), face_count: faces.length, edge_count: edges.length };
  faces.forEach((f) => f.delete()); edges.forEach((e) => e.delete());
  return measures;
}
