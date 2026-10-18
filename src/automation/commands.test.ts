import { describe, expect, it } from 'vitest';
import { createRectanglePartDocument, serializePartDocument, parsePartDocument } from '@aether/core/document';
import { prepareCommand, finalizeCandidate } from './commands';
const part = () => createRectanglePartDocument('Agent fixture', {widthMillimeters:10,heightMillimeters:20,depthMillimeters:5}, {documentId:'doc',sketchId:'sketch',extrudeId:'pad'});
const saved = () => serializePartDocument(part());
describe('CAD saved command boundary', () => {
  it('inspects identities and previews full history without mutating the source', () => {
    const source=saved();
    expect(prepareCommand('cad.part.inspect',source,{}).result.features.map(f=>f.id)).toEqual(['sketch','pad']);
    const p=prepareCommand('cad.extrude.preview',source,{feature_id:'pad',depth_mm:8});
    expect(p.changed).toBe(false);expect(p.result).toMatchObject({preview:true});
    expect(p.features?.at(-1)?.parameters.distance_mm).toBe(8);
    expect(source).toBe(saved());
  });
  it('changes only intended depth, validates persistence, and avoids no-op revisions',()=>{
    const p=prepareCommand('cad.extrude.setdepth',saved(),{feature_id:'pad',depth_mm:8});
    expect(p.changed).toBe(true);
    expect(parsePartDocument(finalizeCandidate(p.candidate!,{})).features.at(-1)).toMatchObject({id:'pad',distanceMillimeters:8});
    expect(prepareCommand('cad.extrude.setdepth',saved(),{feature_id:'pad',depth_mm:5}).changed).toBe(false);
  });
  it('uses dependency-aware suppression and restores required ancestors',()=>{
    const p=prepareCommand('cad.feature.suppress',saved(),{feature_id:'sketch',action:'suppress'});
    expect(p.result.features.every(f=>f.suppressed)).toBe(true);
    const restored=prepareCommand('cad.feature.suppress',p.candidate!,{feature_id:'pad',action:'unsuppress'});
    expect(restored.result.features.every(f=>!f.suppressed)).toBe(true);
  });
  it('refuses dependency-invalid reorder and rolled-back edits',()=>{
    expect(()=>prepareCommand('cad.feature.move',saved(),{feature_id:'pad',direction:-1})).toThrow();
    const doc=part();doc.rollbackIndex=1;
    expect(()=>prepareCommand('cad.extrude.setdepth',serializePartDocument(doc),{feature_id:'pad',depth_mm:8})).toThrow(/rollback/);
  });
  it.each([0,-1,NaN,Infinity,1000001])('refuses invalid depth %s',depth_mm=>{
    expect(()=>prepareCommand('cad.extrude.setdepth',saved(),{feature_id:'pad',depth_mm})).toThrow(/Depth/);
  });
  it('refuses the wrong feature, missing feature, unsupported commands and body identities',()=>{
    expect(()=>prepareCommand('cad.extrude.setdepth',saved(),{feature_id:'sketch',depth_mm:8})).toThrow(/Extrude/);
    expect(()=>prepareCommand('cad.feature.move',saved(),{feature_id:'missing',direction:1})).toThrow(/not found/);
    expect(()=>prepareCommand('cad.shell',saved(),{})).toThrow(/Unknown/);
    expect(()=>finalizeCandidate(saved(),{fake:['body']})).toThrow(/unknown/);
  });
});

it('maps a signed end offset without overwriting the independent starting offset',()=>{
  const doc=part();Object.assign(doc.features.at(-1)!,{endType:'up-to-next',startingOffsetMillimeters:1});
  const prepared=prepareCommand('cad.extrude.setoffset',serializePartDocument(doc),{feature_id:'pad',end_offset_mm:-2});
  expect(parsePartDocument(prepared.candidate!).features.at(-1)).toMatchObject({endOffsetMillimeters:-2,startingOffsetMillimeters:1});
  expect(prepared.features?.at(-1)?.parameters).toMatchObject({end_offset_mm:-2,starting_offset_mm:1});
});

it('requires and persists resolved frames for sketches attached to edited faces', () => {
  const doc=part();
  const frame={originMillimeters:[5,10,5],normal:[0,0,1],xDirection:[1,0,0]} as const;
  const source=JSON.parse(serializePartDocument(doc));
  source.features.push({id:'attached',name:'Attached',type:'profile',plane:'XY',offsetMillimeters:0,suppressed:false,
    profile:{type:'circle',radiusMillimeters:1,centerMillimeters:[0,0]},frame,
    support:{sourceFeatureId:'pad',bodyId:'pad',normal:[0,0,1],xDirection:[1,0,0],label:'Face of Extrude'}});
  const prepared=prepareCommand('cad.extrude.setdepth',JSON.stringify(source),{feature_id:'pad',depth_mm:8});
  expect(()=>finalizeCandidate(prepared.candidate!,{})).toThrow(/not resolved/);
  const next=finalizeCandidate(prepared.candidate!,{}, {attached:{originMillimeters:[5,10,8],normal:[0,0,1],xDirection:[1,0,0]}});
  expect(parsePartDocument(next).features.at(-1)).toMatchObject({frame:{originMillimeters:[5,10,8]}});
});

it('does not create a revision for an implicit zero offset and clears a changed offset', () => {
  const doc=part();Object.assign(doc.features.at(-1)!,{endType:'up-to-next'});
  expect(prepareCommand('cad.extrude.setoffset',serializePartDocument(doc),{feature_id:'pad',end_offset_mm:0}).changed).toBe(false);
  Object.assign(doc.features.at(-1)!,{endOffsetMillimeters:2});
  const cleared=prepareCommand('cad.extrude.setoffset',serializePartDocument(doc),{feature_id:'pad',end_offset_mm:0});
  expect(cleared.changed).toBe(true);
  expect(parsePartDocument(cleared.candidate!).features.at(-1)).not.toHaveProperty('endOffsetMillimeters');
});

it('previews and changes revolve extents with explicit units and no-op detection', () => {
  const doc=part();doc.features[1]={id:'rev',type:'revolve',name:'Revolve',profileFeatureId:'sketch',axis:'X',angleDegrees:90,operation:'new',suppressed:false};
  const source=serializePartDocument(doc);
  const args={feature_id:'rev',angle_deg:90,second_angle_deg:30,symmetric:false,reversed:true};
  const p=prepareCommand('cad.revolve.preview',source,args);
  expect(p.changed).toBe(false);expect(p.result).toMatchObject({preview:true});
  expect(p.features?.at(-1)?.parameters).toMatchObject({angle_deg:90,second_angle_deg:30,reversed:true,symmetric:false});
  const saved=prepareCommand('cad.revolve.setextent',source,args);
  expect(saved.changed).toBe(true);
  expect(prepareCommand('cad.revolve.setextent',saved.candidate!,args).changed).toBe(false);
  expect(()=>prepareCommand('cad.revolve.setextent',source,{...args,symmetric:true})).toThrow(/symmetric/);
  expect(()=>prepareCommand('cad.revolve.setextent',source,{...args,second_angle_deg:NaN})).toThrow();
  expect(()=>prepareCommand('cad.revolve.setextent',source,{...args,angle_deg:350})).toThrow(/360/);
});
