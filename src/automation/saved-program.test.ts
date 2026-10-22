import { expect, it } from 'vitest';
import { createEmptyPartDocument, serializePartDocument, parsePartDocument, bodyIDForFeature } from '@aether/core/document';
import { executeProgram, plateProgram, programToolNames } from '../ai/program';
import { beginSavedProgram, prepareSavedProgramStep, acceptSavedProgramStep, savedProgramDocs } from './saved-program';
import { cadAgentTools } from './live-commands';

it('uses the same program steps and schemas as the editor, exposing only executable steps',()=>{
  const all=[];for(let offset:number|null=0;offset!==null;){const page=savedProgramDocs({offset});all.push(...page.tools);offset=page.next_offset;}
  // Every editing step, including the canonical feature operations, runs on saved files through the same program path.
  expect(all.map(t=>t.name).sort()).toEqual([...programToolNames].sort());
  for(const t of all)expect(t).toEqual(cadAgentTools.find(x=>x.name===t.name));
  expect(savedProgramDocs({query:'undo'}).tools.map(t=>t.name)).not.toContain('aether_cad_undo');
  expect(savedProgramDocs({query:'cone'}).tools.map(t=>t.name)).toContain('aether_cad_solid_primitive');
});

it('preserves source and passes qualified identities from saved steps to the next step',()=>{
  const source=serializePartDocument(createEmptyPartDocument('Plate'));
  const {steps}=beginSavedProgram(source,JSON.stringify(plateProgram));
  const outline=prepareSavedProgramStep(source,steps[0],{});
  const accepted=acceptSavedProgramStep({content:outline.candidate,pending:outline.pending,body_outputs:{}});
  const pad=prepareSavedProgramStep(accepted.content,steps[1],{outline:accepted.reference});
  expect(parsePartDocument(pad.candidate).features.at(-1)).toMatchObject({profileFeatureId:accepted.reference.feature_id});
  const doc=parsePartDocument(pad.candidate);
  const bodyID=`${bodyIDForFeature(doc,doc.features.at(-1)!)}:solid-1`;
  const resolved=acceptSavedProgramStep({content:pad.candidate,pending:pad.pending,body_outputs:{[pad.pending.featureID]:[bodyID]}});
  expect(resolved.reference.body_id).toBe(bodyID);
  expect(parsePartDocument(source).features).toHaveLength(0);
  expect(parsePartDocument(resolved.content).features).toHaveLength(2);
});

it('preflights invalid programs before invoking native evaluation',async()=>{
  let builds=0;
  await expect(executeProgram(createEmptyPartDocument('Part'),JSON.stringify({version:1,steps:[plateProgram.steps[0],plateProgram.steps[0]]}),async doc=>{builds++;return doc;})).rejects.toThrow(/unique/);
  expect(builds).toBe(0);
});

it('refuses inherited references and rolled-back saved edits',()=>{
  const source=serializePartDocument(createEmptyPartDocument('Part'));
  expect(()=>prepareSavedProgramStep(source,plateProgram.steps[1],Object.create({outline:{feature_id:'x'}}))).toThrow(/earlier step/);
  const doc=JSON.parse(source);doc.features=[{id:'p',type:'profile',name:'Circle',plane:'XY',offsetMillimeters:0,suppressed:false,profile:{type:'circle',centerMillimeters:[0,0],radiusMillimeters:5}}];doc.rollbackIndex=0;
  expect(()=>beginSavedProgram(JSON.stringify(doc),JSON.stringify(plateProgram))).toThrow(/rollback/);
});

it.each([{offset:-1},{offset:1.5},{query:'a'.repeat(201)}])('bounds saved discovery %j',args=>{
  expect(()=>savedProgramDocs(args)).toThrow();
});
