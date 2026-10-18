import {expect,it,vi,afterEach} from 'vitest';
import {createEmptyPartDocument,parsePartDocument,serializePartDocument,type PartDocument} from '@aether/core/document';
import {translateDocument,sketchRegions} from '../freecad-translate';
import {buildWithFreeCAD} from '../freecad-geometry';
import {createPartExport} from './part-export';
import {analyzePart} from './part-analysis';

export function thinPart():PartDocument {
 const doc=createEmptyPartDocument('Thin wall');doc.features.push(
  {id:'s',type:'profile',name:'Open sketch',plane:'XY',offsetMillimeters:0,suppressed:false,profile:{type:'drawing',contours:[{id:'path',type:'path',start:[0,0],segments:[{id:'line',type:'line',end:[20,0]}]},{id:'ignore',type:'path',construction:true,start:[0,5],segments:[{type:'line',end:[20,5]}]}]}},
  {id:'e',type:'extrude',name:'Wall',profileFeatureId:'s',profileContourId:'path',distanceMillimeters:10,operation:'new',bodyId:'wall',thin:{thickness1Millimeters:2,thickness2Millimeters:1},suppressed:false});return doc;
}
it('translates open curves only in Thin mode, retaining stable selection IDs through reorder/save',()=>{
 const doc=thinPart();expect(sketchRegions(doc.features[0])).toHaveLength(0);expect(sketchRegions(doc.features[0],true)).toHaveLength(1);
 const original=serializePartDocument(doc);const translated=translateDocument(parsePartDocument(original));expect(translated.untranslated).toEqual([]);
 expect(translated.features.at(-1)?.parameters).toMatchObject({region_mode:true,profiles:['s#0'],thin:{thickness_1_mm:2,thickness_2_mm:1}});
 const sketch=doc.features[0] as any;sketch.profile.contours.reverse();expect(translateDocument(doc).features.at(-1)?.parameters.profiles).toEqual(['s#1']);
 delete (doc.features[1] as any).thin;expect(translateDocument(doc).untranslated.at(-1)?.reason).toMatch(/not translated/);
});
it('retains independent and centered thicknesses and multiple sketch groups in current format',()=>{
 const doc=thinPart();doc.features.splice(1,0,{...structuredClone(doc.features[0]),id:'other'});
 Object.assign(doc.features.at(-1)!,{profileSelections:[{profileFeatureId:'s',profileContourId:'path'},{profileFeatureId:'other',profileContourId:'path'}],thin:{thickness1Millimeters:2,thickness2Millimeters:1,midplane:true,midplaneThicknessMillimeters:4,flipped:true}});
 const saved=parsePartDocument(serializePartDocument(doc));expect(saved.formatVersion).toBe(doc.formatVersion);expect(saved).toEqual(doc);
 const result=translateDocument(saved);expect(result.untranslated).toEqual([]);expect(result.features.at(-1)?.parameters.profile_groups).toHaveLength(2);
});
it.each([null,{}, {thickness1Millimeters:0,thickness2Millimeters:0},{thickness1Millimeters:-1,thickness2Millimeters:2},{thickness1Millimeters:true,thickness2Millimeters:2},{thickness1Millimeters:1,thickness2Millimeters:2,midplane:true},{thickness1Millimeters:1,thickness2Millimeters:2,flipped:'yes'}])('refuses invalid thin state %#',thin=>{
 const doc=thinPart();Object.assign(doc.features.at(-1)!,{thin});expect(()=>serializePartDocument(doc)).toThrow(/Thin extrusion/);
});
afterEach(()=>vi.unstubAllGlobals());
it.each(['build','analysis','export'])('refuses %s on workers without thin geometry',async mode=>{
 const doc=thinPart();const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({ok:true,capabilities:[]})});vi.stubGlobal('fetch',fetch);
 const call=mode==='build'?buildWithFreeCAD(translateDocument(doc).features):mode==='analysis'?analyzePart(doc,{kind:'properties'}):createPartExport(doc,'step');
 await expect(call).rejects.toThrow(/does not support thin extrusion/);expect(fetch).toHaveBeenCalledTimes(1);expect(fetch.mock.calls[0][0]).toBe('/api/cad/engine');
});
