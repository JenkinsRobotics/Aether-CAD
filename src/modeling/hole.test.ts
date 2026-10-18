import {describe, expect, it} from 'vitest';
import {createEmptyPartDocument, insertFeature, parsePartDocument, serializePartDocument, featureDependencies, setFeatureSuppressed, type HoleFeature} from '@aether/core/document';
import {translateDocument} from '../freecad-translate';

function plate() {
  let doc = createEmptyPartDocument('Drilled plate');
  doc = insertFeature(doc, {id:'outline',type:'profile',name:'Outline',suppressed:false,plane:'XY',offsetMillimeters:0,profile:{type:'polygon',pointsMillimeters:[[0,0],[20,0],[20,20],[0,20]]}});
  doc = insertFeature(doc, {id:'pad',type:'extrude',name:'Plate',suppressed:false,profileFeatureId:'outline',distanceMillimeters:10,operation:'new',bodyId:'plate'});
  return insertFeature(doc, {id:'center',type:'profile',name:'Center',suppressed:false,plane:'XY',offsetMillimeters:10,profile:{type:'drawing',contours:[{id:'center-circle',type:'circle',center:[10,10],radius:1}]}});
}
const hole: HoleFeature = {id:'hole',type:'hole',name:'Hole',suppressed:false,profileFeatureId:'center',profileContourId:'center-circle',targetBodyId:'plate',diameterMillimeters:6,depthMillimeters:5,depthType:'blind',cutType:'counterbore',counterDiameterMillimeters:10,counterDepthMillimeters:2};

describe('persistent native Hole', () => {
  it('round-trips the target and contour identity, translates parameters, and records dependencies', () => {
    const doc = parsePartDocument(serializePartDocument(insertFeature(plate(),hole)));
    expect(doc.features.at(-1)).toEqual(hole);
    const translated = translateDocument(doc);
    expect(translated.untranslated).toEqual([]);
    expect(translated.features.at(-1)).toMatchObject({id:'hole',kind:'hole',parameters:{body_id:'plate',operation:'cut',diameter_mm:6,depth_mm:5,depth_type:'blind',cut_type:'counterbore',counter_diameter_mm:10,counter_depth_mm:2}});
    expect(featureDependencies(doc).get('hole')).toEqual(expect.arrayContaining(['center','pad']));
    expect(translateDocument({...doc,rollbackIndex:3}).features.some(f=>f.kind==='hole')).toBe(false);
    expect(translateDocument(setFeatureSuppressed(doc,'hole',true)).features.some(f=>f.kind==='hole')).toBe(false);
  });
  it.each([
    {diameterMillimeters:0}, {depthMillimeters:NaN}, {counterDiameterMillimeters:5},
    {counterDepthMillimeters:5}, {cutType:'countersink',countersinkAngleDegrees:180},
    {profileContourId:''}, {profileFeatureId:'pad'},
  ])('rejects invalid saved hole parameters %j', invalid => {
    expect(()=>insertFeature(plate(),{...hole,...invalid} as HoleFeature)).toThrow();
  });
  it('reports a removed or non-circular center instead of drilling at an invented location', () => {
    const doc = insertFeature(plate(),hole);
    (doc.features[2] as any).profile.contours[0] = {id:'center-circle',type:'polyline',closed:true,points:[[0,0],[1,0],[0,1]]};
    const result = translateDocument(doc);
    expect(result.complete).toBe(false);
    expect(result.untranslated).toEqual(expect.arrayContaining([expect.objectContaining({id:'hole'})]));
  });
});
