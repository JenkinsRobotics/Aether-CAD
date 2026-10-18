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
