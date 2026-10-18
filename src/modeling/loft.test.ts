import {describe,expect,it} from 'vitest';
import {createEmptyPartDocument,insertFeature,parsePartDocument,serializePartDocument,availableBodies,featureDependencies,removeFeature,type LoftFeature} from '@aether/core/document';
import {translateDocument} from '../freecad-translate';

const sections = () => {
  let doc=createEmptyPartDocument('Loft');
  for(const [id,z,radius] of [['base',0,4],['top',10,2]] as const)
    doc=insertFeature(doc,{id,type:'profile',name:id,suppressed:false,plane:'XY',offsetMillimeters:z,profile:{type:'drawing',contours:[{id:`${id}-circle`,type:'circle',center:[0,0],radius}]}});
  return doc;
};
const loft:LoftFeature={id:'loft',type:'loft',name:'Loft',suppressed:false,operation:'new',ruled:false,sections:[{profileFeatureId:'base',profileContourId:'base-circle'},{profileFeatureId:'top',profileContourId:'top-circle'}]};

describe('persistent Loft sections',()=>{
  it('round-trips ordered contour references and produces an independently addressable body',()=>{
    const doc=parsePartDocument(serializePartDocument(insertFeature(sections(),loft)));
    expect(doc.features.at(-1)).toMatchObject(loft);
    expect(availableBodies(doc)).toHaveLength(1);
    expect(featureDependencies(doc).get('loft')).toEqual(['base','top']);
    const result=translateDocument(doc);
    expect(result.untranslated).toEqual([]);
    expect(result.features.at(-1)).toMatchObject({kind:'loft',parameters:{sections:[result.features[0].id,result.features[1].id],operation:'new',ruled:false,body_id:availableBodies(doc)[0].id}});
    const changed=structuredClone(doc);
    (changed.features.at(-1) as LoftFeature).sections.reverse();
    expect(translateDocument(changed).features.at(-1)!.parameters.sections).toEqual([result.features[1].id,result.features[0].id]);
  });
  it('keeps a removed section as a repairable error, never substitutes another profile',()=>{
    const doc=removeFeature(insertFeature(sections(),loft),'top');
    const reopened=parsePartDocument(serializePartDocument(doc));
    expect(availableBodies(reopened)).toEqual([]);
    expect(translateDocument(reopened).untranslated).toEqual([expect.objectContaining({id:'loft',reason:expect.stringMatching(/Missing reference/)} )]);
  });
  it.each([
    {sections:[]},{sections:[loft.sections[0]]},{sections:[loft.sections[0],loft.sections[0]]},
    {ruled:'yes'},{sections:[loft.sections[0],{profileFeatureId:'top',profileContourId:''}]},
  ])('rejects invalid Loft intent %j',invalid=>{
    expect(()=>insertFeature(sections(),{...loft,...invalid} as LoftFeature)).toThrow();
  });
});
