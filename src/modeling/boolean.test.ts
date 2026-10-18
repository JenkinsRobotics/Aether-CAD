import {expect,it} from 'vitest';
import {createEmptyPartDocument,insertFeature,parsePartDocument,serializePartDocument,featureDependencies,removeFeature,setFeatureSuppressed,availableBodies,type BooleanFeature} from '@aether/core/document';
import {translateDocument} from '../freecad-translate';
function part() {
  let doc=createEmptyPartDocument('Boolean');
  for (const [key,x] of [['target',0],['tool',5],['other',30]] as const) {
    doc=insertFeature(doc,{id:`${key}-sketch`,type:'profile',name:key,suppressed:false,plane:'XY',offsetMillimeters:0,profile:{type:'polygon',pointsMillimeters:[[x,0],[x+10,0],[x+10,10],[x,10]]}});
    doc=insertFeature(doc,{id:`${key}-pad`,type:'extrude',name:key,suppressed:false,profileFeatureId:`${key}-sketch`,distanceMillimeters:10,operation:'new',bodyId:key});
  }
  return doc;
}
const boolean:BooleanFeature={id:'boolean',type:'boolean',name:'Combine',suppressed:false,operation:'union',targetBodyId:'target',toolBodyIds:['tool'],keepTools:false};
it('round-trips Boolean intent, tracks both dependencies and consumes only tool outputs',()=>{
  const doc=parsePartDocument(serializePartDocument(insertFeature(part(),boolean)));
  expect(doc.features.at(-1)).toEqual(boolean);
  expect(featureDependencies(doc).get('boolean')).toEqual(expect.arrayContaining(['target-pad','tool-pad']));
  expect(availableBodies(doc).map(b=>b.id)).toEqual(['target','other']);
  expect(translateDocument(doc).untranslated).toEqual([]);
  expect(translateDocument(doc).features.at(-1)).toMatchObject({kind:'boolean',parameters:{body_id:'target',boolean_operation:'union',tool_body_ids:['tool'],keep_tools:false}});
  expect(availableBodies(setFeatureSuppressed(doc,'boolean',true)).map(b=>b.id)).toEqual(['target','tool','other']);
  expect(availableBodies({...doc,rollbackIndex:6}).map(b=>b.id)).toEqual(['target','tool','other']);
  const broken=removeFeature(doc,'tool-pad');
  expect(translateDocument(broken).untranslated).toEqual([expect.objectContaining({id:'boolean',reason:expect.stringMatching(/Missing reference/)})]);
});
it('rejects reuse of consumed tools but permits reuse with Keep tools',()=>{
  for(const keepTools of [false,true]) {
    let doc=insertFeature(part(),{...boolean,keepTools});
    doc=insertFeature(doc,{...boolean,id:'next',operation:'cut'});
    expect(translateDocument(doc).complete).toBe(keepTools);
  }
});
it.each([{operation:'bad'},{targetBodyId:''},{toolBodyIds:[]},{toolBodyIds:['target']},{toolBodyIds:['tool','tool']},{toolBodyIds:[2]},{keepTools:'false'}])('rejects invalid Boolean intent %j',invalid=>{
  expect(()=>insertFeature(part(),{...boolean,...invalid} as BooleanFeature)).toThrow();
});
