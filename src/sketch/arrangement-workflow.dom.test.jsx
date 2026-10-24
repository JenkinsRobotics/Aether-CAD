import { extrudeSelectionControls, serializeExtrudeSelections } from "../features/extrude-selection";
import { createRequire } from 'node:module';
import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { createEmptyPartDocument, parsePartDocument, serializePartDocument, sketchRegions } from '@aether/core/document';
import { matchesProfileRegion } from '@aether/core/sketch/reference/profile-region-reference';
import { featureRegionChoices, stampProfileSelections } from '../features/regions';
import { renderSketchCanvas } from './canvas-renderer';
import { pickSketchRegion } from './picking';
const { JSDOM } = createRequire(import.meta.url)('jsdom');
let dom;
beforeAll(() => { dom = new JSDOM(); for (const key of ['window', 'document']) vi.stubGlobal(key, dom.window[key]); });
afterAll(() => { dom.window.close(); vi.unstubAllGlobals(); });
const rectangle = () => ({ type: 'path', start: [0, -10], segments: [
  { type: 'line', end: [20, -10] }, { type: 'line', end: [20, 10] }, { type: 'line', end: [0, 10] }, { type: 'line', end: [0, -10] },
] });
function setup(circleX = 20, radius = 10) {
  const doc = createEmptyPartDocument('Cells');
  const drawing = { type: 'drawing', contours: [rectangle(), { type: 'circle', center: [circleX, 0], radius }] };
  doc.features.push({ id: 's', type: 'profile', name: 'Sketch', suppressed: false, plane: 'XY', offsetMillimeters: 0, profile: drawing });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  renderSketchCanvas(svg, drawing, { x: -30, y: -30, width: 80, height: 60 }, []);
  return { doc, drawing, svg };
}
it('shows and picks all three overlap cells without leaving whole-contour fills over them', () => {
  const { doc, drawing, svg } = setup();
  const regions = sketchRegions(doc.features[0]);
  expect(regions).toHaveLength(3);
  expect(svg.querySelectorAll('.derived-region')).toHaveLength(3);
  expect(svg.querySelectorAll('.sketch-contour')).toHaveLength(2);
  for (const source of svg.querySelectorAll('.sketch-contour[data-contour-index]')) expect(source.style.fill).toBe('none');
  const picks = [[5, 0], [15, 0], [25, 0]].map(point => pickSketchRegion(drawing, point));
  expect(new Set(picks).size).toBe(3);
  for (const index of picks) expect(svg.querySelector(`[data-region-index="${index}"]`)).not.toBeNull();
  expect(pickSketchRegion(drawing, [35, 0])).toBeNull();
});
it('renders a ring with an even-odd hole, picks its disc, and persists their distinct references', () => {
  const { doc, drawing, svg } = setup(10, 4);
  const ringIndex = pickSketchRegion(drawing, [2, 0]), discIndex = pickSketchRegion(drawing, [10, 0]);
  expect(ringIndex).not.toBe(discIndex);
  const ring = svg.querySelector(`[data-region-index="${ringIndex}"]`);
  expect(ring.getAttribute('fill-rule')).toBe('evenodd');
  expect(ring.getAttribute('d').match(/M/g)).toHaveLength(2);
  const saved = stampProfileSelections({ doc }, [ringIndex, discIndex].map(contourIndex => ({ featureId: 's', contourIndex })));
  expect(saved[0].profileRegion.inside).toHaveLength(1);expect(saved[1].profileRegion.inside).toHaveLength(2);
  const reopened = parsePartDocument(serializePartDocument(doc));
  reopened.features[0].profile.contours.reverse();
  const regions = sketchRegions(reopened.features[0]);
  expect(regions.filter(r => matchesProfileRegion(saved[0], r))).toHaveLength(1);
  expect(regions.find(r => matchesProfileRegion(saved[0], r)).holes).toHaveLength(1);
  expect(regions.find(r => matchesProfileRegion(saved[1], r)).holes).toHaveLength(0);
});
it('stamps divider side identity after assigning entity IDs and stages failed selections atomically', () => {
  const { doc } = setup();
  doc.features[0].profile.contours[1] = { type: 'path', start: [8, -15], segments: [{ type: 'line', end: [8, 15] }] };
  const choices = sketchRegions(doc.features[0]);
  const before = structuredClone(doc);
  expect(() => stampProfileSelections({ doc }, [{ featureId: 's', contourIndex: choices[0].contourIndex }, { featureId: 's', contourIndex: 999 }])).toThrow();
  expect(doc).toEqual(before);
  const picks = stampProfileSelections({ doc }, choices.map(r => ({ featureId: 's', contourIndex: r.contourIndex })));
  expect(picks[0].profileRegion.boundary).not.toEqual(picks[1].profileRegion.boundary);
  for (const pick of picks) expect(sketchRegions(doc.features[0]).filter(r => matchesProfileRegion(pick, r))).toHaveLength(1);
});

it('keeps saved whole-contour picks editable alongside new cells without converting the old feature', () => {
  const { doc } = setup();
  doc.features[0].profile.contours[0].id = 'rectangle';
  const feature = {id:'old',type:'extrude',name:'Old extrude',profileFeatureId:'s',profileContourId:'rectangle',operation:'new',distanceMillimeters:5,suppressed:false};
  const context = {doc,feature};
  const choices = featureRegionChoices(context,doc.features[0]);
  expect(choices).toHaveLength(4);
  const original = choices.find(r=>r.contourId==='rectangle');
  expect(original.cell).toBeUndefined();
  expect(stampProfileSelections(context,[{featureId:'s',contourIndex:original.contourIndex}])[0]).toMatchObject({profileContourId:'rectangle'});
});
it('refreshes region geometry and reference identity when a drawing mutates in place', () => {
  const { doc, drawing } = setup();
  expect(sketchRegions(doc.features[0])).toHaveLength(3);
  drawing.contours[1].center = [10, 0]; drawing.contours[1].radius = 4;
  const nested = sketchRegions(doc.features[0]);
  expect(nested).toHaveLength(2); expect(nested.some(r=>r.holes?.length)).toBe(true);
  drawing.contours[1].construction = true;
  expect(sketchRegions(doc.features[0])).toHaveLength(1);
});

it.each([false,true])('edits an older extrusion across intersecting contours without requiring reselection (explicit %s)', explicit => {
  const { doc } = setup();
  doc.features[0].profile.contours[0].id='rectangle';doc.features[0].profile.contours[1].id='circle';
  const feature = {id:'old',type:'extrude',name:'Old extrude',profileFeatureId:'s',...(explicit?{profileContourId:'rectangle'}:{}),operation:'new',distanceMillimeters:5,suppressed:false};
  const source=document.createElement('select');source.innerHTML='<option value="s">Sketch</option>';
  const context = {doc,feature,field:(_label,value,options)=>{const e=document.createElement(options?'select':'input');e.value=value;document.body.append(e);return e;}};
  const controls=extrudeSelectionControls(context,source);
  expect(JSON.parse(controls.selections.value)).toHaveLength(explicit?1:2);
  const saved=serializeExtrudeSelections({selections:controls.selections.value,creationMode:'solid'},context);
  expect(saved).toEqual(explicit?{profileFeatureId:'s',profileContourId:'rectangle'}:{profileFeatureId:'s'});
});
