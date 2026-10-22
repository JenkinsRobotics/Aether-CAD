import {expect,it} from 'vitest';
import {createEmptyPartDocument,serializePartDocument,type ExtrudeFeature,type PartDocument} from '@aether/core/document';
import {extrusionSketchPoints,nativeExtrusionPoint} from './extrude-point-reference';

function part():PartDocument {
 const doc=createEmptyPartDocument('Vertex limit');doc.features.push(
 {id:'guide',type:'profile',name:'Guide',plane:'XZ',offsetMillimeters:0,suppressed:false,profile:{type:'drawing',contours:[{id:'path',type:'path',construction:true,startVertexId:'a',start:[0,0],segments:[{id:'line',endVertexId:'b',type:'line',end:[8,20]}]}]}},
 {id:'s',type:'profile',name:'Circle',plane:'XY',offsetMillimeters:0,suppressed:false,profile:{type:'circle',centerMillimeters:[0,0],radiusMillimeters:2}},
 {id:'e',type:'extrude',name:'To point',profileFeatureId:'s',operation:'new',bodyId:'solid',distanceMillimeters:1,endType:'up-to-vertex',endOffsetMillimeters:2,suppressed:false,
 endPointReference:{kind:'sketch-point',sourceFeatureId:'guide',contourId:'path',point:'vertex',vertexId:'b',label:'Guide end'}});return doc;
}
it.each([undefined,{}, {kind:'sketch-point',sourceFeatureId:'guide',contourId:'path',point:'vertex',label:'Missing vertex'}, {kind:'sketch-point',sourceFeatureId:'guide',contourId:'path',point:'center',vertexId:'b',label:'Conflicting point'}])('rejects malformed point references %s',ref=>{
 const doc=part();Object.assign(doc.features.at(-1)!,{endPointReference:ref});expect(()=>serializePartDocument(doc)).toThrow(/point|vertex/);
});
it('rejects dormant references outside Up to vertex',()=>{const doc=part();Object.assign(doc.features.at(-1)!,{endType:'blind',endOffsetMillimeters:undefined});expect(()=>serializePartDocument(doc)).toThrow(/stopping point requires/);});
it('does not offer the duplicate closing endpoint and includes circle centers',()=>{
 const doc=part();(doc.features[0] as any).profile.contours=[{type:'path',start:[0,0],segments:[{type:'line',end:[2,0]},{type:'line',end:[0,0]}]}];
 const choices=extrusionSketchPoints(doc,'e');expect(choices.filter(p=>p.sourceFeatureId==='guide')).toHaveLength(2);expect(choices.find(p=>p.point==='center')?.position).toEqual([0,0]);
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
