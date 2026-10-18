import {resolveExtrusionScopes} from '../modeling/extrusion-scope-resolution';
import { serializePartDocument, type PartDocument } from '@aether/core/document';
import type { AgentInteraction, AgentToolCall } from '@aether/ui/AgentServices';
import type { ImportedModelData } from '../domain';
import { resolveBodyOutputs } from '../modeling/body-outputs';
import { resolveSketchFrames } from '../modeling/sketch-support';
import { cadAgentTools, inspectPart, preparePartEdit, validateLiveArguments } from './live-commands';
import { inspectFeatureReferences } from './feature-inspection';
import { discoverCAD } from '../ai/knowledge';
import { executeProgram } from '../ai/program';

export interface CADAgentWorkspace {
  current:()=>PartDocument|null;
  contextKey:()=>string;
  available:()=>boolean;
  writable:()=>boolean;
  evaluate:(doc:PartDocument)=>Promise<ImportedModelData>;
  commit:(doc:PartDocument,model:ImportedModelData)=>void;
  verify?:(doc:PartDocument,args:Record<string,unknown>,signal:AbortSignal)=>Promise<unknown>;
  preview?:(doc:PartDocument,signal:AbortSignal)=>Promise<unknown>|unknown;
  history:{candidate:(direction:-1|1)=>PartDocument|null;commit:(direction:-1|1,expected:PartDocument,apply:()=>void)=>void};
}
/** One atomic edit: inspect current -> validate -> exact rebuild -> compare -> commit. */
export class CADAgentEditor {
  private busy=false;
  constructor(private workspace:CADAgentWorkspace){}
  async execute(contextKey:string,call:AgentToolCall,signal:AbortSignal) {
    const w=this.workspace; signal.throwIfAborted();
    if(contextKey!==w.contextKey())throw Error('The active Part changed.');
    validateLiveArguments(call.name,call.arguments);
    if(call.name==='aether_cad_docs')return discoverCAD(cadAgentTools,call.arguments,'part');
    const source=w.current();
    if(!source)throw Error('Create or open a Part first.');
    if(call.name==='aether_cad_inspect')return {...inspectPart(source,call.arguments),writable:w.writable(),can_undo:!!w.history.candidate(-1),can_redo:!!w.history.candidate(1)};
    if(call.name==='aether_cad_feature_references')return inspectFeatureReferences(source,call.arguments);
    if(this.busy)throw Error('Another agent edit is rebuilding.');
    if(!w.available())throw Error('Finish or cancel the open sketch/feature and return to Modeling first.');
    if(call.name==='aether_cad_verify'||call.name==='aether_cad_preview'){
      const operation=call.name==='aether_cad_verify'?()=>w.verify?.(source,call.arguments,signal):()=>w.preview?.(source,signal);
      this.busy=true;
      const signature=serializePartDocument(source);
      try {
        const result=await operation();
        if(result===undefined)throw Error('This CAD runtime does not provide this verification tool.');
        signal.throwIfAborted();
        if(w.current()!==source||serializePartDocument(source)!==signature||w.contextKey()!==contextKey||!w.available())throw Error('The Part changed while inspecting. Request new evidence.');
        return result;
      }finally{this.busy=false;}
    }
    if(!w.writable())throw Error('This Part is read-only.');
    const signature=serializePartDocument(source);
    const direction=call.name==='aether_cad_undo'?-1:call.name==='aether_cad_redo'?1:null;
    this.busy=true;
    try {
      let model!:ImportedModelData;
      const qualify=async(candidate:PartDocument)=>{
        signal.throwIfAborted();
        if(candidate.documentId!==source.documentId)throw Error('The program changed Part identity.');
        model=await w.evaluate(candidate);
        const resolved=resolveExtrusionScopes(resolveBodyOutputs(resolveSketchFrames(candidate,model.sketchFrames),model.bodyOutputs),model.scopeResolutions);
        signal.throwIfAborted();
        if(w.current()!==source||serializePartDocument(source)!==signature||w.contextKey()!==contextKey||!w.available()||!w.writable())throw Error('The Part changed while rebuilding. No agent edit was applied; inspect and try again.');
        return resolved;
      };
      const program=call.name==='aether_cad_run_program'?await executeProgram(source,call.arguments.program_json,qualify):undefined;
      const candidate=direction?w.history.candidate(direction):program?.document??preparePartEdit(source,call.name,call.arguments).document;
      if(!candidate||candidate.documentId!==source.documentId)throw Error('No edit is available in this Part history.');
      const resolved=program?program.document:await qualify(candidate);
      signal.throwIfAborted();
      if(w.current()!==source||serializePartDocument(source)!==signature||w.contextKey()!==contextKey||!w.available()||!w.writable())throw Error('The Part changed while rebuilding. No agent edit was applied; inspect and try again.');
      const commit=()=>w.commit(resolved,model);
      if(direction)w.history.commit(direction,candidate,commit);else commit();
      return {changed:true,...(program?{steps:program.references}:{}),document_id:resolved.documentId,feature_ids:resolved.features.filter(f=>!source.features.some(previous=>previous.id===f.id)).map(f=>f.id),
        body_ids:model.parts.map(part=>part.id),body_count:model.parts.length,feature_count:resolved.features.length,rebuild_ms:model.parseMilliseconds};
    }finally{this.busy=false;}
  }
}
let workspace:CADAgentWorkspace|undefined,editor:CADAgentEditor|undefined;
let assemblyWorkspace: {active:()=>boolean;contextKey:()=>string;interaction:(key:string)=>AgentInteraction}|undefined;
export function configureAssemblyAgentWorkspace(value:NonNullable<typeof assemblyWorkspace>){assemblyWorkspace=value;}
const listeners=new Set<()=>void>();
export function configureCADAgentWorkspace(value:CADAgentWorkspace){workspace=value;editor=new CADAgentEditor(value);for(const listener of listeners)listener();}
export const cadAgentContext=()=>assemblyWorkspace?.active()?assemblyWorkspace.contextKey():workspace?.contextKey()??'not-ready';
export function subscribeCADAgent(listener:()=>void){
  listeners.add(listener);window.addEventListener('aether-part-updated',listener);window.addEventListener('cad-document-navigation',listener);
  return()=>{listeners.delete(listener);window.removeEventListener('aether-part-updated',listener);window.removeEventListener('cad-document-navigation',listener);};
}
export function cadAgentInteraction(contextKey:string):AgentInteraction {
  if(assemblyWorkspace?.active())return assemblyWorkspace.interaction(contextKey);
  return {contextKey,tools:cadAgentTools,execute:async(call,signal)=>{
    if(!editor)throw Error('The CAD workspace is not ready.');
    return editor.execute(contextKey,call,signal);
  }};
}
