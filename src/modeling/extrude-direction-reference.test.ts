import {expect,it} from 'vitest';
import {createEmptyPartDocument,parsePartDocument,serializePartDocument,featureDependencies,moveFeature,setFeatureSuppressed,type PartDocument} from '@aether/core/document';
import {sketchDirectionLines,resolveSketchDirection,directionLineVector} from './extrude-direction-reference';
import {translateDocument} from '../freecad-translate';

function model():PartDocument {return {...createEmptyPartDocument('Line'),features:[
 {id:'guide',name:'Guide',type:'profile',plane:'XZ',offsetMillimeters:0,suppressed:false,profile:{type:'drawing',contours:[{id:'path',type:'path',construction:true,start:[0,0],segments:[{id:'line',type:'line',end:[3,4]}]}]}},
 {id:'s',name:'Circle',type:'profile',plane:'XY',offsetMillimeters:0,suppressed:false,profile:{type:'circle',radiusMillimeters:10,centerMillimeters:[0,0]}},
 {id:'e',name:'Extrude',type:'extrude',profileFeatureId:'s',distanceMillimeters:10,operation:'new',bodyId:'solid',suppressed:false,directionReference:{kind:'sketch-line',sourceFeatureId:'guide',contourId:'path',segmentId:'line'}},
]};}
const ref={kind:'sketch-line' as const,sourceFeatureId:'guide',contourId:'path',segmentId:'line'};
it('resolves a construction line with stable IDs and translates the current local direction',()=>{
 const doc=model(),before=JSON.stringify(doc),line=resolveSketchDirection(doc,ref,'e');
 expect(directionLineVector(line)).toEqual([.6,0,.8]);
 const translation=translateDocument(parsePartDocument(serializePartDocument(doc)));
 expect(translation.untranslated).toEqual([]);
 expect(translation.features.at(-1)?.parameters).toMatchObject({region_mode:true,direction_reference:{kind:'sketch-line',local_vector:[3,4],frame:{normal:[0,-1,0]}}});
 expect(translation.features.at(-1)?.parameters).not.toHaveProperty('direction_vector');expect(JSON.stringify(doc)).toBe(before);
});
it('follows upstream line edits and reordering without choosing a different entity',()=>{
 const doc=model(),guide=doc.features[0] as any,path=guide.profile.contours[0];
 path.segments[0].end=[4,3];
 guide.profile.contours.unshift({id:'other',type:'path',start:[20,20],segments:[{id:'other-line',type:'line',end:[21,20]}],construction:true});
 expect(directionLineVector(resolveSketchDirection(doc,ref,'e'))).toEqual([.8,0,.6]);
 expect(translateDocument(doc).features.at(-1)?.parameters.direction_reference).toMatchObject({local_vector:[4,3]});
});
it.each(['missing','curve','suppressed','later'])('refuses a %s direction without falling back to the sketch normal',kind=>{
 const doc=model(),guide=doc.features[0] as any;
 if(kind==='missing')guide.profile.contours[0].segments[0].id='replacement';
 if(kind==='curve')guide.profile.contours[0].segments[0]={id:'line',type:'arc',middle:[1,3],end:[3,4]};
 if(kind==='suppressed')guide.suppressed=true;
 if(kind==='later')doc.features.push(doc.features.shift()!);
 expect(()=>resolveSketchDirection(doc,ref,'e')).toThrow(/unavailable/);
 const translation=translateDocument(doc);expect(translation.features.find(f=>f.id==='e')).toBeUndefined();expect(translation.untranslated.some(f=>f.id==='e')).toBe(true);
});
it('tracks dependencies through suppression and prevents moving before the direction sketch',()=>{
 const doc=model();expect(featureDependencies(doc).get('e')).toContain('guide');
 expect(()=>moveFeature(doc,'guide',1)).not.toThrow();
 const swapped=moveFeature(doc,'guide',1);expect(()=>moveFeature(swapped,'guide',1)).toThrow();
 expect(setFeatureSuppressed(doc,'guide',true).features.at(-1)?.suppressed).toBe(true);
});
it('uses the authored frame for the preview handle',()=>{
 const doc=model(),guide=doc.features[0] as any;
 guide.frame={originMillimeters:[50,60,70],normal:[1,0,0],xDirection:[0,1,0]};
 expect(directionLineVector(resolveSketchDirection(doc,ref,'e'))).toEqual([0,.6,.8]);
 expect(sketchDirectionLines(doc,'e').map(l=>l.label)).toContain('Guide · Construction line 1.1');
});
it('keeps a missing direction source loadable for repair, but validates wrong and future references',()=>{
 const doc=model();doc.features.shift();expect(parsePartDocument(serializePartDocument(doc))).toEqual(doc);
 for(const extra of [{kind:'edge'}, {sourceFeatureId:'e'}, {contourId:''}, {segmentId:3}]){
  const d=model();Object.assign((d.features.at(-1) as any).directionReference,extra);expect(()=>serializePartDocument(d)).toThrow();
 }
 const d=model();Object.assign(d.features.at(-1)!,{directionVector:[0,0,1]});expect(()=>serializePartDocument(d)).toThrow(/manual vector/);
});

it('uses solved constraints rather than stale authored endpoint coordinates',()=>{
 const doc=model(),guide=doc.features[0] as any;
 guide.profile.constraints=[{id:'vertical',kind:'vertical',a:{kind:'line',contour:0,index:0}}];
 const vector=directionLineVector(resolveSketchDirection(doc,ref,'e'));
 expect(vector[0]).toBeCloseTo(0,6);expect(vector[1]).toBeCloseTo(0,6);expect(vector[2]).toBeCloseTo(1,6);
});
