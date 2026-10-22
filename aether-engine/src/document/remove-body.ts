/** Remove (SolidCraft's solid.remove): the parts go away from here on in the history. */
export interface RemoveBodyFeature { id:string;type:'remove-body';name:string;suppressed:boolean;bodyIds:string[] }
export function validateRemoveBody(feature:RemoveBodyFeature) {
  if(!Array.isArray(feature.bodyIds)||!feature.bodyIds.length||!feature.bodyIds.every(id=>typeof id==='string'&&id.trim()))throw Error('Choose the parts to remove.');
}
