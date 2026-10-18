import {afterEach,expect,it,vi} from 'vitest';
import {createEmptyPartDocument,featureDependencies,featureReferenceErrors,parsePartDocument,serializePartDocument,setFeatureSuppressed,type ExtrudeFeature,type PartDocument} from '@aether/core/document';
import {nativeExtrusionStart,extrusionStartPlanes} from './extrude-start-reference';
import {translateDocument} from '../freecad-translate';
import {buildWithFreeCAD} from '../freecad-geometry';
import {analyzePart} from './part-analysis';
import {createPartExport} from './part-export';

function part():PartDocument {
 const doc=createEmptyPartDocument('Referenced start');doc.features.push(
 {id:'datum',name:'Start plane',type:'plane',plane:'XY',offsetMillimeters:10,suppressed:false},
 {id:'s',name:'Circle',type:'profile',plane:'XY',offsetMillimeters:0,suppressed:false,profile:{type:'circle',centerMillimeters:[0,0],radiusMillimeters:2}},
 {id:'e',name:'From datum',type:'extrude',profileFeatureId:'s',operation:'new',bodyId:'solid',distanceMillimeters:5,suppressed:false,startingReference:{kind:'plane',sourceFeatureId:'datum',label:'Start plane'}});return doc;
}
it('stores reference identity, follows datum edits and participates in history dependencies',()=>{
 const doc=part(),saved=parsePartDocument(serializePartDocument(doc));expect(saved).toEqual(doc);
 expect(translateDocument(saved).features.at(-1)?.parameters).toMatchObject({starting_reference:{kind:'plane',frame:{originMillimeters:[0,0,10]}},distance_mm:5,region_mode:true});
 Object.assign(doc.features[0],{offsetMillimeters:25});expect(translateDocument(doc).features.at(-1)?.parameters.starting_reference).toMatchObject({frame:{originMillimeters:[0,0,25]}});
 expect(featureDependencies(doc).get('e')).toContain('datum');expect(setFeatureSuppressed(doc,'datum',true).features.at(-1)?.suppressed).toBe(true);
 doc.features.shift();expect(()=>serializePartDocument(doc)).not.toThrow();expect(featureReferenceErrors(doc).has('e')).toBe(true);
});
it('resolves nested principal-based datum definitions each time',()=>{
 const doc=part();doc.features.splice(1,0,{id:'nested',name:'Nested',type:'plane',plane:'XY',offsetMillimeters:0,suppressed:false,definition:{method:'offset',reference:{kind:'feature',featureId:'datum'},distanceMillimeters:3}});
 const ref={kind:'plane',sourceFeatureId:'nested',label:'Nested'} as const;
 expect(nativeExtrusionStart(doc,ref,'e')).toMatchObject({frame:{originMillimeters:[0,0,13]}});
 Object.assign(doc.features[0],{offsetMillimeters:20});expect(nativeExtrusionStart(doc,ref,'e')).toMatchObject({frame:{originMillimeters:[0,0,23]}});
});
it('never reuses cached face datum geometry or suppressed, future or missing planes',()=>{
 const doc=part();Object.assign(doc.features[0],{definition:{method:'offset',reference:{kind:'face',partId:'old',faceId:0,frame:{originMillimeters:[0,0,2],normal:[0,0,1],xDirection:[1,0,0]}},distanceMillimeters:1}});
 expect(()=>nativeExtrusionStart(doc,(doc.features.at(-1) as ExtrudeFeature).startingReference!,'e')).toThrow(/captured face/);
 expect(translateDocument(doc).untranslated.at(-1)?.reason).toMatch(/Reference unavailable/);
 expect(extrusionStartPlanes(doc,'e')).toHaveLength(3);
 delete (doc.features[0] as any).definition;doc.features[0].suppressed=true;
 expect(extrusionStartPlanes(doc,'e')).toHaveLength(3);
 expect(()=>nativeExtrusionStart(doc,{kind:'plane',sourceFeatureId:'datum',label:'Datum'},'datum')).toThrow(/unavailable/);
});
it('preserves selected solid face and principal references without baking their origin',()=>{
 const doc=part();doc.features.splice(2,0,{id:'base',name:'Base',type:'extrude',profileFeatureId:'s',bodyId:'base',distanceMillimeters:10,operation:'new',suppressed:false});
 const e=doc.features.at(-1) as ExtrudeFeature;
 e.startingReference={kind:'face',sourceFeatureId:'base',bodyId:'base',normal:[0,0,1],label:'Top'};e.startingOffsetMillimeters=-2;
 expect(translateDocument(parsePartDocument(serializePartDocument(doc))).features.at(-1)?.parameters).toMatchObject({starting_reference:e.startingReference,starting_offset_mm:-2});
 expect(featureDependencies(doc).get('e')).toContain('base');
 e.startingReference={kind:'principal',plane:'XZ',label:'XZ'};expect(nativeExtrusionStart(doc,e.startingReference,'e')).toMatchObject({frame:{normal:[0,-1,0]}});
});
it.each([{},null,{kind:'principal',plane:'AB',label:'Invalid'},{kind:'plane',sourceFeatureId:'s',label:'Sketch'},
 {kind:'face',sourceFeatureId:'datum',bodyId:'base',normal:[0,0,1],label:'Plane as face'},
 {kind:'face',sourceFeatureId:'missing',bodyId:'base',normal:[0,0,2],label:'Nonunit'}])('rejects malformed starting references %s',ref=>{
 const doc=part();Object.assign(doc.features.at(-1)!,{startingReference:ref});expect(()=>serializePartDocument(doc)).toThrow(/Starting entity/);
});
afterEach(()=>vi.unstubAllGlobals());
it.each(['build','analysis','export'])('refuses %s before calling an outdated worker',async mode=>{
 const doc=part();const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({ok:true,capabilities:[]})});vi.stubGlobal('fetch',fetch);
 await expect(mode==='build'?buildWithFreeCAD(translateDocument(doc).features):mode==='analysis'?analyzePart(doc,{kind:'properties'}):createPartExport(doc,'step')).rejects.toThrow(/does not support referenced extrusion starts/);
 expect(fetch).toHaveBeenCalledTimes(1);
});

it('offers only planes before the rollback position',()=>{
 const doc=part();doc.rollbackIndex=0;expect(extrusionStartPlanes(doc)).toHaveLength(3);
 expect(()=>nativeExtrusionStart(doc,{kind:'plane',sourceFeatureId:'datum',label:'Datum'})).toThrow(/unavailable/);
});
