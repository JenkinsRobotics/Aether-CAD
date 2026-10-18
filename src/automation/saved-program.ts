/** Saved-file adapter for the same bounded program used by the open editor.
 * The caller qualifies each candidate natively and returns canonical identities.
 * Nothing here saves a file or grants access to a document. */
import { parsePartDocument, serializePartDocument, rollbackPosition } from '@aether/core/document';
import { parseProgram, prepareProgramStep, programStepReference, programToolNames, plateProgram, type ProgramStep, type Reference } from '../ai/program';
import { cadAgentTools, inspectPart } from './live-commands';
import { translateDocument } from '../freecad-translate';
import { finalizeCandidate } from './commands';

export function beginSavedProgram(content:string,encoded:unknown) {
  const doc=parsePartDocument(content);
  if(doc.features.length>512)throw Error('CAD automation supports at most 512 features.');
  if(rollbackPosition(doc)!==doc.features.length)throw Error('Move the rollback bar to the end before editing this saved part.');
  return {steps:parseProgram(encoded)};
}

export function prepareSavedProgramStep(content:string,step:ProgramStep,references:Record<string,Reference>) {
  const prepared=prepareProgramStep(parsePartDocument(content),step,references);
  const translation=translateDocument(prepared.document);
  if(!translation.complete)throw Error('The native engine cannot evaluate the complete program candidate.');
  return {
    candidate:serializePartDocument(prepared.document),features:translation.features,
    pending:{featureID:prepared.featureID,beforeBodyIDs:prepared.beforeBodyIDs,targetBodyID:prepared.targetBodyID},
  };
}

export function acceptSavedProgramStep(request:{content:string;pending:Parameters<typeof programStepReference>[0];body_outputs:Parameters<typeof finalizeCandidate>[1];sketch_frames?:Parameters<typeof finalizeCandidate>[2];scope_resolutions?:Parameters<typeof finalizeCandidate>[3]}) {
  const content=finalizeCandidate(request.content,request.body_outputs,request.sketch_frames,request.scope_resolutions);
  const doc=parsePartDocument(content);
  return {content,reference:programStepReference(request.pending,doc),result:inspectPart(doc)};
}

export function savedProgramDocs(args:Record<string,unknown>) {
  const query=args.query??'',offset=args.offset??0;
  if(typeof query!=='string'||query.length>200||typeof offset!=='number'||!Number.isInteger(offset)||offset<0||offset>1000)throw Error('Use query <= 200 characters and offset 0–1000.');
  const words=query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const tools=cadAgentTools.filter(tool=>programToolNames.includes(tool.name))
    .filter(tool=>!words.length||words.some(word=>`${tool.name} ${tool.description}`.toLowerCase().includes(word)));
  return {runtime:'saved-file-native',module:'AetherCAD.AI',total:tools.length,tools:tools.slice(offset,offset+5),next_offset:offset+5<tools.length?offset+5:null,
    execute_with:'cad.part.runprogram',verify_with:'cad.part.verify',example:{program_json:JSON.stringify(plateProgram),expected_volume_mm3:40000},
    limits:['Tools are program steps, not separate transport endpoints.','1–16 steps, 64 KiB program, 512 features, 4 MiB document.','One returned candidate; Studio owns revision checking and saving. Open editors must reload.','Native execution only; this does not provide browser-WASM parity or pixel previews.']};
}
