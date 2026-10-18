import type { SketchPoint } from '../../aether-engine/src/sketch/drawing';

/** Exact, nondegenerate rational quadratic. Start belongs to the containing
 * wire; control is the intersection of the two endpoint tangents. Rho is the
 * midpoint-to-curve / midpoint-to-control ratio (not the NURBS weight).
 * All authored geometry remains exact; display polylines are derived only. */
export interface ConicSegment {
  type: 'conic';
  end: SketchPoint;
  control: SketchPoint;
  rho: number;
}

export interface ConicSpan { start: SketchPoint; segment: ConicSegment }
type HomogeneousPoint = [number, number, number];

function point(value: unknown): asserts value is SketchPoint {
  if (!Array.isArray(value) || value.length !== 2 || !value.every(v => typeof v === 'number' && Number.isFinite(v)))
    throw Error('Conic points must contain two finite coordinates.');
}

export function validateConic(start: SketchPoint, segment: ConicSegment): void {
  point(start);
  if (!segment || segment.type !== 'conic') throw Error('Expected a conic segment.');
  point(segment.end);
  point(segment.control);
  if (!Number.isFinite(segment.rho) || segment.rho <= 0 || segment.rho >= 1)
    throw Error('Conic rho must be greater than 0 and less than 1.');
  const a = [segment.control[0] - start[0], segment.control[1] - start[1]],
    b = [segment.end[0] - start[0], segment.end[1] - start[1]],
    la = Math.hypot(...a), lb = Math.hypot(...b);
  if (!Number.isFinite(la) || !Number.isFinite(lb) || la < 1e-9 || lb < 1e-9 ||
      Math.abs((a[0] / la) * (b[1] / lb) - (a[1] / la) * (b[0] / lb)) < 1e-12)
    throw Error('Conic endpoints and control must be distinct and noncollinear.');
}

function parameter(t: number): void {
  if (!Number.isFinite(t) || t < 0 || t > 1)
    throw Error('Conic parameter must be between 0 and 1.');
}

export function conicKind(rho: number): 'ellipse' | 'parabola' | 'hyperbola' {
  if (!Number.isFinite(rho) || rho <= 0 || rho >= 1)
    throw Error('Conic rho must be greater than 0 and less than 1.');
  return rho < 0.5 ? 'ellipse' : rho > 0.5 ? 'hyperbola' : 'parabola';
}

/** Scaled weights [1-rho,rho,1-rho] avoid overflow near rho=1. Coordinates
 * relative to the start avoid cancellation on translated sketches. */
function evaluate(start: SketchPoint, s: ConicSegment, t: number) {
  validateConic(start, s);
  parameter(t);
  const u = 1 - t, r = s.rho, v = 1 - r,
    d = v * (u * u + t * t) + 2 * r * u * t,
    dp = 2 * (2 * r - 1) * (1 - 2 * t), dd = 4 * (1 - 2 * r);
  const position: SketchPoint = [0, 0], first: SketchPoint = [0, 0], second: SketchPoint = [0, 0];
  for (const i of [0, 1] as const) {
    const c = s.control[i] - start[i], e = s.end[i] - start[i],
      n = 2 * r * u * t * c + v * t * t * e,
      np = 2 * r * (1 - 2 * t) * c + 2 * v * t * e,
      npp = -4 * r * c + 2 * v * e,
      p = n / d;
    position[i] = start[i] + p;
    first[i] = (np - p * dp) / d;
    second[i] = (npp - p * dd - 2 * first[i] * dp) / d;
  }
  // Endpoint identities must remain exact across join/trim/persistence paths.
  if (t === 0) position.splice(0, 2, ...start);
  if (t === 1) position.splice(0, 2, ...s.end);
  return { position, first, second };
}

export const conicPoint = (start: SketchPoint, segment: ConicSegment, t: number) => evaluate(start, segment, t).position;
export const conicDerivative = (start: SketchPoint, segment: ConicSegment, t: number) => evaluate(start, segment, t).first;
export const conicSecondDerivative = (start: SketchPoint, segment: ConicSegment, t: number) => evaluate(start, segment, t).second;

/** Real roots of a quadratic, using the cancellation-resistant q formula. */
function roots(a: number, b: number, c: number): number[] {
  const scale = Math.max(Math.abs(a), Math.abs(b), Math.abs(c));
  if (!scale) return [];
  a /= scale; b /= scale; c /= scale;
  if (a === 0) return b === 0 ? [] : [-c / b];
  const disc = b * b - 4 * a * c;
  if (disc < 0) return [];
  if (disc === 0) return [-b / (2 * a)];
  const q = -0.5 * (b + (b < 0 ? -1 : 1) * Math.sqrt(disc));
  return [q / a, c / q];
}

/** Analytic axis extrema; no display sampling determines fit/picking bounds. */
export function conicBounds(start: SketchPoint, s: ConicSegment) {
  validateConic(start, s);
  const candidates = [start, s.end, ...stationary(start,s).map(t=>conicPoint(start,s,t))];
  return {
    min: [Math.min(...candidates.map(p => p[0])), Math.min(...candidates.map(p => p[1]))] as SketchPoint,
    max: [Math.max(...candidates.map(p => p[0])), Math.max(...candidates.map(p => p[1]))] as SketchPoint,
  };
}

function stationary(start:SketchPoint,s:ConicSegment):number[] {
  const r = s.rho, d0 = 1 - r, d1 = 2 * (2 * r - 1), d2 = -d1;
  const candidates:number[]=[];
  for (const i of [0, 1] as const) {
    const n1 = 2 * r * (s.control[i] - start[i]),
      n2 = d0 * (s.end[i] - start[i]) - n1;
    for (const t of roots(n2 * d1 - n1 * d2, 2 * n2 * d0, n1 * d0))
      if (t > 0 && t < 1) candidates.push(t);
  }
  return candidates;
}

/** Rank-one plane projection degenerates to exact line intervals. Preserve
 * interior turnarounds rather than replacing the curve with its endpoint chord. */
export function projectConic(start:SketchPoint,s:ConicSegment,map:(p:SketchPoint)=>SketchPoint,collapsed:boolean) {
  validateConic(start,s);
  const a=map(start),next:ConicSegment={...s,control:map(s.control),end:map(s.end)};
  if(!collapsed) return [next];
  const ts=[0,...stationary(a,next),1].sort((x,y)=>x-y),points=ts.map(t=>map(conicPoint(start,s,t)));
  return points.slice(1).flatMap((end,i)=>Math.hypot(end[0]-points[i][0],end[1]-points[i][1])<1e-9?[]:[{type:'line' as const,end}]);
}

/** Derived display only. The convex hull of positive rational weights gives a
 * conservative chord error bound; every emitted point lies on the exact conic. */
export function conicDisplayPolyline(start:SketchPoint,s:ConicSegment,tolerance=.025):SketchPoint[] {
  validateConic(start,s);
  if(!Number.isFinite(tolerance)||tolerance<=0) throw Error('Conic display tolerance must be positive.');
  const points:SketchPoint[]=[[...start]],pending:{span:ConicSpan;depth:number}[]=[{span:{start,segment:s},depth:0}];
  while(pending.length) {
    const {span,depth}=pending.pop()!,a=span.start,b=span.segment.end,c=span.segment.control,dx=b[0]-a[0],dy=b[1]-a[1],l=dx*dx+dy*dy,
      t=l?Math.max(0,Math.min(1,((c[0]-a[0])*dx+(c[1]-a[1])*dy)/l)):0,
      error=Math.hypot(c[0]-a[0]-t*dx,c[1]-a[1]-t*dy);
    if(error<=tolerance) {points.push([...b]);continue;}
    if(depth>=24||points.length+pending.length>=8192) throw Error('Conic display exceeds the subdivision limit.');
    const [left,right]=splitConic(a,span.segment,.5);
    pending.push({span:right,depth:depth+1},{span:left,depth:depth+1});
  }
  return points;
}

function blend(a: HomogeneousPoint, b: HomogeneousPoint, t: number): HomogeneousPoint {
  return [a[0] * (1 - t) + b[0] * t, a[1] * (1 - t) + b[1] * t, a[2] * (1 - t) + b[2] * t];
}

/** Exact de Casteljau subdivision followed by endpoint-weight normalization.
 * Normalization preserves the locus, but changes the subspan parameterization.
 * Consumers must not assume child t equals an affine rescaling of parent t. */
export function splitConic(start: SketchPoint, s: ConicSegment, t: number): [ConicSpan, ConicSpan] {
  validateConic(start, s);
  if (!Number.isFinite(t) || t <= 0 || t >= 1) throw Error('Split inside the conic, away from its endpoints.');
  const v = 1 - s.rho,
    a: HomogeneousPoint = [0, 0, v],
    b: HomogeneousPoint = [(s.control[0] - start[0]) * s.rho, (s.control[1] - start[1]) * s.rho, s.rho],
    c: HomogeneousPoint = [(s.end[0] - start[0]) * v, (s.end[1] - start[1]) * v, v],
    ab = blend(a, b, t), bc = blend(b, c, t), middle = blend(ab, bc, t);
  const cartesian = (p: HomogeneousPoint): SketchPoint => [start[0] + p[0] / p[2], start[1] + p[1] / p[2]];
  const span = (p0: HomogeneousPoint, p1: HomogeneousPoint, p2: HomogeneousPoint): ConicSpan => {
    const weight = p1[2] / Math.sqrt(p0[2] * p2[2]);
    return { start: cartesian(p0), segment: { type: 'conic', control: cartesian(p1), end: cartesian(p2), rho: s.rho === .5 ? .5 : weight / (1 + weight) } };
  };
  const left = span(a, ab, middle), right = span(middle, bc, c);
  left.start = [...start]; right.segment.end = [...s.end];
  return [left, right];
}

/** Trim by blossom evaluation in homogeneous space. Chaining normalized
 * split results would apply the second parameter in the wrong coordinate. */
export function trimConic(start: SketchPoint, s: ConicSegment, from: number, to: number): ConicSpan {
  validateConic(start, s); parameter(from); parameter(to);
  if (from >= to) throw Error('Conic trim parameters must increase.');
  if (from === 0 && to === 1) return { start: [...start], segment: { ...s, control: [...s.control], end: [...s.end] } };
  const r = s.rho, v = 1 - r;
  const blossom = (a: number, b: number): HomogeneousPoint => {
    const m = r * (a + b - 2 * a * b), e = v * a * b,
      weight = v * (1 - a) * (1 - b) + m + e;
    return [m * (s.control[0] - start[0]) + e * (s.end[0] - start[0]), m * (s.control[1] - start[1]) + e * (s.end[1] - start[1]), weight];
  };
  const a = blossom(from, from), b = blossom(from, to), c = blossom(to, to),
    w = b[2] / Math.sqrt(a[2] * c[2]);
  return { start: conicPoint(start, s, from), segment: {
    type: 'conic', control: [start[0] + b[0] / b[2], start[1] + b[1] / b[2]],
    end: conicPoint(start, s, to), rho: s.rho === .5 ? .5 : w / (1 + w),
  } };
}

export function reverseConic(start: SketchPoint, s: ConicSegment): ConicSpan {
  validateConic(start, s);
  return { start: [...s.end], segment: { ...s, end: [...start], control: [...s.control] } };
}

/** Original parameter -> normalized child parameter. Used for persistent
 * tangent/point contacts after exact rational subdivision. */
export function conicSubspanParameter(rho:number,t:number,from:number,to:number):number {
  conicKind(rho); parameter(t); parameter(from); parameter(to);
  if(from>=to) throw Error('Conic trim parameters must increase.');
  const denominator=(v:number)=>(1-rho)*((1-v)**2+v*v)+2*rho*v*(1-v),
    k=Math.sqrt(denominator(from)/denominator(to)),u=Math.max(0,Math.min(1,(t-from)/(to-from)));
  return u/(k+(1-k)*u);
}

/** A rho handle moves along the midpoint/control axis. Off-axis pointer motion
 * does not skew the curve; callers decide whether to clamp or reject the ratio. */
export function conicRhoAtPoint(start: SketchPoint, s: ConicSegment, pointer: SketchPoint): number {
  validateConic(start, s); point(pointer);
  const m: SketchPoint = [start[0] + (s.end[0] - start[0]) / 2, start[1] + (s.end[1] - start[1]) / 2],
    dx = s.control[0] - m[0], dy = s.control[1] - m[1];
  return ((pointer[0] - m[0]) * dx + (pointer[1] - m[1]) * dy) / (dx * dx + dy * dy);
}
