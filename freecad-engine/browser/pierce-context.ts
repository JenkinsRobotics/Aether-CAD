/** Canonical Pierce references and derived, nonpersistent solver context. */
import type { PartFeature } from '../../aether-engine/src/document/part-document';
import type { SketchDrawing, SketchPoint } from '../../aether-engine/src/sketch/drawing';
import type { DrawingConstraint } from '../../aether-engine/src/sketch/solver/types';
import { resolveSketchPierce, type SketchPierceReference } from './pierce-reference';
import { resolve } from '../../aether-engine/src/sketch/solver/entities';

export type PierceContext = Record<string, { source: SketchPierceReference; point: SketchPoint }>;

export function validatePierceConstraint(c: DrawingConstraint): void {
  if (c.kind !== 'pierce') {
    if (c.source !== undefined) throw Error('A Pierce source requires a Pierce constraint.');
    return;
  }
  const s=c.source, b=s?.branch;
  const id=(v:unknown)=>typeof v==='string'&&!!v.trim()&&v.length<=128;
  if (!s || s.kind!=='sketch-curve' || !id(s.sourceFeatureId) || !id(s.sourceContourId) ||
    (s.sourceSegmentId!==undefined&&!id(s.sourceSegmentId)) || !b || ![-1,0,1].includes(b.direction) ||
    !Number.isInteger(b.ordinal) || b.ordinal<0 || !Array.isArray(b.counts) || b.counts.length!==3 ||
    !b.counts.every(n=>Number.isInteger(n)&&n>=0) || b.ordinal>=b.counts[b.direction+1])
    throw Error('Pierce needs a valid stable source and selected intersection branch.');
  if (!c.a || c.a.projectedContourId!==undefined ||
    Object.keys(c).some(key=>!['id','kind','a','source'].includes(key)))
    throw Error('Pierce constrains one editable point or curve to its external source.');
}

function sameSource(a:SketchPierceReference,b:SketchPierceReference) {
  return a.kind===b.kind&&a.sourceFeatureId===b.sourceFeatureId&&a.sourceContourId===b.sourceContourId&&a.sourceSegmentId===b.sourceSegmentId&&
    a.branch.direction===b.branch.direction&&a.branch.ordinal===b.branch.ordinal&&a.branch.counts.every((n,i)=>n===b.branch.counts[i]);
}

export function pierceContextPoint(drawing:SketchDrawing,c:DrawingConstraint):SketchPoint {
  validatePierceConstraint(c);
  const context=drawing.pierceContext?.[c.id];
  if (!context || !context.source || !sameSource(context.source,c.source!) || !Array.isArray(context.point) ||
    context.point.length!==2 || !context.point.every(Number.isFinite))
    throw Error('Pierce source context is missing or stale. Resolve the sketch in its document.');
  return context.point;
}

export function withPierceContext(features:readonly PartFeature[],targetId:string,drawing:SketchDrawing,resolveDrawing?:(id:string)=>SketchDrawing):SketchDrawing {
  const next=structuredClone(drawing);delete next.pierceContext;
  for(const c of next.constraints??[]) {
    validatePierceConstraint(c);
    if(c.kind!=='pierce')continue;
    const hit=resolveSketchPierce(features,targetId,c.source!,resolveDrawing);
    (next.pierceContext??=Object.create(null))[c.id]={source:structuredClone(c.source!),point:[...hit.point]};
  }
  return next;
}

export function pierceDependencies(drawing:SketchDrawing):string[] {
  return [...new Set((drawing.constraints??[]).filter(c=>c.kind==='pierce').map(c=>c.source?.sourceFeatureId??'missing-pierce-source'))];
}

/** Validate saved shape without pretending that stale coordinates satisfy an
 * external relation. Full document resolution validates those equations. */
export function localPierceValidation(drawing:SketchDrawing):SketchDrawing {
  if(drawing.pierceContext!==undefined)throw Error('Resolved Pierce context must not be saved.');
  if(drawing.constraints?.some(c=>c.kind==='pierce')) {
    const ids=drawing.constraints.map(c=>c.id);
    if(ids.length>512||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!id.trim()))throw Error('Invalid or duplicate sketch constraint identities.');
  }
  for(const c of drawing.constraints??[]) {
    validatePierceConstraint(c);
    if(c.kind==='pierce')resolve(drawing,c.a);
  }
  return {...drawing,constraints:drawing.constraints?.filter(c=>c.kind!=='pierce')};
}
