import {expect,it} from 'vitest';
import {createEmptyPartDocument,validatePartDocument,type ExtrudeFeature} from './part-document';
import {featureDependencies,setFeatureSuppressed,moveFeature} from './feature-history';
import {parsePartDocument,serializePartDocument} from './part-serialization';
const part=()=>({...createEmptyPartDocument('Ends'),features:[
 {id:'s',type:'profile' as const,name:'Sketch',plane:'XY' as const,offsetMillimeters:0,suppressed:false,profile:{type:'circle' as const,radiusMillimeters:10,centerMillimeters:[0,0] as [number,number]}},
 {id:'limit',type:'extrude' as const,name:'Limit',profileFeatureId:'s',distanceMillimeters:5,operation:'new' as const,bodyId:'limit-body',suppressed:false},
 {id:'e',type:'extrude' as const,name:'Ends',profileFeatureId:'s',distanceMillimeters:10,operation:'new' as const,bodyId:'part',suppressed:false,
  secondEnd:{endType:'up-to-face' as const,distanceMillimeters:1,endReference:{sourceFeatureId:'limit',bodyId:'limit-body',normal:[0,0,1] as [number,number,number],label:'Stop'}}},
]});
it('persists both end definitions and tracks the opposite stopping face in history',()=>{
 const doc=part();expect(parsePartDocument(serializePartDocument(doc))).toEqual(doc);
 expect(featureDependencies(doc).get('e')).toEqual(['s','limit']);
 expect(()=>moveFeature(doc,'e',-1)).toThrow();
 expect(setFeatureSuppressed(doc,'limit',true).features.find(f=>f.id==='e')?.suppressed).toBe(true);
});
it.each([
 {secondEnd:{endType:'blind',distanceMillimeters:0}},
 {secondEnd:{endType:'symmetric',distanceMillimeters:5}},
 {secondEnd:{endType:'blind',distanceMillimeters:5},secondDistanceMillimeters:3},
 {secondEnd:{endType:'blind',distanceMillimeters:5},endType:'symmetric'},
 {secondEnd:{endType:'through-all',distanceMillimeters:1}},
 {secondEnd:{endType:'blind',distanceMillimeters:5,draftAngleDegrees:90}},
 {secondEnd:{endType:'up-to-face',distanceMillimeters:1}},
 {secondEnd:{endType:'blind',distanceMillimeters:5,endOffsetMillimeters:1}},
])('rejects ambiguous or malformed opposite ends',options=>{
 const doc=part();Object.assign(doc.features[2],options);expect(()=>validatePartDocument(doc)).toThrow();
});
it('keeps legacy intervals loadable and supports sketch-neutral symmetric draft',()=>{
 const doc=part();const end=doc.features[2] as ExtrudeFeature;delete end.secondEnd;end.secondDistanceMillimeters=5;end.startingOffsetMillimeters=3;
 expect(parsePartDocument(serializePartDocument(doc))).toEqual(doc);
 delete end.secondDistanceMillimeters;end.endType='symmetric';end.draftAngleDegrees=5;
 expect(parsePartDocument(serializePartDocument(doc))).toEqual(doc);
});
