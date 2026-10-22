import {expect,it} from 'vitest';
import {createEmptyPartDocument} from '@aether/core/document';
import {createCenterRectangleSketch} from '@aether/core/sketch';
import {inspectSketch,editSketch} from './sketch-edit';
import {preparePartEdit} from './live-commands';
const drawing=()=>({type:'drawing' as const,contours:[{id:'outline',type:'path' as const,start:[10,20] as [number,number],segments:[{id:'a',type:'line' as const,end:[50,20] as [number,number]},{id:'b',type:'line' as const,end:[50,40] as [number,number]},{id:'c',type:'line' as const,end:[10,40] as [number,number]},{id:'d',type:'line' as const,end:[10,20] as [number,number]}]}],constraints:[{id:'horizontal',kind:'horizontal' as const,a:{contour:0,kind:'line' as const,index:0}}]});
function part(){const doc=createEmptyPartDocument('Existing sketch');doc.features.push({id:'sketch',type:'profile',name:'Sketch 1',plane:'XY',offsetMillimeters:0,suppressed:false,profile:drawing()});return preparePartEdit(doc,'aether_cad_extrude',{profile_id:'sketch',depth_mm:5,operation:'new'}).document;}
it('preserves legacy rectangle dimensions and rejects moving its origin anchor',()=>{
 const doc=createEmptyPartDocument('Rectangle');const f=createCenterRectangleSketch('s','XY',40,20);doc.features.push(f);
 expect(()=>editSketch(doc,'aether_cad_sketch_translate',{feature_id:'s',dx_mm:10,dy_mm:0})).toThrow(/origin/);
 const resized=editSketch(doc,'aether_cad_sketch_dimension',{feature_id:'s',dimension_id:f.dimensions[0].id,value:60}).document;
 expect(resized.features[0]).toMatchObject({profile:{widthMillimeters:60,centerXMillimeters:0}});expect(doc.features[0]).toMatchObject({profile:{widthMillimeters:40}});
});
it('rejects a fixed drawing anchor rather than silently dropping its constraint',()=>{
 const doc=part(),f=doc.features[0];if(f.type!=='profile'||f.profile.type!=='drawing')throw Error();
 f.profile.constraints=[{id:'anchor',kind:'fix',a:{contour:0,kind:'point',index:0},point:[10,20]}];
 expect(()=>editSketch(doc,'aether_cad_sketch_translate',{feature_id:'sketch',dx_mm:-30,dy_mm:-30})).toThrow(/constraint/);
 expect(f.profile.contours[0]).toMatchObject({start:[10,20]});
});
it('inspects pages without losing original contour indices and bounds arguments',()=>{
 const doc=part();expect(inspectSketch(doc,{feature_id:'sketch',offset:0,limit:1})).toMatchObject({profile:{contours:[{index:0,id:'outline'}]},dependents:[{type:'extrude'}]});
 for(const args of [{feature_id:'unknown'},{feature_id:'sketch',offset:-1},{feature_id:'sketch',limit:26}])expect(()=>inspectSketch(doc,args)).toThrow();
 expect(()=>preparePartEdit(doc,'aether_cad_sketch_translate',{feature_id:'sketch',dx_mm:Infinity,dy_mm:0})).toThrow();
});
it('edits a drawing dimension through the solver without removing other constraints',()=>{
 const doc=createEmptyPartDocument('Dimension');doc.features.push({id:'s',name:'Sketch',type:'profile',plane:'XY',offsetMillimeters:0,suppressed:false,profile:{type:'drawing',contours:[{id:'circle',type:'circle',center:[20,25],radius:5}],constraints:[{id:'radius',kind:'radius',a:{contour:0,kind:'circle'},value:5},{id:'center',kind:'fix',a:{contour:0,kind:'point',index:0},point:[20,25]}]}});
 const result=editSketch(doc,'aether_cad_sketch_dimension',{feature_id:'s',dimension_id:'radius',value:8}).document;
 const feature=result.features[0];if(feature.type!=='profile'||feature.profile.type!=='drawing'||feature.profile.contours[0].type!=='circle')throw Error();
 expect(feature.profile.contours[0].radius).toBeCloseTo(8,6);expect(feature.profile.contours[0].center).toEqual([20,25]);expect(feature.profile.constraints!.map(c=>c.id)).toEqual(['radius','center']);
 const source=doc.features[0];if(source.type!=='profile'||source.profile.type!=='drawing')throw Error();
 source.profile.constraints![0].valueExpression='5';expect(()=>editSketch(doc,'aether_cad_sketch_dimension',{feature_id:'s',dimension_id:'radius',value:8})).toThrow(/formula/);
});
