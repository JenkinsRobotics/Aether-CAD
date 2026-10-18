import {expect,it} from 'vitest';
import {createEmptyPartDocument,validatePartDocument} from './part-document';
import {parsePartDocument,serializePartDocument} from './part-serialization';
const model=(extra:Record<string,unknown>={})=>({...createEmptyPartDocument('Direction'),features:[
 {id:'s',type:'profile' as const,name:'Sketch',plane:'XY' as const,offsetMillimeters:0,suppressed:false,profile:{type:'circle' as const,radiusMillimeters:2,centerMillimeters:[0,0] as [number,number]}},
 {id:'e',type:'extrude' as const,name:'Extrude',profileFeatureId:'s',distanceMillimeters:10,operation:'new' as const,suppressed:false,...extra},
]});
it('roundtrips world direction and symmetric Through-all without changing old records',()=>{
 for(const fields of [{},{directionVector:[.6,0,.8]},{endType:'symmetric-through-all',operation:'cut',targetBodyId:'part',draftAngleDegrees:5}]){
  const doc=model(fields);expect(parsePartDocument(serializePartDocument(doc))).toEqual(doc);
 }
});
it.each([{directionVector:[0,0,0]},{directionVector:[1,0,1]},{directionVector:[NaN,0,1]},{directionVector:[0,1]},{endType:'symmetric-through-all'},{endType:'symmetric-through-all',operation:'cut',secondEnd:{endType:'blind',distanceMillimeters:5}},{endType:'symmetric-through-all',operation:'cut',secondDistanceMillimeters:5}])('rejects malformed directions and ambiguous symmetric ends',fields=>{expect(()=>validatePartDocument(model(fields))).toThrow();});
