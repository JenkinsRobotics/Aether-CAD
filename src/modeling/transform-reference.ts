import type {PartDocument,PartTransform,TransformVectorReference} from '@aether/core/document';
import {nativeExtrusionPoint} from './extrude-point-reference';
import {resolveSketchDirection} from './extrude-direction-reference';

/** Resolve constrained sketch coordinates for native evaluation; saved links keep identities. */
function nativeVector(doc:PartDocument,ref:TransformVectorReference,before:string) {
 if(ref.kind==='solid-edge')return ref;
 if(ref.kind==='two-points')return{kind:'two-points',from:nativeExtrusionPoint(doc,ref.from,before),to:nativeExtrusionPoint(doc,ref.to,before)};
 const line=resolveSketchDirection(doc,ref,before);
 return{kind:'two-points',...Object.fromEntries([['from',line.start],['to',line.end]].map(([key,point])=>[key,{kind:'sketch-point',local_point:point,frame:line.frame,...(line.support?{support:line.support}:{})}]))};
}
export function nativePartTransform(doc:PartDocument,t:PartTransform,before:string) {
 if(t.kind==='translate-reference'||t.kind==='rotate-reference')return{...t,reference:nativeVector(doc,t.reference,before)};
 if(t.kind==='scale-reference')return{...t,centerReference:nativeExtrusionPoint(doc,t.centerReference,before)};
 return t;
}
