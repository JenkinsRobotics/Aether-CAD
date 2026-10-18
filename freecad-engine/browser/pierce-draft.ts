/** Repairable editor projection. Broken references remain saved relationships;
 * they never become independent geometry or fabricated contact points. */
import type { PartFeature } from '../../aether-engine/src/document/part-document';
import { resolveProfileDrawing } from '../../aether-engine/src/document/profile-projection';
import type { SketchDrawing } from '../../aether-engine/src/sketch/drawing';
import { solveDrawingConstraints } from '../../aether-engine/src/sketch/solver/solve';
import { validatePierceConstraint } from './pierce-context';
import { resolveSketchPierce } from './pierce-reference';

export interface PierceIssue { id:string; message:string }
export function preparePierceDraft(features:readonly PartFeature[],targetId:string,input:SketchDrawing):{drawing:SketchDrawing;issues:PierceIssue[]} {
 const drawing=structuredClone(input),issues:PierceIssue[]=[],cache=new Map<string,SketchDrawing>();
 delete drawing.pierceContext;
 const sourceDrawing=(id:string)=>{let value=cache.get(id);if(!value){value=resolveProfileDrawing(features,id);cache.set(id,value);}return value;};
 for(const c of drawing.constraints??[]) {
  if(c.kind!=='pierce')continue;
  try {
   validatePierceConstraint(c);
   const hit=resolveSketchPierce(features,targetId,c.source!,sourceDrawing);
   (drawing.pierceContext??=Object.create(null))[c.id]={source:structuredClone(c.source!),point:[...hit.point]};
  }catch(error){issues.push({id:c.id,message:error instanceof Error?error.message:String(error)});}
 }
 return {drawing:issues.length?drawing:solveDrawingConstraints(drawing),issues};
}
