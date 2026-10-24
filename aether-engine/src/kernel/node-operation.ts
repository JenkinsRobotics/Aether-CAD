/** Shared Node execution policy for the in-process client and packaged runner. */
import { readFileSync } from 'node:fs';
import { stderr } from 'node:process';
import type { PartDocument } from '../document/index';
import { extendedKernel, loadExtendedKernel, needsExtendedKernel } from './extended-kernel';
import { UnsupportedFeature } from './part-evaluator';

/** Native kernel diagnostics must never corrupt a runner's JSON stdout. */
export const kernelDiagnostic = (message: string) => { stderr.write(`${message}\n`); };

export async function runNodeOperation<T>(
  document: PartDocument | readonly PartDocument[],
  operation: () => T | Promise<T>,
  fullWasmPath: URL | string = new URL('../../node_modules/opencascade.js/dist/opencascade.full.wasm', import.meta.url),
): Promise<T> {
  const documents: readonly PartDocument[] = Array.isArray(document) ? document : [document as PartDocument];
  const load = () => loadExtendedKernel(async () => {
    const init = (await import('opencascade.js/dist/node.js')).default;
    return (init as unknown as (options: object) => Promise<unknown>)({
      module: { wasmBinary: readFileSync(fullWasmPath), print: kernelDiagnostic, printErr: kernelDiagnostic },
    });
  });
  if (documents.some(needsExtendedKernel)) await load();
  try { return await operation(); }
  catch (error) {
    // A face's surface kind may become known only while rebuilding. Retry that
    // specific capability request once; ordinary feature errors retain context.
    if (!(error instanceof UnsupportedFeature) || !error.fullBuild || extendedKernel()) throw error;
    await load();
    return operation();
  }
}
