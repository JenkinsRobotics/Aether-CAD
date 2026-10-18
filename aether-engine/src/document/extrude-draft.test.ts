import {expect,it} from 'vitest';
import {createEmptyPartDocument,validatePartDocument,type ExtrudeFeature} from './part-document';
import {parsePartDocument,serializePartDocument} from './part-serialization';

const model=(draft:Partial<ExtrudeFeature>={})=>({...createEmptyPartDocument('Taper'),features:[
 {id:'s',type:'profile' as const,name:'Sketch',plane:'XY' as const,offsetMillimeters:0,suppressed:false,profile:{type:'circle' as const,radiusMillimeters:10,centerMillimeters:[0,0] as [number,number]}},
 {id:'e',type:'extrude' as const,name:'Drafted extrude',profileFeatureId:'s',distanceMillimeters:10,operation:'new' as const,suppressed:false,...draft},
]});
it.each([undefined,0,5,-5])('roundtrips optional signed draft %s without migrating old extrusions',angle=>{
 const doc=model(angle===undefined?{}:{draftAngleDegrees:angle});
 expect(parsePartDocument(serializePartDocument(doc))).toEqual(doc);
});
it.each([
 {draftAngleDegrees:90},{draftAngleDegrees:-90},{draftAngleDegrees:NaN},
])('rejects unsupported draft parameters before geometry',values=>{
 expect(()=>validatePartDocument(model(values))).toThrow(/draft/i);
});

it.each(['up-to-next','through-all'] as const)('roundtrips independent drafted %s limits',endType=>{
 const doc=model({draftAngleDegrees:5,endType,operation:'cut',targetBodyId:'part',secondEnd:{endType,distanceMillimeters:1,draftAngleDegrees:-3}});
 expect(parsePartDocument(serializePartDocument(doc))).toEqual(doc);
});
