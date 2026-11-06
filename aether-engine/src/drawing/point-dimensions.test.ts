import { beforeAll, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { exportDrawingPDF } from './pdf';
import { projectedDimensionPoint } from './point-dimensions';
import { readFileSync } from 'node:fs';
import { initNodeKernel } from '../kernel/node-kernel';
import { projectPartDrawing } from '../kernel/drawing-projection';
import { createRectanglePartDocument } from '../document/index';
import { createDrawingDocument, applyDrawingCommand, parseDrawingDocument, serializeDrawingDocument } from './document';
import { buildDrawing } from './build';
import { exportDrawingSVG, exportDrawingDXF } from './export';

beforeAll(async () => initNodeKernel(readFileSync(new URL('../../node_modules/replicad-opencascadejs/src/replicad_single.wasm', import.meta.url))), 30000);
function drawing() {
  const doc = createDrawingDocument(createRectanglePartDocument('Plate', { widthMillimeters: 40, heightMillimeters: 20, depthMillimeters: 10 }));
  doc.sheets[0].views = [{ id: 'top', name: 'Top', orientation: 'top', originMm: [80, 60], scale: 0.5, hiddenLines: false }];
  return doc;
}
const distance = { id: 'distance', kind: 'point-distance' as const, viewId: 'top', pointsMm: [[70, 55], [90, 65]] as [number, number][], positionMm: [95, 80] as [number, number], decimals: 2 };
it('measures native projected endpoints in model units, survives save, and exports vector dimensions', async () => {
  let doc = drawing(); doc = applyDrawingCommand(doc, { type: 'add-annotation', sheetId: doc.activeSheetId, annotation: distance });
  expect(doc.formatVersion).toBe(5);
  const built = await buildDrawing(parseDrawingDocument(serializeDrawingDocument(doc)), projectPartDrawing);
  expect(built.sheets[0].annotations[0].valueMm).toBeCloseTo(Math.hypot(40, 20), 8);
  expect(exportDrawingSVG(built)).toContain('44.72'); expect(exportDrawingDXF(built)).toContain('44.72');
  const horizontal = applyDrawingCommand(doc, { type: 'update-annotation', sheetId: doc.activeSheetId, annotation: { ...distance, axis: 'x' } });
  expect((await buildDrawing(horizontal, projectPartDrawing)).sheets[0].annotations[0].valueMm).toBeCloseTo(40);
  const vertical = applyDrawingCommand(doc, { type: 'update-annotation', sheetId: doc.activeSheetId, annotation: { ...distance, axis: 'y' } });
  expect((await buildDrawing(vertical, projectPartDrawing)).sheets[0].annotations[0].valueMm).toBeCloseTo(20);
  const removed = applyDrawingCommand(doc, { type: 'remove-annotation', sheetId: doc.activeSheetId, annotationId: distance.id });
  expect(removed.formatVersion).toBe(5);
});
it('measures a three-point angle and refuses ambiguous or missing references', async () => {
  let doc = drawing(); doc = applyDrawingCommand(doc, { type: 'add-annotation', sheetId: doc.activeSheetId, annotation: { ...distance, kind: 'point-angle', pointsMm: [[70, 55], [90, 55], [90, 65]] } });
  const built = await buildDrawing(doc, projectPartDrawing); expect(built.sheets[0].annotations[0].valueDeg).toBeCloseTo(90); expect(built.sheets[0].annotations[0].valueMm).toBeUndefined();
  for (const [pointsMm, error] of [ [[[70, 60], [90, 65]], /ambiguous/], [[[0, 0], [90, 65]], /within 5 mm/], [[[70, 55], [70, 55]], /zero distance/] ] as const) {
    const base = drawing();
    const bad = applyDrawingCommand(base, { type: 'add-annotation', sheetId: base.activeSheetId, annotation: { ...distance, pointsMm: pointsMm.map(p => [...p]) } });
    await expect(buildDrawing(bad, projectPartDrawing)).rejects.toThrow(error);
  }
});
it('refuses point annotations disguised as older formats and incorrect point counts', () => {
  const doc = drawing(); doc.sheets[0].annotations = [distance];
  expect(() => parseDrawingDocument(JSON.stringify(doc))).toThrow(/format version 5/);
  doc.formatVersion = 5;
  doc.sheets[0].annotations = [{ ...distance, pointsMm: [[70, 55]] }];
  expect(() => parseDrawingDocument(JSON.stringify(doc))).toThrow(/two distance points/);
});

it('uses analytic arc endpoints and circle centres, never polyline samples', async () => {
  const built = await buildDrawing(drawing(), projectPartDrawing);
  const view = built.sheets[0].views[0];
  view.geometry.visible = [
    { kind: 'arc', center: [0, 0], radius: 20, start: 0, end: Math.PI / 2, ccw: true },
    { kind: 'polyline', points: [[80, 80], [90, 90]], toleranceMm: 0.1 },
  ];
  expect(projectedDimensionPoint(view, [90, 60])).toEqual([90, 60]);
  expect(projectedDimensionPoint(view, [80, 50])).toEqual([80, 50]);
  expect(projectedDimensionPoint(view, [80, 60])).toEqual([80, 60]);
  expect(() => projectedDimensionPoint(view, [120, 20])).toThrow(/within 5 mm/);
});
it('exports point dimensions to PDF with embedded font and remeasures source edits', async () => {
  const base = drawing();
  const doc = applyDrawingCommand(base, { type: 'add-annotation', sheetId: base.activeSheetId, annotation: distance });
  const source = createRectanglePartDocument('Plate', { widthMillimeters: 44, heightMillimeters: 20, depthMillimeters: 10 }, {
    documentId: doc.source.documentId, sketchId: doc.source.features[0].id, extrudeId: doc.source.features[1].id,
  });
  const refreshed = await buildDrawing(applyDrawingCommand(doc, { type: 'refresh-source', source }), projectPartDrawing);
  expect(refreshed.sheets[0].annotations[0].valueMm).toBeCloseTo(Math.hypot(44, 20), 8);
  const fontBytes = readFileSync(createRequire(import.meta.url).resolve('@aether/assets/fonts/noto-sans/NotoSans-Regular.ttf'));
  const pdf = await exportDrawingPDF(refreshed, { fontBytes });
  expect(Buffer.from(pdf).subarray(0, 5).toString()).toBe('%PDF-');
});

it('creates an editable consecutive dimension chain atomically, without stored measurements', async () => {
  const base = drawing();
  const command = { type: 'add-dimension-chain' as const, sheetId: base.activeSheetId, chain: {
    id: 'chain', viewId: 'top', pointsMm: [[70,55],[90,55],[90,65]] as [number,number][], positionMm: [80,45] as [number,number], decimals: 2,
  } };
  const doc = applyDrawingCommand(base, command);
  const built = await buildDrawing(doc, projectPartDrawing);
  expect(built.sheets[0].annotations.map(a=>a.valueMm)).toEqual([40,20]);
  expect(doc.sheets[0].annotations.map(a=>a.id)).toEqual(['chain/1','chain/2']);
  expect(base.sheets[0].annotations).toEqual([]);
  expect(parseDrawingDocument(serializeDrawingDocument(doc))).toEqual(doc);
  expect(() => applyDrawingCommand(doc,command)).toThrow();
  const edited = applyDrawingCommand(doc,{type:'update-annotation',sheetId:doc.activeSheetId,annotation:{...doc.sheets[0].annotations[0],positionMm:[75,40]}});
  expect(edited.sheets[0].annotations[1]).toEqual(doc.sheets[0].annotations[1]);
  expect(() => applyDrawingCommand(base,{...command,chain:{...command.chain,pointsMm:[]}})).toThrow(/3–64/);
  expect(() => applyDrawingCommand(base,{...command,chain:{...command.chain,axis:'z' as 'x'}})).toThrow(/axis/);
});
