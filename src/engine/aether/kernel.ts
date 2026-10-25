/** The Aether engine: OpenCASCADE in a web worker, started once per tab and
 *  shared by builds, previews, measurements and STEP import. Without a Worker
 *  (Node: tests, scripts) the same engine runs in the calling thread. */
import { OCCTWorkerClient } from "@aether/core/kernel";

type KernelClient = Pick<OCCTWorkerClient, "evaluatePart" | "projectDrawing" | "measureDistance" | "analyzePart" | "checkContacts" | "exportPart" | "importSTEP" | "sketchSection" | "dispose" | "ready">;
let client: KernelClient | undefined;
export function aetherKernel(): KernelClient {
  if (client) return client;
  return client = typeof Worker !== "undefined" ? new OCCTWorkerClient() : inProcess();
}

/** Node: the in-process client, loaded on first use so browser bundles never see node:fs. */
function inProcess(): KernelClient {
  const specifier = "@aether/core/kernel/in-process";
  let loading: Promise<KernelClient> | undefined;
  const real = () => loading ??= import(/* @vite-ignore */ specifier).then((m) => new m.InProcessKernelClient() as KernelClient);
  return {
    get ready() { return real().then(() => undefined); },
    evaluatePart: (document, options) => real().then((c) => c.evaluatePart(document, options)),
    projectDrawing: (document, options) => real().then((c) => c.projectDrawing(document, options)),
    measureDistance: (document, entities) => real().then((c) => c.measureDistance(document, entities)),
    analyzePart: (document, options) => real().then((c) => c.analyzePart(document, options)),
    checkContacts: (input) => real().then((c) => c.checkContacts(input)),
    sketchSection: (document, frame, kind, axis) => real().then((c) => c.sketchSection(document, frame, kind, axis)),
    exportPart: (document, options) => real().then((c) => c.exportPart(document, options)),
    importSTEP: (file) => real().then((c) => c.importSTEP(file)),
    dispose: () => { void loading?.then((c) => c.dispose()); },
  };
}
