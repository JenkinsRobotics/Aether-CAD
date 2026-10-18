import {expect,it,vi,afterEach} from 'vitest';
import {createEmptyPartDocument,parsePartDocument,serializePartDocument,featureDependencies,setFeatureSuppressed,removeFeature,featureReferenceErrors,type PartDocument} from '@aether/core/document';
import {translateDocument} from '../freecad-translate';
import {buildWithFreeCAD} from '../freecad-geometry';
import {analyzePart} from './part-analysis';
import {createPartExport} from './part-export';

function part():PartDocument {
 const doc=createEmptyPartDocument('Selected stopping part');doc.features.push(
 {id:'limit-s',type:'profile',name:'Limit sketch',plane:'XY',offsetMillimeters:20,suppressed:false,profile:{type:'circle',radiusMillimeters:20,centerMillimeters:[0,0]}},
 {id:'limit',type:'extrude',name:'Limit',profileFeatureId:'limit-s',distanceMillimeters:3,bodyId:'stop',operation:'new',suppressed:false},
 {id:'s',type:'profile',name:'Profile',plane:'XY',offsetMillimeters:0,suppressed:false,profile:{type:'circle',radiusMillimeters:2,centerMillimeters:[0,0]}},
 {id:'e',type:'extrude',name:'To part',profileFeatureId:'s',distanceMillimeters:1,endType:'up-to-part',endPartId:'stop',endOffsetMillimeters:2,bodyId:'result',operation:'new',suppressed:false});return doc;
}
it('retains selected part IDs and signed offsets on both ends through file/translation',()=>{
 const doc=part();Object.assign(doc.features.at(-1)!,{secondEnd:{endType:'up-to-part',endPartId:'stop',distanceMillimeters:1,endOffsetMillimeters:-2,draftAngleDegrees:3}});
 const after=parsePartDocument(serializePartDocument(doc));expect(after).toEqual(doc);
 const wire=translateDocument(after);expect(wire.untranslated).toEqual([]);expect(wire.features.at(-1)?.parameters).toMatchObject({region_mode:true,end_type:'up-to-part',end_part_id:'stop',end_offset_mm:2,second_end:{end_type:'up-to-part',end_part_id:'stop',end_offset_mm:-2,draft_angle_deg:3}});
});
it('depends on the latest evaluated stopping-part modifier and handles suppression/deletion',()=>{
 const doc=part();doc.features.splice(2,0,{id:'modifier',type:'extrude',name:'Change stop',profileFeatureId:'limit-s',distanceMillimeters:3,targetBodyId:'stop',operation:'add',suppressed:false});
 expect(featureDependencies(doc).get('e')).toContain('modifier');
 expect(setFeatureSuppressed(doc,'limit',true).features.find(f=>f.id==='e')?.suppressed).toBe(true);
 const missing=structuredClone(doc);missing.features=missing.features.filter(f=>f.id!=='modifier'&&f.id!=='limit');
 expect(()=>serializePartDocument(missing)).not.toThrow();expect(featureReferenceErrors(missing).has('e')).toBe(true);
 expect(featureReferenceErrors(removeFeature(doc,'limit')).has('e')).toBe(true);
});
it.each([undefined,'',true,{},'x'.repeat(257)])('rejects malformed stopping-part identity %s',endPartId=>{
 const doc=part();Object.assign(doc.features.at(-1)!,{endPartId});expect(()=>serializePartDocument(doc)).toThrow(/stopping part identity/);
});
it('rejects a dormant part reference under another mode',()=>{const doc=part();Object.assign(doc.features.at(-1)!,{endType:'blind'});expect(()=>serializePartDocument(doc)).toThrow(/stopping part requires/);});
afterEach(()=>vi.unstubAllGlobals());
it.each(['build','analysis','export'])('refuses %s on a worker without selected-part stopping',async mode=>{
 const doc=part();const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({ok:true,capabilities:[]})});vi.stubGlobal('fetch',fetch);
 const call=mode==='build'?buildWithFreeCAD(translateDocument(doc).features):mode==='analysis'?analyzePart(doc,{kind:'properties'}):createPartExport(doc,'step');
 await expect(call).rejects.toThrow(/does not support Up to part/);expect(fetch).toHaveBeenCalledTimes(1);
});
