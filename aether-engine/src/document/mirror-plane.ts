import {validateSolidFaceReference,type SolidFaceReference} from './solid-face-reference';
import type {SketchPlane} from '../sketch/index';

/** Where a mirror plane comes from: a principal plane with an offset, a plane
 *  feature, or a picked planar face (SolidCraft's `plane: XY|name|{origin, normal}`). */
export type MirrorPlaneReference=
 | {kind:'principal';plane:SketchPlane;offsetMillimeters:number}
 | {kind:'feature';featureId:string}
 | ({kind:'face'}&SolidFaceReference)
 /** A straight sketch line: the plane through it along the sketch's normal. */
 | {kind:'sketch-line';sourceFeatureId:string;contourId:string;segmentId:string};

export function validateMirrorPlane(ref:MirrorPlaneReference,earlier:ReadonlyMap<string,string>,missing:(id:string)=>boolean,label='Mirror plane') {
 if(!ref||typeof ref!=='object')throw Error(`${label} is required.`);
 if(ref.kind==='principal'){if(!['XY','XZ','YZ'].includes(ref.plane)||!Number.isFinite(ref.offsetMillimeters))throw Error(`${label} needs a principal plane and a finite offset.`);return;}
 if(ref.kind==='feature'){if(typeof ref.featureId!=='string'||(!missing(ref.featureId)&&earlier.get(ref.featureId)!=='plane'))throw Error(`${label} must be an earlier plane feature.`);return;}
 if(ref.kind==='face'){validateSolidFaceReference(ref,earlier,missing,label);if(ref.surfaceType)throw Error(`${label} must be a planar face.`);return;}
 if(ref.kind==='sketch-line'){if(![ref.sourceFeatureId,ref.contourId,ref.segmentId].every(v=>typeof v==='string'&&v.trim())||(!missing(ref.sourceFeatureId)&&earlier.get(ref.sourceFeatureId)!=='profile'))throw Error(`${label} needs a straight line in an earlier sketch.`);return;}
 throw Error(`${label} is invalid.`);
}
