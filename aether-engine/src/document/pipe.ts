/** Pipe (SolidCraft's solid.pipe): a round section swept along a sketch curve,
 *  optionally hollow with a wall thickness. */
export interface PipeFeature {
  id:string;type:'pipe';name:string;suppressed:boolean;
  pathFeatureId:string;pathContourId?:string;
  diameterMillimeters:number;wallMillimeters?:number;
  operation:'new'|'add'|'cut';bodyId?:string;targetBodyId?:string;
}
export function validatePipe(feature:PipeFeature,earlier:ReadonlyMap<string,string>,missing:(id:unknown)=>boolean) {
  if(typeof feature.pathFeatureId!=='string'||(!missing(feature.pathFeatureId)&&!['sketch','profile','curve3d'].includes(earlier.get(feature.pathFeatureId)??'')))throw Error('Pipe needs a path curve in an earlier sketch.');
  if(!(Number.isFinite(feature.diameterMillimeters)&&feature.diameterMillimeters>0))throw Error('Pipe diameter must be positive.');
  if(feature.wallMillimeters!==undefined&&!(Number.isFinite(feature.wallMillimeters)&&feature.wallMillimeters>0&&feature.wallMillimeters<feature.diameterMillimeters/2))throw Error('Pipe wall must be positive and less than the radius.');
  if(!['new','add','cut'].includes(feature.operation))throw Error('Invalid pipe operation.');
}
