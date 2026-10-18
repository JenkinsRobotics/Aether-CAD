import {expect,it} from 'vitest';
import {createEmptyPartDocument,type PartDocument,type ProfileFeature} from '@aether/core/document';
import type {SketchDrawing} from '@aether/core/sketch';
import {sketchPierceChoices} from '../../freecad-engine/browser/pierce-choices';
import {stageSketchPierce} from '../../freecad-engine/browser/pierce-authoring';
import {preparePierceDraft} from '../../freecad-engine/browser/pierce-draft';

function setup():PartDocument {
 const document=createEmptyPartDocument('Pierce choices');document.features=[
  {id:'source',name:'Source',type:'profile',plane:'XY',offsetMillimeters:0,suppressed:false,profile:{type:'drawing',contours:[{type:'path',start:[0,-5],segments:[{type:'line',end:[20,5]}]}]}},
  {id:'target',name:'Target',type:'profile',plane:'XZ',offsetMillimeters:0,suppressed:false,profile:{type:'drawing',contours:[{type:'circle',center:[0,0],radius:3}],constraints:[{id:'radius',kind:'radius',a:{contour:0,kind:'circle'},value:3}]}},
 ];return document;
}
const drawing=(doc:PartDocument,id='target')=>(doc.features.find(f=>f.id===id) as ProfileFeature).profile as SketchDrawing;
const attach=(doc=setup())=>stageSketchPierce(doc,'target',{contour:0,kind:'point',index:0},'source',0,0,0);

it('offers exact finite intersections without assigning identities during discovery',()=>{
 const doc=setup(),before=structuredClone(doc),choices=sketchPierceChoices(doc.features,'target');
 expect(choices).toHaveLength(1);expect(choices[0]).toMatchObject({sourceId:'source',sourceName:'Source',curveType:'line',hits:[{point:[10,0]}]});
 expect(doc).toEqual(before);expect(choices[0].contourId).toBeUndefined();
});
it.each(['suppressed','later','coplanar','noncrossing'])('never offers %s source geometry as a projected substitute',kind=>{
 const doc=setup(),source=doc.features[0] as ProfileFeature;
 if(kind==='suppressed')source.suppressed=true;
 if(kind==='later')doc.features.reverse();
 if(kind==='coplanar')source.plane='XZ';
 if(kind==='noncrossing'){const path=drawing(doc,'source').contours[0];if(path.type==='path')path.segments[0].end=[20,-1];}
 expect(sketchPierceChoices(doc.features,'target')).toEqual([]);
});
it('keeps a missing source relationship for repair instead of accepting its cached contact',()=>{
 const doc=attach().document,relation=drawing(doc).constraints![1];relation.source!.sourceFeatureId='missing';
 const stale={...drawing(doc),pierceContext:{[relation.id]:{source:relation.source!,point:[10,0] as [number,number]}}};
 const prepared=preparePierceDraft(doc.features,'target',stale);
 expect(prepared.issues).toMatchObject([{id:relation.id}]);expect(prepared.drawing.constraints).toEqual(stale.constraints);expect(prepared.drawing.pierceContext).toBeUndefined();
});
it('preserves other missing relationships while repairing one source under the same identity',()=>{
 const doc=attach().document,first=drawing(doc).constraints![1],second=structuredClone(first);second.id='other';second.source!.sourceFeatureId='absent';drawing(doc).constraints!.push(second);first.source!.sourceFeatureId='missing';
 const before=structuredClone(doc),repaired=stageSketchPierce(doc,'target',first.a,'source',0,0,0,first.id);
 expect(repaired.issues).toMatchObject([{id:'other'}]);expect(drawing(repaired.document).constraints!.map(c=>c.id)).toEqual(['radius',first.id,'other']);
 expect(drawing(repaired.document).constraints![1].source!.sourceFeatureId).toBe('source');expect(doc).toEqual(before);
});
it('rejects duplicate finite-curve relationships even if the picked contact parameter changes',()=>{
 const doc=setup();Object.assign(drawing(doc),{contours:[{type:'path',start:[0,0],segments:[{type:'line',end:[20,0]}]}],constraints:[]});
 const first=stageSketchPierce(doc,'target',{contour:0,kind:'curve',index:0,parameter:.5},'source',0,0,0);
 const second=stageSketchPierce(first.document,'target',{contour:0,kind:'curve',index:0,parameter:.2},'source',0,0,0);
 expect(second.added).toBe(false);expect(second.document).toBe(first.document);expect(drawing(first.document).constraints).toHaveLength(1);
});
