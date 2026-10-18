import {validatePlanarFaceAnchor,type PlanarFaceAnchor} from './planar-face-anchor';

export const curvedSurfaceTypes=['cylinder','cone','sphere','torus','bspline','bezier','extrusion','revolution'] as const;
export type CurvedSurfaceType=typeof curvedSurfaceTypes[number];
export type CurvedSurfaceAnchor={surfaceType:CurvedSurfaceType;faceAnchor?:PlanarFaceAnchor};
interface FaceSource {sourceFeatureId:string;bodyId:string;label:string;faceAnchor?:PlanarFaceAnchor}
export type SolidFaceReference=FaceSource & (
  {normal:[number,number,number];surfaceType?:never} | {surfaceType:CurvedSurfaceType;normal?:never}
);

export function validateSolidFaceReference(ref:SolidFaceReference|undefined,
  earlier:ReadonlyMap<string,string>,missing:(id:string)=>boolean,label='Face selection') {
  if(!ref||typeof ref!=='object'||Array.isArray(ref))throw Error(`${label} needs an earlier solid face reference.`);
  const id=(value:unknown,max=256)=>typeof value==='string'&&!!value.trim()&&value.length<=max;
  if(!id(ref.sourceFeatureId)||(!earlier.has(ref.sourceFeatureId)&&!missing(ref.sourceFeatureId))||
      ['profile','sketch','plane'].includes(earlier.get(ref.sourceFeatureId)??'')||!id(ref.bodyId)||!id(ref.label,512))
    throw Error(`${label} needs an earlier solid face reference.`);
  validatePlanarFaceAnchor(ref.faceAnchor);
  if(ref.surfaceType!==undefined){
    if(!curvedSurfaceTypes.includes(ref.surfaceType)||ref.normal!==undefined)throw Error(`${label} has an invalid curved surface reference.`);
  }else if(!Array.isArray(ref.normal)||ref.normal.length!==3||!ref.normal.every(Number.isFinite)||Math.abs(Math.hypot(...ref.normal)-1)>1e-6){
    throw Error(`${label} needs a unit planar normal or a curved surface reference.`);
  }
}
