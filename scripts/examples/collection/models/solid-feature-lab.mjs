import { dimensionRectangles } from '../dimension-sketches.mjs';
import { Model, circle, rectangle, ref } from '../model-kit.mjs';

const m = new Model('solid-feature-lab', 'Solid Feature Workshop',
  'Native feature exercises: patterned and mirrored bosses, Boolean bore with a Split cutoff, and a drafted open shell. Each operation remains in the editable history.');
m.tags = ['Pattern', 'Mirror', 'Boolean', 'Split', 'Draft', 'Shell', 'Thicken', 'Surface Extrude'];
const plate = m.part('boss-plate', 'Pattern and mirror plate', 'blue')
  .pad('Base plate', [rectangle(80, 50)], 0, 5);
plate.pad('Seed boss', [circle(4, [-20, 12])], 5, 8, 'add');
const seed = `f${plate.steps.length - 1}`;
plate.add('Three bosses — linear feature pattern', { type: 'pattern', sourceFeatureId: ref(seed), patternType: 'linear', axis: 'X', count: 3, spacingMillimeters: 20, reversed: false });
const pattern = `f${plate.steps.length - 1}`;
plate.add('Opposite row — mirror patterned feature', { type: 'mirror', sourceFeatureId: ref(pattern), plane: 'XZ', offsetMillimeters: 0, operation: 'add' });
m.place('Boss plate', plate);
const bore = m.part('bored-block', 'Boolean and split block', 'aluminum')
  .pad('Stock', [rectangle(40, 40)], 0, 20);
const stock = bore.solid;
bore.ring('Bore tool', 6, 0, 0, 20);
const tool = bore.solid;
bore.add('Boolean subtract bore', { type: 'boolean', operation: 'cut', targetBodyId: ref(stock, 'body_id'), toolBodyIds: [ref(tool, 'body_id')], keepTools: false });
bore.add('Split stock — retain lower half', { type: 'split', bodyIds: [ref(stock, 'body_id')], plane: { kind: 'principal', plane: 'XY', offsetMillimeters: 10 }, keep: 'negative' });
m.place('Bored block', bore, [100, 0, 0]);
const cup = m.part('draft-cup', 'Drafted shell', 'ivory')
  .pad('Mold blank', [rectangle(40, 30)], 0, 20);
const face = normal => ({ sourceFeatureId: ref(cup.solid), bodyId: ref(cup.solid, 'body_id'), normal, label: 'Mold wall' });
cup.add('Two walls — 3 degree draft', { type: 'draft', angleDegrees: 3, reversed: false, facePlane: { plane: 'YZ', offsetMillimeters: 0 }, neutralPlane: { plane: 'XY', offsetMillimeters: 0 }, faces: [face([1,0,0]), face([-1,0,0])] });
const draft = `f${cup.steps.length - 1}`;
cup.add('Open top — 2 mm shell', { type: 'shell', targetBodyId: ref(cup.solid, 'body_id'), thicknessMillimeters: 2, removedFaces: [{ ...face([0,0,1]), sourceFeatureId: ref(draft), label: 'Top opening' }] });
m.place('Drafted cup', cup, [175, 0, 0]);
const rotor = m.part('radial-plate', 'Circular pattern flange', 'steel')
  .ring('Hub plate', 25, 0, 0, 5);
rotor.pad('Radial seed boss', [circle(3, [16, 0])], 5, 6, 'add');
rotor.add('Six bosses — circular feature pattern', { type: 'pattern', sourceFeatureId: ref(`f${rotor.steps.length - 1}`), patternType: 'polar', axis: 'Z', count: 6, angleDegrees: 360, reversed: false });
m.place('Radial flange', rotor, [0, 80, 0]);
const sheet = m.part('thickened-web', 'Surface to solid web', 'aluminum');
const line = sheet.sketch('Web width — 40 mm', [{ type: 'path', start: [0, 0], segments: [{ type: 'line', end: [40, 0] }] }]);
sheet.steps[0].arguments.feature_json.profile.constraints = [
 { id: 'start', kind: 'fix', a: { contour: 0, kind: 'point', index: 0 }, point: [0, 0] },
 { id: 'horizontal', kind: 'horizontal', a: { contour: 0, kind: 'line', index: 0 } },
 { id: 'width', kind: 'length', a: { contour: 0, kind: 'line', index: 0 }, value: 40 },
];
const surface = sheet.add('Extrude open profile — surface', { type: 'surface-extrude', profileFeatureId: ref(line), distanceMillimeters: 25, operation: 'new' });
sheet.add('Thicken web — 3 mm solid', { type: 'surface-thicken', bodyIds: [ref(surface, 'body_id')], thicknessMillimeters: 3, operation: 'new', keepTools: false });
m.place('Thickened web', sheet, [85, 80, 0]);
// Integrate the drafted outer trapezoid and the 2 mm normally-offset cavity.
const slope = Math.tan(3 * Math.PI / 180), normalInset = 4 / Math.cos(3 * Math.PI / 180);
m.checks = [
 { part: 'draft-cup', volume: 30 * (40 * 20 - slope * 400) - 26 * ((40 - normalInset) * 18 - slope * 396) },
 { part: 'radial-plate', volume: Math.PI * 625 * 5 + 6 * Math.PI * 9 * 6 },
 { part: 'thickened-web', volume: 40 * 25 * 3 },
 { part: 'boss-plate', volume: 80 * 50 * 5 + 6 * Math.PI * 16 * 8 },
 { part: 'bored-block', volume: (40 * 40 - Math.PI * 36) * 10 },
];
export default dimensionRectangles(m);
