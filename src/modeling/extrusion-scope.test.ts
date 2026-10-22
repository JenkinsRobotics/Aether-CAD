import {expect,it} from 'vitest';
import {createEmptyPartDocument,insertFeature,type ExtrudeFeature} from '@aether/core/document';

function fixture(){
 let doc=createEmptyPartDocument('Scope');
 doc=insertFeature(doc,{id:'s',type:'profile',name:'Profile',plane:'XY',offsetMillimeters:0,suppressed:false,profile:{type:'circle',radiusMillimeters:2,centerMillimeters:[0,0]}});
 for(const id of ['a','b','other'])doc=insertFeature(doc,{id,type:'extrude',name:id,profileFeatureId:'s',operation:'new',bodyId:id,distanceMillimeters:10,suppressed:false});
 const cut:ExtrudeFeature={id:'cut',type:'extrude',name:'Cut both',profileFeatureId:'s',operation:'cut',targetBodyId:'a',targetBodyIds:['a','b'],distanceMillimeters:2,suppressed:false};
 return {doc,cut};
}
it('refuses malformed scope instead of silently falling back to a single target',()=>{
 const {doc,cut}=fixture();
 for(const scope of [[],['a','a'],['b','a'],['a',null]])expect(()=>insertFeature(doc,{...cut,targetBodyIds:scope} as ExtrudeFeature)).toThrow(/scope/);
 expect(()=>insertFeature(doc,{...cut,operation:'new'})).toThrow(/scope/);
});
