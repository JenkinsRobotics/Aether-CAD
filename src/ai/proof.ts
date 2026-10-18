import { agentCanvasImage, agentToolContent } from '@aether/ui/AgentToolResult';
import type { PartDocument } from '@aether/core/document';
import { analyzePart } from '../modeling/part-analysis';

export async function verifyPart(doc:PartDocument,args:Record<string,unknown>,signal:AbortSignal){
  const density=args.density_kg_m3;
  const offset=args.offset??0;
  if(typeof offset!=='number'||!Number.isInteger(offset)||offset<0||offset>512)throw Error('Use an integer offset from 0 to 512.');
  if(density!==undefined&&(typeof density!=='number'||!Number.isFinite(density)||density<=0||density>1e6))throw Error('Density must be positive and no more than 1000000 kg/m³.');
  const result=await analyzePart(doc,{kind:'properties',...(density!==undefined?{density_kg_m3:density as number}:{})},signal);
  signal.throwIfAborted();
  if(!Array.isArray(result.measurements)||result.measurements.length>512)throw Error('Invalid or oversized geometry measurements.');
  return {changed:false,document_id:doc.documentId,source:'native-exact-solids',units:{volume:'mm³',area:'mm²',length:'mm',mass:'kg',inertia:'kg·m²'},
    total_bodies:result.measurements.length,measurements:result.measurements.slice(offset,offset+20),
    next_offset:offset+20<result.measurements.length?offset+20:null};
}
export function viewportProof(canvas:HTMLCanvasElement,documentID:string|undefined,signal:AbortSignal){
  return agentToolContent({changed:false,document_id:documentID,source:'current-viewport',
    limits:'Current camera, visibility, display settings and overlays. Hidden/off-screen geometry is not shown; no drawing or section certification.'},agentCanvasImage(canvas,signal));
}
