import { describe, expect, it } from 'vitest';
import type { SketchPoint } from '../../aether-engine/src/sketch/drawing';
import {
  conicBounds, conicDerivative, conicKind, conicPoint, conicRhoAtPoint,
  conicSecondDerivative, reverseConic, splitConic, trimConic, validateConic,
  type ConicSegment,
} from '../../freecad-engine/browser/conic-geometry';

const start: SketchPoint = [0, 0];
const segment = (rho = .5): ConicSegment => ({ type: 'conic', control: [10, 20], end: [20, 0], rho });
function close(a: SketchPoint, b: SketchPoint, digits = 9) {
  expect(a[0]).toBeCloseTo(b[0], digits); expect(a[1]).toBeCloseTo(b[1], digits);
}

describe('exact rho-defined conic foundation', () => {
  it.each([.1, .4142135623730951, .5, .75, .95])('preserves endpoints, tangents and rho=%s midpoint', rho => {
    const s = segment(rho);
    expect(conicPoint(start, s, 0)).toEqual(start);
    expect(conicPoint(start, s, 1)).toEqual(s.end);
    close(conicPoint(start, s, .5), [10, 20 * rho]);
    const weight = rho / (1 - rho);
    close(conicDerivative(start, s, 0), [20 * weight, 40 * weight]);
    close(conicDerivative(start, s, 1), [20 * weight, -40 * weight]);
    expect(conicRhoAtPoint(start, s, [100, 20 * rho])).toBeCloseTo(rho, 12);
    expect(conicKind(rho)).toBe(rho < .5 ? 'ellipse' : rho > .5 ? 'hyperbola' : 'parabola');
  });

  it('matches an independent quarter-circle equation and exact radial tangents', () => {
    const a: SketchPoint = [10, 0], w = Math.SQRT1_2,
      s: ConicSegment = { type: 'conic', control: [10, 10], end: [0, 10], rho: w / (1 + w) };
    for (let i = 0; i <= 100; i++) {
      const p = conicPoint(a, s, i / 100), d = conicDerivative(a, s, i / 100);
      expect(p[0] ** 2 + p[1] ** 2).toBeCloseTo(100, 10);
      expect(p[0] * d[0] + p[1] * d[1]).toBeCloseTo(0, 10);
    }
    close(conicPoint(a, s, .5), [Math.SQRT1_2 * 10, Math.SQRT1_2 * 10]);
  });

  it('matches the analytic parabola, including first and second derivatives', () => {
    for (let i = 0; i <= 100; i++) {
      const t = i / 100;
      close(conicPoint(start, segment(), t), [20 * t, 40 * t * (1 - t)]);
      close(conicDerivative(start, segment(), t), [20, 40 * (1 - 2 * t)]);
      close(conicSecondDerivative(start, segment(), t), [0, -80]);
    }
  });

  it('matches an independent hyperbola equation', () => {
    const a: SketchPoint = [1, 0], w = Math.sqrt(1.5),
      s: ConicSegment = { type: 'conic', control: [1, 1 / Math.sqrt(3)], end: [2, Math.sqrt(3)], rho: w / (1 + w) };
    for (let i = 0; i <= 100; i++) {
      const p = conicPoint(a, s, i / 100), d = conicDerivative(a, s, i / 100);
      expect(p[0] ** 2 - p[1] ** 2).toBeCloseTo(1, 11);
      expect(p[0] * d[0] - p[1] * d[1]).toBeCloseTo(0, 11);
    }
  });

  it.each([.15, .5, .85])('retains exact translated/rotated conic shape and derivatives at rho=%s', rho => {
    const c = Math.cos(.73), n = Math.sin(.73),
      rotate = (p: SketchPoint): SketchPoint => [c * p[0] - n * p[1], n * p[0] + c * p[1]],
      map = (p: SketchPoint): SketchPoint => { const q = rotate(p); return [q[0] + 4e5, q[1] - 3e5]; },
      s = segment(rho), a = map(start), moved = { ...s, end: map(s.end), control: map(s.control) };
    for (const t of [0, .1, .3, .5, .8, 1]) {
      close(conicPoint(a, moved, t), map(conicPoint(start, s, t)), 8);
      close(conicDerivative(a, moved, t), rotate(conicDerivative(start, s, t)), 7);
      close(conicSecondDerivative(a, moved, t), rotate(conicSecondDerivative(start, s, t)), 7);
    }
  });

  it.each([.1, .5, .9])('uses analytic bounds even when extrema fall between display samples: %s', rho => {
    const a: SketchPoint = [-14, 7], s: ConicSegment = { type: 'conic', control: [50, 70], end: [22, -19], rho },
      b = conicBounds(a, s), values: SketchPoint[] = [];
    for (let i = 0; i <= 10000; i++) values.push(conicPoint(a, s, i / 10000));
    for (const axis of [0, 1] as const) {
      const lo = Math.min(...values.map(p => p[axis])), hi = Math.max(...values.map(p => p[axis]));
      expect(b.min[axis]).toBeLessThanOrEqual(lo + 1e-10);
      expect(b.max[axis]).toBeGreaterThanOrEqual(hi - 1e-10);
      expect(lo - b.min[axis]).toBeLessThan(1e-5);
      expect(b.max[axis] - hi).toBeLessThan(1e-5);
    }
    // Every non-endpoint bound must be an actual stationary point, not the
    // usually much larger control hull (which would make zoom-to-fit jump).
    expect(b.max[0]).toBeLessThan(50); expect(b.max[1]).toBeLessThan(70);
  });

  it.each([.1, .5, .9])('subdivision and two-ended trim preserve the exact locus: %s', rho => {
    const s = segment(rho), original = JSON.stringify(s), cut = .37,
      halves = splitConic(start, s, cut), trimmed = trimConic(start, s, .17, .83);
    close(halves[0].segment.end, conicPoint(start, s, cut));
    expect(halves[0].segment.end).toEqual(halves[1].start);
    const denominator = (t: number) => (1 - rho) * ((1 - t) ** 2 + t * t) + 2 * rho * (1 - t) * t;
    for (const [child, from, to] of [[halves[0], 0, cut], [halves[1], cut, 1], [trimmed, .17, .83]] as const) {
      validateConic(child.start, child.segment);
      const k = Math.sqrt(denominator(from) / denominator(to));
      for (let i = 0; i <= 20; i++) {
        const t = i / 20, u = k * t / (1 - t + k * t);
        close(conicPoint(child.start, child.segment, t), conicPoint(start, s, from + (to - from) * u));
      }
      expect(conicKind(child.segment.rho)).toBe(conicKind(rho));
    }
    expect(JSON.stringify(s)).toBe(original);
  });

  it('reversal preserves the curve, direction, control identity and bounds', () => {
    const s = segment(.7), reversed = reverseConic(start, s);
    for (let i = 0; i <= 25; i++) {
      const t = i / 25;
      close(conicPoint(reversed.start, reversed.segment, t), conicPoint(start, s, 1 - t));
      const d = conicDerivative(start, s, 1 - t);
      close(conicDerivative(reversed.start, reversed.segment, t), [-d[0], -d[1]]);
    }
    expect(conicBounds(reversed.start, reversed.segment)).toEqual(conicBounds(start, s));
    reversed.segment.control[0] = 99;
    expect(s.control).toEqual([10, 20]);
  });

  it('does not turn a parabola rational through repeated trim roundoff', () => {
    for (let i = 1; i < 70; i++) {
      const s = segment(), t = i / 73, trimmed = trimConic(start, s, t / 3, (2 + t) / 3);
      expect(trimmed.segment.rho).toBe(.5);
      const halves = splitConic(trimmed.start, trimmed.segment, t);
      for (const child of halves) {
        expect(child.segment.rho).toBe(.5);
        for (const u of [0, .2, .5, 1]) {
          const p = conicPoint(child.start, child.segment, u);
          expect(p[1]).toBeCloseTo(2 * p[0] - p[0] ** 2 / 10, 10);
        }
      }
    }
  });

  it('keeps small and large positive rational weights finite', () => {
    for (const rho of [1e-7, 1 - 1e-7]) {
      const s = segment(rho);
      close(conicPoint(start, s, .5), [10, 20 * rho]);
      const b = conicBounds(start, s);
      close(b.min, [0, 0]); close(b.max, [20, 20 * rho]);
      for (const t of [0, 1e-5, .25, .5, .75, 1])
        expect([...conicPoint(start, s, t), ...conicDerivative(start, s, t), ...conicSecondDerivative(start, s, t)].every(Number.isFinite)).toBe(true);
    }
  });

  it.each([0, 1, -1, 2, NaN, Infinity, true, '0.5'])('rejects invalid rho %s', rho => {
    expect(() => conicPoint(start, segment(rho as number), .5)).toThrow(/rho/);
    expect(() => conicKind(rho as number)).toThrow(/rho/);
  });

  it.each([[0, 0], [20, 0], [10, 0], [NaN, 1], [1, Infinity], [0], ['0', 5]].map(control => ({ control })))('rejects degenerate/malformed control $control', ({ control }) => {
    expect(() => validateConic(start, { ...segment(), control: control as SketchPoint })).toThrow();
  });

  it('rejects malformed endpoints, invalid evaluation/split/trim and never mutates inputs', () => {
    const s = segment(), before = JSON.stringify(s);
    for (const end of [[0, 0], [Infinity, 1], [4], [1, 2, 3]])
      expect(() => validateConic(start, { ...s, end: end as SketchPoint })).toThrow();
    for (const t of [-1, 2, NaN, Infinity]) expect(() => conicPoint(start, s, t)).toThrow(/parameter/);
    for (const t of [0, 1, -.1, NaN]) expect(() => splitConic(start, s, t)).toThrow(/Split/);
    for (const [a, b] of [[.5, .5], [.8, .2], [-.1, .5], [.2, 1.1]])
      expect(() => trimConic(start, s, a, b)).toThrow();
    const full = trimConic(start, s, 0, 1); full.segment.end[0] = 88;
    expect(JSON.stringify(s)).toBe(before);
  });
});
