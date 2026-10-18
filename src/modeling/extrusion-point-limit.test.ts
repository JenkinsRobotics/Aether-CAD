import {afterEach,expect,it,vi} from 'vitest';
import {createEmptyPartDocument,parsePartDocument,serializePartDocument,featureDependencies,setFeatureSuppressed,featureReferenceErrors,type ExtrudeFeature,type PartDocument} from '@aether/core/document';
import {extrusionSketchPoints,nativeExtrusionPoint} from './extrude-point-reference';
import {translateDocument} from '../freecad-translate';
import {buildWithFreeCAD} from '../freecad-geometry';
import {analyzePart} from './part-analysis';
import {createPartExport} from './part-export';

function part():PartDocument {
 const doc=createEmptyPartDocument('Vertex limit');doc.features.push(
 {id:'guide',type:'profile',name:'Guide',plane:'XZ',offsetMillimeters:0,suppressed:false,profile:{type:'drawing',contours:[{id:'path',type:'path',construction:true,startVertexId:'a',start:[0,0],segments:[{id:'line',endVertexId:'b',type:'line',end:[8,20]}]}]}},
 {id:'s',type:'profile',name:'Circle',plane:'XY',offsetMillimeters:0,suppressed:false,profile:{type:'circle',centerMillimeters:[0,0],radiusMillimeters:2}},
 {id:'e',type:'extrude',name:'To point',profileFeatureId:'s',operation:'new',bodyId:'solid',distanceMillimeters:1,endType:'up-to-vertex',endOffsetMillimeters:2,suppressed:false,
 endPointReference:{kind:'sketch-point',sourceFeatureId:'guide',contourId:'path',point:'vertex',vertexId:'b',label:'Guide end'}});return doc;
}
it('persists stable sketch point references on both ends and resolves current constrained positions',()=>{
 const doc=part(),e=doc.features.at(-1) as ExtrudeFeature;e.secondEnd={endType:'up-to-vertex',distanceMillimeters:1,endPointReference:e.endPointReference,endOffsetMillimeters:-3};
 const saved=parsePartDocument(serializePartDocument(doc));expect(saved).toEqual(doc);
 expect(translateDocument(saved).features.at(-1)?.parameters).toMatchObject({end_type:'up-to-vertex',end_point_reference:{kind:'sketch-point',local_point:[8,20]},second_end:{end_point_reference:{local_point:[8,20]},end_offset_mm:-3}});
 const guide=doc.features[0] as any;guide.profile.contours[0].segments[0].end=[9,30];guide.profile.contours.unshift({id:'other',type:'circle',center:[0,0],radius:1});
 expect(nativeExtrusionPoint(doc,e.endPointReference!,'e')).toMatchObject({local_point:[9,30]});
 expect(featureDependencies(doc).get('e')).toContain('guide');expect(setFeatureSuppressed(doc,'guide',true).features.at(-1)?.suppressed).toBe(true);
});
it('reports deleted or changed points for repair instead of cached coordinates',()=>{
 const doc=part();(doc.features[0] as any).profile.contours[0].segments[0].endVertexId='replacement';
 expect(translateDocument(doc).untranslated.at(-1)?.reason).toMatch(/Stopping sketch point is unavailable/);
 doc.features.shift();expect(()=>serializePartDocument(doc)).not.toThrow();expect(featureReferenceErrors(doc).has('e')).toBe(true);
});
it.each([undefined,{}, {kind:'sketch-point',sourceFeatureId:'guide',contourId:'path',point:'vertex',label:'Missing vertex'}, {kind:'sketch-point',sourceFeatureId:'guide',contourId:'path',point:'center',vertexId:'b',label:'Conflicting point'}])('rejects malformed point references %s',ref=>{
 const doc=part();Object.assign(doc.features.at(-1)!,{endPointReference:ref});expect(()=>serializePartDocument(doc)).toThrow(/point|vertex/);
});
it('rejects dormant references outside Up to vertex',()=>{const doc=part();Object.assign(doc.features.at(-1)!,{endType:'blind',endOffsetMillimeters:undefined});expect(()=>serializePartDocument(doc)).toThrow(/stopping point requires/);});
it('does not offer the duplicate closing endpoint and includes circle centers',()=>{
 const doc=part();(doc.features[0] as any).profile.contours=[{type:'path',start:[0,0],segments:[{type:'line',end:[2,0]},{type:'line',end:[0,0]}]}];
 const choices=extrusionSketchPoints(doc,'e');expect(choices.filter(p=>p.sourceFeatureId==='guide')).toHaveLength(2);expect(choices.find(p=>p.point==='center')?.position).toEqual([0,0]);
});
it('preserves solid anchor dependencies and checks malformed anchors',()=>{
 const doc=part();doc.features.splice(2,0,{id:'base',type:'extrude',name:'Base',profileFeatureId:'s',operation:'new',bodyId:'base',distanceMillimeters:20,suppressed:false});
 const ref={kind:'solid-vertex',sourceFeatureId:'base',bodyId:'base',label:'Corner',anchor:{positionMillimeters:[1,2,20],signature:'native-signature',incidence:'native-incidence',shapeFingerprint:'a'.repeat(64)}};
 Object.assign(doc.features.at(-1)!,{endPointReference:ref});expect(featureDependencies(doc).get('e')).toContain('base');expect(translateDocument(parsePartDocument(serializePartDocument(doc))).features.at(-1)?.parameters.end_point_reference).toEqual(ref);
 for(const bad of [{...ref.anchor,shapeFingerprint:'wrong'},{...ref.anchor,positionMillimeters:[1,2,NaN]},{...ref.anchor,signature:''}]){
  Object.assign(doc.features.at(-1)!,{endPointReference:{...ref,anchor:bad}});expect(()=>serializePartDocument(doc)).toThrow(/vertex anchor/);
 }
});
afterEach(()=>vi.unstubAllGlobals());
it.each(['build','analysis','export'])('refuses %s without native point-limit capability',async mode=>{
 const doc=part();const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({ok:true,capabilities:[]})});vi.stubGlobal('fetch',fetch);
 await expect(mode==='build'?buildWithFreeCAD(translateDocument(doc).features):mode==='analysis'?analyzePart(doc,{kind:'properties'}):createPartExport(doc,'step')).rejects.toThrow(/does not support Up to vertex/);
 expect(fetch).toHaveBeenCalledTimes(1);
});

it('uses solved endpoint geometry rather than the stored unsolved coordinates',()=>{
 const doc=part(),guide=doc.features[0] as any;
 guide.profile.contours[0].start=[0,0];guide.profile.contours[0].segments[0].end=[1,19];
 guide.profile.constraints=[{id:'fix',kind:'fix',a:{kind:'point',contour:0,index:0},point:[0,0]},
 {id:'vertical',kind:'vertical',a:{kind:'line',contour:0,index:0}},
 {id:'length',kind:'length',a:{kind:'line',contour:0,index:0},value:25}];
 const ref=(doc.features.at(-1) as ExtrudeFeature).endPointReference!;
 expect((nativeExtrusionPoint(doc,ref,'e') as any).local_point[1]).toBeCloseTo(25,6);
 guide.profile.constraints[2].value=35;
 expect((nativeExtrusionPoint(doc,ref,'e') as any).local_point[1]).toBeCloseTo(35,6);
 expect(guide.profile.contours[0].segments[0].end).toEqual([1,19]);
});

it('refuses unqualified projected point references instead of using a cached projection frame',()=>{
 const doc=part();doc.features.splice(1,0,{id:'projected',name:'Projected guide',type:'profile',plane:'XZ',offsetMillimeters:0,suppressed:false,profile:{type:'projection',sourceFeatureId:'guide'}});
 expect(extrusionSketchPoints(doc,'e').some(p=>p.sourceFeatureId==='projected')).toBe(false);
 expect(()=>nativeExtrusionPoint(doc,{kind:'sketch-point',sourceFeatureId:'projected',contourId:'path',point:'vertex',vertexId:'b',label:'Projected'},'e')).toThrow(/unavailable/);
});
