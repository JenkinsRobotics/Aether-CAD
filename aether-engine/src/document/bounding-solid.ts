/** Bounding Solid (SolidCraft's solid.bounding_solid): the axis-aligned box
 *  around the chosen parts (default: every part so far), grown by a margin, as a
 *  new part. */
export interface BoundingSolidFeature {
  id:string;type:'bounding-solid';name:string;suppressed:boolean;
  bodyIds?:string[];marginMillimeters:number;operation:'new';bodyId?:string;
}
export function validateBoundingSolid(feature:BoundingSolidFeature) {
  if(feature.bodyIds!==undefined&&(!Array.isArray(feature.bodyIds)||!feature.bodyIds.length||!feature.bodyIds.every(id=>typeof id==='string')))throw Error('Choose the parts to bound, or leave the list empty for all.');
  if(!(Number.isFinite(feature.marginMillimeters)&&feature.marginMillimeters>=0))throw Error('Bounding margin must be zero or positive.');
  if(feature.operation!=='new')throw Error('A bounding solid is always a new part.');
}
