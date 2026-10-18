import {createEmptyPartDocument,insertFeature,validatePartDocument,type PartDocument,type PartFeature} from '@aether/core/document';

export type SolidPrimitive = 'box'|'cylinder'|'cone'|'sphere'|'torus';
export const primitiveNames:Record<SolidPrimitive,string>={box:'Box',cylinder:'Cylinder',cone:'Cone',sphere:'Sphere',torus:'Torus'};
export type PrimitiveDimensions={width:number;length:number;height:number;radius:number;tubeRadius:number};
export const defaultPrimitiveDimensions:PrimitiveDimensions={width:20,length:30,height:10,radius:10,tubeRadius:3};
export const primitiveFields:Record<SolidPrimitive,readonly (keyof PrimitiveDimensions)[]>={
  box:['width','length','height'],cylinder:['radius','height'],cone:['radius','height'],sphere:['radius'],torus:['radius','tubeRadius'],
};

/** Primitives are editable canonical profile + solid histories, not display meshes or a second evaluator. */
export function appendSolidPrimitive(source:PartDocument|null,kind:SolidPrimitive,dimensions:PrimitiveDimensions):PartDocument {
  if(!Object.hasOwn(primitiveFields,kind))throw Error('Unknown solid primitive.');
  for(const key of primitiveFields[kind]) if(!Number.isFinite(dimensions[key])||dimensions[key]<=0||dimensions[key]>1e6)
    throw Error('Dimensions must be positive and no greater than 1,000,000 mm.');
  const {width,length,height,radius,tubeRadius}=dimensions;
  if(kind==='torus'&&tubeRadius>=radius)throw Error('The tube radius must be smaller than the major radius.');
  const name=primitiveNames[kind],sketchId=crypto.randomUUID(),bodyId=crypto.randomUUID();
  const profile:Extract<PartFeature,{type:'profile'}>={id:sketchId,type:'profile',name:`${name} profile`,suppressed:false,
    plane:kind==='sphere'||kind==='torus'||kind==='cone'?'XZ':'XY',offsetMillimeters:0,
    profile:kind==='box'?{type:'polygon',pointsMillimeters:[[-width/2,-length/2],[width/2,-length/2],[width/2,length/2],[-width/2,length/2]]}:
      kind==='cone'?{type:'polygon',pointsMillimeters:[[0,0],[radius,0],[0,height]]}:
      kind==='sphere'?{type:'drawing',contours:[{type:'path',start:[0,-radius],segments:[{type:'arc',middle:[radius,0],end:[0,radius]},{type:'line',end:[0,-radius]}]}]}:
      {type:'circle',radiusMillimeters:kind==='torus'?tubeRadius:radius,centerMillimeters:[kind==='torus'?radius:0,0]},
  };
  let result=insertFeature(source??createEmptyPartDocument(name),profile);
  const common={id:crypto.randomUUID(),name,suppressed:false,bodyId,profileFeatureId:sketchId,operation:'new' as const};
  result=insertFeature(result,kind==='sphere'||kind==='torus'||kind==='cone'?{...common,type:'revolve',axis:'Z',angleDegrees:360}:{...common,type:'extrude',distanceMillimeters:height});
  validatePartDocument(result);
  return result;
}
