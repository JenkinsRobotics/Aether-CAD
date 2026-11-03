/** Saved documents for the browser gates: one `.aethercad` file holding one tab,
 * written and read with the app's own codec so the gates exercise the product's
 * storage path, not a test-only shape. Node 24 runs the TypeScript module directly. */
import { drawingGraph, partGraph, readAetherCAD, writeAetherCAD } from '../../src/document/aethercad-archive.ts';

/** base64 of a document holding this Part Studio, for `library/create`. */
export const partDocumentBase64 = (document) => Buffer.from(writeAetherCAD(partGraph(document))).toString('base64');
/** base64 of a document holding this Drawing. */
export const drawingDocumentBase64 = (document) => Buffer.from(writeAetherCAD(drawingGraph(document))).toString('base64');
/** The Part Studio inside saved document bytes. */
export function partDocumentOf(base64) {
  const { graph } = readAetherCAD(new Uint8Array(Buffer.from(base64, 'base64')));
  const part = graph.part_definitions.find((item) => item.feature_document)?.feature_document;
  if (!part) throw new Error('The saved document holds no Part Studio.');
  return part;
}
/** The one tab inside saved document bytes: its Drawing, else its Part Studio. */
export function tabDocumentOf(base64) {
  const { graph } = readAetherCAD(new Uint8Array(Buffer.from(base64, 'base64')));
  const tab = graph.drawings?.[0]?.document ?? graph.part_definitions.find((part) => part.feature_document)?.feature_document;
  if (!tab) throw new Error('The saved document holds no Part Studio or Drawing.');
  return tab;
}
/** Every Drawing document inside saved document bytes. */
export function drawingsOf(base64) {
  const { graph } = readAetherCAD(new Uint8Array(Buffer.from(base64, 'base64')));
  return (graph.drawings ?? []).map((entry) => entry.document);
}
