import { expect, it } from 'vitest';
import { constrainFitSpline, constrainSketchEllipse, fitSketchSpline, copySketchContours, dragSketchEntity, editDrawingDimension, moveSketchContours, removeDrawingConstraint, sketchConstraintState, solveDrawingConstraints, validateSketchDrawing, type SketchDrawing, type SketchEntityRef } from '@aether/core/sketch';
import { parsePartDocument, serializePartDocument, createEmptyPartDocument } from '@aether/core/document';
import { fixedEntityConstraint, fixedGeometryResiduals, blockedSketchGeometry } from '../../freecad-engine/browser/fixed-geometry';
import { constrainSketchSelection } from './constraint-selection';
import { translateDocument } from '../freecad-translate';

const circle = (): SketchDrawing => ({ type: 'drawing', contours: [{ type: 'circle', center: [2,3], radius: 6 }] });
const ref: SketchEntityRef = { contour: 0, kind: 'circle' };
function fix(d: SketchDrawing, a: SketchEntityRef = ref) { return constrainSketchSelection(d, 'fix', [a]).drawing; }
function part(d: SketchDrawing) {
  const document = createEmptyPartDocument('Fixed sketch');
  document.features.push({ id: 's', type: 'profile', name: 'Sketch 1', plane: 'XY', offsetMillimeters: 0, suppressed: false, profile: d });
  return document;
}

it('locks circle position and radius without hidden dimensions; preserves legacy center-only Fix', () => {
  const source = circle(), before = structuredClone(source), drawing = fix(source);
  expect(source).toEqual(before); expect(drawing.constraints).toHaveLength(1);
  expect(sketchConstraintState(drawing)).toMatchObject({ state: 'fully-constrained', degreesOfFreedom: 0 });
  expect(() => dragSketchEntity(drawing, { contour: 0, kind: 'point', index: 0 }, [5,2])).toThrow();
  const sized = structuredClone(drawing); sized.constraints!.push({ id: 'radius', kind: 'radius', a: ref, value: 6 });
  expect(() => editDrawingDimension(sized, 'radius', 9)).toThrow();
  const unlocked = removeDrawingConstraint(sized, drawing.constraints![0].id);
  const resized = editDrawingDimension(unlocked, 'radius', 9).contours[0];
  expect(resized.type === 'circle' && resized.radius).toBeCloseTo(9, 7);
  const legacy = fix(source, { contour: 0, kind: 'point', index: 0 });
  expect(legacy.constraints![0]).toMatchObject({ point: [2,3] });
  expect(legacy.constraints![0].fixedGeometry).toBeUndefined();
  expect(sketchConstraintState(legacy).degreesOfFreedom).toBe(1);
});

const paths: SketchDrawing['contours'] = [
  { type: 'path', start: [0,0], segments: [{ type: 'line', end: [10,0] }] },
  { type: 'path', start: [0,0], segments: [{ type: 'arc', middle: [5,5], end: [10,0] }] },
  { type: 'path', start: [0,0], segments: [{ type: 'bezier', controls: [[2,4],[8,4]], end: [10,0] }] },
  { type: 'path', start: [0,0], segments: [{ type: 'ellipse', radiusX: 8, radiusY: 5, rotationDegrees: 20, largeArc: false, sweep: true, end: [10,0] }] },
];
it.each(paths)('locks every defining coordinate of $segments.0.type and detects topology changes', contour => {
  const source: SketchDrawing = { type: 'drawing', contours: [contour] };
  const drawing = fix(source, { contour: 0, kind: 'contour' });
  expect(sketchConstraintState(drawing)).toMatchObject({ state: 'fully-constrained', degreesOfFreedom: 0, redundantEquations: 0 });
  expect(() => dragSketchEntity(drawing, { contour: 0, kind: 'point', index: 1 }, [3,2])).toThrow();
  const changed = structuredClone(drawing);
  if (changed.contours[0].type !== 'path') throw Error();
  changed.contours[0].segments.push({ type: 'line', end: [20,10] });
  expect(() => validateSketchDrawing(changed)).toThrow(/topology/);
});
it('retains a fixed segment identity when unrelated segments are inserted before it', () => {
  const drawing: SketchDrawing = { type: 'drawing', contours: [{ type: 'path', start: [0,0], segments: [
    { type: 'line', id: 'first', end: [5,0] }, { type: 'line', id: 'locked', end: [10,0] },
  ] }] };
  const locked = fix(drawing, { contour: 0, kind: 'line', index: 1, segmentId: 'locked' });
  const c = locked.contours[0]; if (c.type !== 'path') throw Error();
  c.segments.splice(0, 1, { type: 'line', id: 'a', end: [2,0] }, { type: 'line', id: 'b', end: [5,0] });
  expect(blockedSketchGeometry(locked, 0)).toEqual([2]);
  expect(fixedGeometryResiduals(locked, locked.constraints![0])).toEqual([0,0,0,0]);
});
it.each([
  { a: 1, b: 0, c: 0, d: 1, tx: 20, ty: 10 },
  { a: 0, b: -2, c: 2, d: 0, tx: 10, ty: 20 },
  { a: -1, b: 0, c: 0, d: 1, tx: 30, ty: 0 },
])('transforms independent copies of fixed targets, but cannot move the original lock', transform => {
  const source = fix(circle());
  const copied = copySketchContours(source, [0], [transform]);
  expect(copied.constraints).toHaveLength(2);
  expect(fixedGeometryResiduals(copied, copied.constraints![1]).every(v => Math.abs(v) < 1e-8)).toBe(true);
  expect(sketchConstraintState(copied).degreesOfFreedom).toBe(0);
  expect(() => moveSketchContours(source, [0], transform)).toThrow(/conflicts/);
});
it('deduplicates repeated curve picks at different parameters', () => {
  const source: SketchDrawing = { type: 'drawing', contours: [paths[2]] };
  const a: SketchEntityRef = { contour: 0, kind: 'curve', index: 0, parameter: 0.3 };
  const first = fix(source, a);
  expect(constrainSketchSelection(first, 'fix', [{ ...a, parameter: 0.7 }]).added).toBe(0);
});
it('does not add redundant locks for nodes included with their parent curves', () => {
  const result = constrainSketchSelection(circle(), 'fix', [{ contour: 0, kind: 'point', index: 0 }, ref]);
  expect(result.added).toBe(1);
  expect(result.drawing.constraints![0].fixedGeometry).toBeTruthy();
  expect(constrainSketchSelection(result.drawing, 'fix', [{ contour: 0, kind: 'point', index: 0 }]).added).toBe(0);
  const source: SketchDrawing = { type: 'drawing', contours: [paths[2]] };
  expect(constrainSketchSelection(source, 'fix', [
    { contour: 0, kind: 'point', index: 0, control: 0 }, { contour: 0, kind: 'point', index: 1 },
    { contour: 0, kind: 'curve', index: 0, parameter: 0.3 }, { contour: 0, kind: 'curve', index: 0, parameter: 0.8 },
  ]).added).toBe(1);
});
it('round trips through the part file and emits native Block indices', () => {
  const saved = parsePartDocument(serializePartDocument(part(fix(circle()))));
  expect(translateDocument(saved).features[0]).toMatchObject({ kind: 'sketch-circle', parameters: { blocked_geometry: [0], radius_mm: 6 } });
  const profile = saved.features[0]; if (profile.type !== 'profile' || profile.profile.type !== 'drawing') throw Error();
  expect(sketchConstraintState(profile.profile).degreesOfFreedom).toBe(0);
});
it('uses solved wires for blocked polygon edges instead of adding redundant native coincidences', () => {
  const drawing: SketchDrawing = { type: 'drawing', contours: [{ type: 'path', start: [0,0], segments: [[10,0],[10,10],[0,10],[0,0]].map(end => ({ type: 'line', end: end as [number,number] })) }] };
  const locked = fix(drawing, { contour: 0, kind: 'contour' });
  expect(sketchConstraintState(locked)).toMatchObject({ state: 'fully-constrained', redundantEquations: 0 });
  expect(translateDocument(part(locked)).features[0]).toMatchObject({ kind: 'sketch-wire', parameters: { blocked_geometry: [0,1,2,3] } });
});
it('fixes a whole fit spline from any picked span while retaining interpolation without false redundant equations', () => {
  const source = constrainFitSpline({ type: 'drawing', contours: [fitSketchSpline([[0,0],[10,12],[20,4],[30,15]])] }, 0);
  const locked = fix(source, { contour: 0, kind: 'curve', index: 1, parameter: 0.3 });
  expect(locked.constraints!.at(-1)?.a).toEqual({ contour: 0, kind: 'contour' });
  expect(sketchConstraintState(locked)).toMatchObject({ state: 'fully-constrained', redundantEquations: 0 });
  expect(blockedSketchGeometry(locked, 0)).toEqual([0,1,2]);
  expect(() => dragSketchEntity(locked, { contour: 0, kind: 'point', index: 3 }, [2,3])).toThrow();
});
it('fixes both halves of a full ellipse from one curve pick without false redundant equations', () => {
  const source = constrainSketchEllipse({ type: 'drawing', contours: [{ type: 'path', start: [8,0], segments: [
    { type: 'ellipse', radiusX: 8, radiusY: 5, rotationDegrees: 0, largeArc: false, sweep: true, end: [-8,0] },
    { type: 'ellipse', radiusX: 8, radiusY: 5, rotationDegrees: 0, largeArc: false, sweep: true, end: [8,0] },
  ] }] }, 0);
  const locked = fix(source, { contour: 0, kind: 'curve', index: 1, parameter: 0.3 });
  expect(blockedSketchGeometry(locked, 0)).toEqual([0,1]);
  expect(sketchConstraintState(locked)).toMatchObject({ state: 'fully-constrained', redundantEquations: 0 });
});
it('translates exact elliptical segments with their saved frame and native block indices', () => {
  const drawing: SketchDrawing = { type: 'drawing', contours: [paths[3]] };
  const translation = translateDocument(part(fix(drawing, { contour: 0, kind: 'contour' })));
  expect(translation.complete).toBe(true);
  expect(translation.features[0]).toMatchObject({ kind: 'sketch-wire', parameters: { blocked_geometry: [0], segments: [{ type: 'ellipse', ellipse_frame: { radiusX: 8, radiusY: 5, rotation: 20*Math.PI/180 } }] } });
});
it('refuses malformed targets and mixed legacy/new Fix fields before solving', () => {
  const d = fix(circle());
  d.constraints![0].point = [2,3]; expect(() => solveDrawingConstraints(d)).toThrow(/cannot also contain/);
  delete d.constraints![0].point;
  d.constraints![0].fixedGeometry = { type: 'circle', center: [NaN,0], radius: 4 };
  expect(() => validateSketchDrawing(d)).toThrow();
  expect(fixedEntityConstraint(circle(), ref).fixedGeometry).toEqual(circle().contours[0]);
});
