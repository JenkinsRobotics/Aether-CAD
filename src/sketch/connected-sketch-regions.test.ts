import { describe, expect, it } from 'vitest';
import { connectedSketchRegions, resolveConnectedSketchRegion } from '../../freecad-engine/browser/connected-sketch-regions';
import { segmentPoint } from '../../aether-engine/src/sketch/curves/parameterization';
import { fitSketchSpline, constrainFitSpline, type SketchDrawing, type SketchPoint, type SketchSegment } from '@aether/core/sketch';
import { createEmptyPartDocument, parsePartDocument, serializePartDocument } from '@aether/core/document';

type Path = Extract<SketchDrawing['contours'][number], { type: 'path' }>;
const line = (start: SketchPoint, end: SketchPoint, id?: string): Path => ({ type: 'path', start, segments: [{ type: 'line', end }], ...(id ? { id } : {}) });
const drawing = (...contours: SketchDrawing['contours']): SketchDrawing => ({ type: 'drawing', contours });
const rectangle = (x = 0, y = 0, width = 20, height = 10) => drawing(
  line([x, y], [x + width, y], 'bottom'), line([x + width, y], [x + width, y + height], 'right'),
  line([x + width, y + height], [x, y + height], 'top'), line([x, y + height], [x, y], 'left'),
);
const reverseLine = (path: Path) => ({ ...path, start: path.segments[0].end, segments: [{ type: 'line' as const, end: path.start }] });

describe('derived regions from separately authored open curves', () => {
  it.each(Array.from({ length: 16 }, (_, i) => i))('finds the same rectangle for source direction mask %i without mutating identities or constraints', mask => {
    const d = rectangle();
    d.contours = d.contours.map((c, i) => (mask & (1 << i)) ? reverseLine(c as Path) : c);
    d.contours = [d.contours[2], d.contours[0], d.contours[3], d.contours[1]];
    d.constraints = [{ id: 'h', kind: 'horizontal', a: { kind: 'line', contour: 1, index: 0 } }];
    const original = structuredClone(d), result = connectedSketchRegions(d);
    expect(result.issues).toEqual([]); expect(result.regions).toHaveLength(1);
    expect(new Set(result.regions[0].contourIds)).toEqual(new Set(['bottom', 'right', 'top', 'left']));
    const contour = result.regions[0].contour;
    expect(contour.start).toEqual(contour.segments.at(-1)!.end);
    expect(contour.segments).toHaveLength(4);
    expect(contour.id).toBeUndefined(); expect(contour.segments.every(s => !s.id && !s.endVertexId)).toBe(true);
    expect(d).toEqual(original);
  });

  it.each<SketchSegment>([
    { type: 'arc', middle: [10, 9], end: [20, 0] },
    { type: 'bezier', controls: [[5, 10], [15, 10]], end: [20, 0] },
    { type: 'ellipse', radiusX: 10, radiusY: 4, rotationDegrees: 0, largeArc: false, sweep: false, end: [20, 0] },
  ])('reverses $type exactly when its closing line has the same direction', segment => {
    const path: Path = { type: 'path', start: [0, 0], segments: [{ ...segment, id: 'edge', endVertexId: 'end' }], id: 'curve', startVertexId: 'begin' };
    const d = drawing(line([0, 0], [20, 0], 'line'), path), before = structuredClone(d);
    const result = connectedSketchRegions(d);
    expect(result.issues).toEqual([]); expect(result.regions).toHaveLength(1);
    const reversed = result.regions[0].contour.segments[1];
    for (const t of [0, 0.1, 0.4, 0.8, 1]) {
      const expected = segmentPoint(path.start, segment, 1 - t), actual = segmentPoint(segment.end, reversed, t);
      actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 8));
    }
    expect(d).toEqual(before);
  });

  it('retains fit-spline relationships and derives again after a knot edit and file reopen', () => {
    const d = constrainFitSpline(drawing(fitSketchSpline([[0, 0], [10, 12], [20, 0]])), 0);
    d.contours[0].id = 'spline'; d.contours.push(line([20, 0], [0, 0], 'base'));
    const document = createEmptyPartDocument('Connected spline');
    document.features.push({ id: 'profile', type: 'profile', name: 'Sketch 1', plane: 'XY', offsetMillimeters: 0, suppressed: false, profile: d });
    const reopened = parsePartDocument(serializePartDocument(document));
    const profile = reopened.features[0]; if (profile.type !== 'profile' || profile.profile.type !== 'drawing') throw Error();
    expect(profile.profile.constraints).toEqual(d.constraints);
    expect(resolveConnectedSketchRegion(profile.profile, ['base', 'spline']).contour.segments).toHaveLength(3);
    const changed = constrainFitSpline(drawing(fitSketchSpline([[0, 0], [10, 18], [20, 0]])), 0);
    changed.contours[0].id = 'spline'; changed.contours.push(line([20, 0], [0, 0], 'base'));
    expect(resolveConnectedSketchRegion(changed, ['spline', 'base']).contour).not.toEqual(resolveConnectedSketchRegion(d, ['spline', 'base']).contour);
  });

  it('keeps nested loops separate for the existing region-hole operation', () => {
    const outer = rectangle(), inner = rectangle(5, 3, 10, 4);
    inner.contours.forEach(c => { c.id += '-inner'; });
    const result = connectedSketchRegions(drawing(...outer.contours, ...inner.contours, { type: 'circle', center: [10, 5], radius: 1 }));
    expect(result.regions).toHaveLength(2); expect(result.issues).toEqual([]);
    expect(result.regions.map(r => r.contourIndices.length)).toEqual([4, 4]);
  });

  it('ignores construction and leaves existing closed profiles to the ordinary region path', () => {
    const d = rectangle(); d.contours.push({ ...line([0, 0], [20, 10]), construction: true }, { type: 'circle', center: [10, 5], radius: 2 });
    expect(connectedSketchRegions(d).regions).toHaveLength(1);
    expect(connectedSketchRegions(drawing({ type: 'circle', center: [0, 0], radius: 2 }))).toEqual({ regions: [], issues: [] });
  });

  it.each([
    ['open', () => { const d = rectangle(); d.contours.pop(); return d; }],
    ['branched', () => { const d = rectangle(); d.contours.push(line([0, 0], [-5, 0])); return d; }],
    ['invalid-boundary', () => drawing(line([0, 0], [20, 10]), line([20, 10], [0, 10]), line([0, 10], [20, 0]), line([20, 0], [0, 0]))],
    ['invalid-boundary', () => drawing(line([0, 0], [20, 0]), line([20, 0], [0, 0]))],
  ] as const)('refuses %s components', (reason, create) => {
    const result = connectedSketchRegions(create());
    expect(result.regions).toEqual([]); expect(result.issues[0].reason).toBe(reason);
  });

  it.each([
    line([10, 0], [10, 10]), line([0, 5], [-5, 5]), line([-5, 5], [25, 5]),
    { type: 'circle' as const, center: [0, 5] as SketchPoint, radius: 2 },
  ])('does not ignore another curve intersecting the boundary', other => {
    const d = rectangle(); d.contours.push(other);
    expect(connectedSketchRegions(d).regions).toEqual([]);
  });

  it('rejects a tolerance chain instead of choosing an order-dependent endpoint cluster', () => {
    const d = rectangle();
    (d.contours[3] as Path).segments[0].end = [0.75e-7, 0];
    d.contours.push(line([1.5e-7, 0], [-2, 3]));
    const result = connectedSketchRegions(d);
    expect(result.regions).toEqual([]); expect(result.issues[0].reason).toBe('ambiguous-endpoints');
  });

  it('does not heal a visible gap or replace a removed contour with coincident geometry', () => {
    const d = rectangle(), saved = ['bottom', 'right', 'top', 'left'];
    const reordered = drawing(...[...d.contours].reverse());
    expect(new Set(resolveConnectedSketchRegion(reordered, saved).contourIds)).toEqual(new Set(saved));
    d.contours[1].id = 'replacement';
    expect(() => resolveConnectedSketchRegion(d, saved)).toThrow(/missing/);
    d.contours[1].id = 'right'; (d.contours[1] as Path).start = [20.001, 0];
    expect(() => resolveConnectedSketchRegion(d, saved)).toThrow(/no longer/);
  });

  it.each([[], ['bottom'], ['bottom', 'bottom'], ['bottom', ''], ['bottom', 'unknown']].map(ids => ({ ids })))('refuses malformed or missing contributor references $ids', ({ ids }) => {
    expect(() => resolveConnectedSketchRegion(rectangle(), ids)).toThrow();
  });

  it('withholds stable identity until every source is identified, and rejects duplicate authored identities', () => {
    const d = rectangle(); delete d.contours[1].id;
    expect(connectedSketchRegions(d).regions[0].contourIds).toBeUndefined();
    d.contours[1].id = 'bottom';
    expect(() => resolveConnectedSketchRegion(d, ['bottom', 'top', 'left'])).toThrow(/ambiguous/);
  });

  it('rejects a self-crossing cubic even if no different spans intersect', () => {
    // t=.2 and .8 coincide for this cubic; the closing segment is remote.
    const path: Path = { type: 'path', start: [0, 0], segments: [{ type: 'bezier', controls: [[-0.28, -1/3], [-0.56, -1/3]], end: [0.16, 0] }] };
    const result = connectedSketchRegions(drawing(path, line([0.16, 0], [0, 0])));
    expect(result.regions).toEqual([]); expect(result.issues[0].reason).toBe('invalid-boundary');
  });
});
