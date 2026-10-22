import {validateExtrusionPointReference,type SolidVertexAnchor} from './extrusion-point-reference';

/** Ordered endpoint anchors plus native straight-edge membership; never an EdgeN index. */
export interface SolidEdgeAnchor {start:SolidVertexAnchor;end:SolidVertexAnchor}
export interface SolidEdgeReference {
 kind:'solid-edge';sourceFeatureId:string;bodyId:string;anchor:SolidEdgeAnchor;label:string;
}
export function validateSolidEdgeReference(ref:SolidEdgeReference,earlier:ReadonlyMap<string,string>,missing:(id:string)=>boolean) {
 if(!ref.anchor)throw Error('Select a straight solid edge with valid endpoint anchors.');
 for(const anchor of [ref.anchor.start,ref.anchor.end])validateExtrusionPointReference({...ref,kind:'solid-vertex',anchor},earlier,missing);
 if(ref.anchor.start.shapeFingerprint!==ref.anchor.end.shapeFingerprint||Math.hypot(...ref.anchor.start.positionMillimeters.map((v,i)=>v-ref.anchor.end.positionMillimeters[i]))<1e-9)throw Error('Solid edge endpoints must be distinct and come from the same source shape.');
}

/** A curved (or any) edge by where its midpoint sits and how long it is, in the
 *  body's own coordinates. Resolved to the one edge whose midpoint and length still
 *  match; a changed edge refuses rather than taking the nearest. */
export interface CurvedEdgeReference {
 kind:'curved-edge';sourceFeatureId:string;bodyId:string;label:string;
 midpointMillimeters:[number,number,number];lengthMillimeters:number;radiusMillimeters?:number;
}
/** A pick may carry its own radius (fillet); otherwise the feature's size applies. */
export type EdgeFinishEdge=(SolidEdgeReference|CurvedEdgeReference)&{radiusMillimeters?:number};
export function validateEdgeFinishEdge(ref:EdgeFinishEdge,earlier:ReadonlyMap<string,string>,missing:(id:string)=>boolean) {
 if(!ref||typeof ref!=='object')throw Error('Select solid edges to finish.');
 if(ref.radiusMillimeters!==undefined&&!(ref.radiusMillimeters>0))throw Error('Edge sizes must be positive.');
 if(ref.kind==='solid-edge'){validateSolidEdgeReference(ref,earlier,missing);return;}
 if(ref.kind!=='curved-edge'||typeof ref.sourceFeatureId!=='string'||(!earlier.has(ref.sourceFeatureId)&&!missing(ref.sourceFeatureId))||typeof ref.bodyId!=='string'||typeof ref.label!=='string'
  ||!Array.isArray(ref.midpointMillimeters)||ref.midpointMillimeters.length!==3||!ref.midpointMillimeters.every(Number.isFinite)||!(ref.lengthMillimeters>0)
  )throw Error('Select solid edges on an earlier feature to finish.');
}
