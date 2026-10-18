import {expect,it} from 'vitest';
import {createEmptyPartDocument,serializePartDocument,parsePartDocument,resolveProfileDrawing,featureDependencies,featureReferenceErrors,removeFeature,setFeatureSuppressed,moveFeature,updatePartDocumentVariables,type PartDocument,type ProfileFeature} from '@aether/core/document';
import {solveDrawingConstraints,sketchConstraintState,type SketchDrawing} from '@aether/core/sketch';
import {addSketchPierce} from '../../freecad-engine/browser/pierce-authoring';
import {withPierceContext} from '../../freecad-engine/browser/pierce-context';
import {sketchRegions,translateDocument} from '../freecad-translate';
function setup():PartDocument {
 const document=createEmptyPartDocument('Pierce');document.features=[
  {id:'source',name:'Source',type:'profile',plane:'XY',offsetMillimeters:0,suppressed:false,profile:{type:'drawing',contours:[{type:'path',start:[0,-5],segments:[{type:'line',end:[20,5]}]}]}},
  {id:'target',name:'Target',type:'profile',plane:'XZ',offsetMillimeters:0,suppressed:false,profile:{type:'drawing',contours:[{type:'circle',center:[0,0],radius:3}],constraints:[{id:'radius',kind:'radius',a:{contour:0,kind:'circle'},value:3}]}},
 ];return document;
}
const attach=(doc=setup())=>addSketchPierce(doc,'target',{contour:0,kind:'point',index:0},'source',0,0,0);
const drawing=(doc:PartDocument,id='target')=>(doc.features.find(f=>f.id===id) as ProfileFeature).profile as SketchDrawing;
it('saves one associative constraint, source identities, and no derived contacts in Part21',()=>{
 const original=setup(),before=structuredClone(original),doc=attach(original);expect(original).toEqual(before);
 const text=serializePartDocument(doc),reopened=parsePartDocument(text);expect(doc.formatVersion).toBe(21);expect(reopened).toEqual(doc);
 expect(text).toContain('"kind": "pierce"');expect(text).not.toMatch(/pierceContext|worldPoint|projectionContext/);
 expect(drawing(doc).constraints?.map(c=>c.id)).toEqual(['radius','pierce-1']);
 expect(resolveProfileDrawing(doc.features,'target').contours[0]).toMatchObject({center:[expect.closeTo(10,7),expect.closeTo(0,7)],radius:3});
});
it('follows source geometry after save/reopen without rewriting the source coordinates',()=>{
 const doc=parsePartDocument(serializePartDocument(attach())),path=drawing(doc,'source').contours[0];if(path.type!=='path')throw Error();path.segments[0].end=[40,5];
 const reopened=parsePartDocument(serializePartDocument(doc)),result=resolveProfileDrawing(reopened.features,'target');
 expect(result.contours[0]).toMatchObject({center:[expect.closeTo(20,7),expect.closeTo(0,7)],radius:3});
 expect(drawing(reopened,'source').contours[0]).toEqual(path);
});
it('tracks feature dependency and preserves repairable missing/suppressed sources',()=>{
 const doc=attach();expect(featureDependencies(doc).get('target')).toEqual(['source']);
 const gone=removeFeature(doc,'source');expect(featureReferenceErrors(gone).get('target')).toMatch(/Missing reference/);expect(parsePartDocument(serializePartDocument(gone))).toEqual(gone);
 const suppressed=setFeatureSuppressed(doc,'source',true);expect(suppressed.features[1].suppressed).toBe(true); suppressed.features[1].suppressed=false;expect(featureReferenceErrors(suppressed).get('target')).toMatch(/Reference unavailable/);
 expect(()=>resolveProfileDrawing(suppressed.features,'target')).toThrow(/suppressed/);
 const restored=setFeatureSuppressed(suppressed,'source',false);expect(resolveProfileDrawing(restored.features,'target').contours).toEqual(resolveProfileDrawing(doc.features,'target').contours);
});
it('does not allow a source after its dependent sketch to silently resolve',()=>{
 const doc=moveFeature(attach(),'source',1);expect(featureReferenceErrors(doc).get('target')).toMatch(/Reference unavailable/);
 expect(()=>resolveProfileDrawing(doc.features,'target')).toThrow(/earlier/);
});
it('rejects persistence of transient or mismatched source contacts',()=>{
 const doc=attach();(doc.features[1] as ProfileFeature).profile=resolveProfileDrawing(doc.features,'target');
 expect(()=>serializePartDocument(doc)).toThrow(/context.*saved/);
 const resolved=resolveProfileDrawing(attach().features,'target');resolved.pierceContext!['pierce-1'].source.sourceContourId='different';
 expect(()=>solveDrawingConstraints(resolved)).toThrow(/stale/);
});
it('reports the correct fully constrained target and retains no extra geometry in solves',()=>{
 const result=resolveProfileDrawing(attach().features,'target');expect(result.contours).toHaveLength(1);
 expect(sketchConstraintState(result).state).toBe('fully-constrained');
 expect(solveDrawingConstraints(result)).toEqual(result);
});
it('allows removing a relationship and leaves its current point independent',()=>{
 const doc=attach(),resolved=resolveProfileDrawing(doc.features,'target');resolved.constraints=resolved.constraints?.filter(c=>c.kind!=='pierce');delete resolved.pierceContext;
 (doc.features[1] as ProfileFeature).profile=resolved;const path=drawing(doc,'source').contours[0];if(path.type!=='path')throw Error();path.segments[0].end=[40,5];
 expect(resolveProfileDrawing(doc.features,'target').contours[0]).toMatchObject({center:[expect.closeTo(10,7),expect.closeTo(0,7)]});
 expect(serializePartDocument(doc)).not.toContain('"kind": "pierce"');
});
it('regenerates variables and Pierce in one atomic document update',async()=>{
 const doc=attach();doc.variables=[{name:'radius',kind:'length',expression:'3 mm'}];
 drawing(doc).constraints![0].valueExpression='#radius';
 const next=await updatePartDocumentVariables(doc,[{name:'radius',kind:'length',expression:'5 mm'}]);
 expect(resolveProfileDrawing(next.features,'target').contours[0]).toMatchObject({radius:expect.closeTo(5,7),center:[expect.closeTo(10,7),expect.closeTo(0,7)]});
 expect(serializePartDocument(next)).not.toContain('pierceContext');
});
it('retains a finite sliding target contact in the single saved constraint array',()=>{
 const doc=setup();(doc.features[1] as ProfileFeature).profile={type:'drawing',contours:[{type:'path',start:[0,0],segments:[{type:'conic',end:[8,0],control:[4,8],rho:.5}]}]};
 const saved=addSketchPierce(doc,'target',{contour:0,kind:'curve',index:0,parameter:.5},'source',0,0,0);
 expect(drawing(saved).constraints![0]).toMatchObject({kind:'pierce',a:{kind:'curve',sliding:true}});
 expect(()=>parsePartDocument(serializePartDocument(saved))).not.toThrow();
});
it('refuses a stale context even if the old point still satisfies the shape',()=>{
 const doc=attach(),result=withPierceContext(doc.features,'target',drawing(doc));result.constraints![1].source!.branch.direction=1;
 expect(()=>solveDrawingConstraints(result)).toThrow(/branch|stale/);
});
it('updates expressions in suppressed sketches without losing their external relation',async()=>{
 const doc=setFeatureSuppressed(attach(),'source',true);doc.variables=[{name:'radius',kind:'length',expression:'3 mm'}];
 drawing(doc).constraints![0].valueExpression='#radius';
 const changed=await updatePartDocumentVariables(doc,[{name:'radius',kind:'length',expression:'5 mm'}]);
 expect(changed.features.every(f=>f.suppressed)).toBe(true);
 const restored=setFeatureSuppressed(changed,'target',false);
 expect(resolveProfileDrawing(restored.features,'target').contours[0]).toMatchObject({radius:expect.closeTo(5,7)});
 expect(serializePartDocument(changed)).not.toContain('pierceContext');
});
it('uses current resolved contours for region selection and native building',()=>{
 const doc=attach(),source=drawing(doc,'source').contours[0];if(source.type!=='path')throw Error();source.segments[0].end=[40,5];
 const feature=doc.features[1];expect(()=>sketchRegions(feature)).toThrow(/document/);
 const regions=sketchRegions(feature,false,doc.features);expect(regions).toHaveLength(1);
 const translation=translateDocument(doc);expect(translation.complete).toBe(true);
 const native=translation.features.find(f=>f.parameters.pierce_checks)!;
 expect(native.parameters.center_mm).toEqual([expect.closeTo(20,7),expect.closeTo(0,7)]);
 expect(native.parameters.pierce_checks).toMatchObject([{source_sketch:'target#pierce-source#pierce-1',world_point:[20,0,0]}]);
});
it.each(['reference','valueOffset','valueScale','splineFreeEnds','patternGroup'])('rejects unrelated %s semantics on Pierce',key=>{
 const doc=attach();Object.assign(drawing(doc).constraints![1],{[key]:key==='reference'?true:key==='splineFreeEnds'?['start']:1});
 expect(()=>serializePartDocument(doc)).toThrow(/Pierce constrains/);
});
it('resolves a dependent source sketch before a second Pierce without persisting context',()=>{
 let doc=attach();doc.features.push({id:'third',name:'Third',type:'profile',plane:'XY',offsetMillimeters:0,suppressed:false,profile:{type:'drawing',contours:[{type:'circle',center:[0,0],radius:1}]}});
 doc=addSketchPierce(doc,'third',{contour:0,kind:'point',index:0},'target',0,undefined,0);
 const initial=resolveProfileDrawing(doc.features,'third').contours[0];if(initial.type!=='circle')throw Error();
 expect(initial.center[0]).toBeCloseTo(13,7);
 const source=drawing(doc,'source').contours[0];if(source.type!=='path')throw Error();source.segments[0].end=[40,5];
 const saved=parsePartDocument(serializePartDocument(doc)),resolved=resolveProfileDrawing(saved.features,'third').contours[0];
 expect(resolved).toMatchObject({center:[expect.closeTo(23,7),expect.closeTo(0,7)]});
 expect(translateDocument(saved).complete).toBe(true);
});
