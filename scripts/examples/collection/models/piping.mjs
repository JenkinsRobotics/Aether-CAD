import { Model, circle, ref, radial } from '../model-kit.mjs';

const m = new Model('piping', 'Flanged Process Pipe',
  'Editable hollow elbow with a sketched tangent route, swept wall, extruded flanges and drilled bolt circles. Change the section diameters, route or flange dimensions in native feature history.');
m.tags = ['Sweep', 'Extrude', 'Hole', 'Dimension editing'];
const pipe = m.part('elbow', 'Swept hollow elbow', 'steel');
const section = pipe.sketch('Tube centerline section — Ø18', [circle(9)]);
const path = pipe.sketch('Route — 40 straight, R30 elbow, 40 straight', [{
  type: 'path', start: [0, 0], segments: [
    { type: 'line', end: [0, 40] },
    { type: 'arc', middle: [30 - 30 / Math.SQRT2, 40 + 30 / Math.SQRT2], end: [30, 70] },
    { type: 'line', end: [70, 70] },
  ],
}], 0, 'XZ');
// Driving route dimensions and tangent junctions, rather than a fixed contour.
pipe.steps.find(s => s.id === path).arguments.feature_json.profile.constraints = [
  { id: 'route-origin', kind: 'fix', a: { contour: 0, kind: 'point', index: 0 }, point: [0, 0] },
  { id: 'inlet-vertical', kind: 'vertical', a: { contour: 0, kind: 'line', index: 0 } },
  { id: 'outlet-horizontal', kind: 'horizontal', a: { contour: 0, kind: 'line', index: 2 } },
  { id: 'inlet-length', kind: 'length', a: { contour: 0, kind: 'line', index: 0 }, value: 40 },
  { id: 'outlet-length', kind: 'length', a: { contour: 0, kind: 'line', index: 2 }, value: 40 },
  { id: 'bend-radius', kind: 'radius', a: { contour: 0, kind: 'arc', index: 1 }, value: 30 },
  { id: 'bend-run', kind: 'horizontal-distance', a: { contour: 0, kind: 'point', index: 1 }, b: { contour: 0, kind: 'point', index: 2 }, valueFrom: 'bend-radius' },
  { id: 'bend-rise', kind: 'vertical-distance', a: { contour: 0, kind: 'point', index: 1 }, b: { contour: 0, kind: 'point', index: 2 }, valueFrom: 'bend-radius' },
  { id: 'inlet-tangent', kind: 'tangent', a: { contour: 0, kind: 'line', index: 0 }, b: { contour: 0, kind: 'arc', index: 1 } },
  { id: 'outlet-tangent', kind: 'tangent', a: { contour: 0, kind: 'arc', index: 1 }, b: { contour: 0, kind: 'line', index: 2 } },
];
pipe.solid = pipe.add('Sweep tube along route', {
  type: 'sweep', profileFeatureId: ref(section), thin: { thickness1Millimeters: 1, thickness2Millimeters: 1 },
  pathFeatureId: ref(path), operation: 'new', bodyId: pipe.body,
});
m.place('Hollow elbow', pipe);
const flange = m.part('flange', 'Drilled pipe flange', 'aluminum')
  .ring('Extrude annular flange', 22, 8, -6, 6)
  .holes('Four Ø4 bolt holes', radial(4, 16, Math.PI / 4), 4, 0, 6, { through: true });
m.place('Inlet flange', flange);
// Reuse one editable Part definition at both ends of the route.
m.place('Outlet flange', flange, [70, 0, 70], [0, -Math.SQRT1_2, 0, Math.SQRT1_2]);
m.checks = [
  { part: 'elbow', volume: Math.PI * (100 - 64) * (80 + 15 * Math.PI) },
  { part: 'flange', volume: Math.PI * (484 - 64) * 6 - 4 * Math.PI * 4 * 6, holeRemoval: 96 * Math.PI },
];
export default m;
