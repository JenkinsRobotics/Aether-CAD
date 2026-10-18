import {createEmptyPartDocument,insertFeature,validatePartDocument,type PartDocument,type SketchPlane} from '@aether/core/document';
import {importDxfSketch} from '@aether/core/sketch';
import {importVectorSVG} from '../sketch/svg-import';
/** Insert into an editable profile on an explicit plane, without requiring an open sketch. */
export function appendVector(document:PartDocument|null,name:string,text:string,format:'svg'|'dxf',plane:SketchPlane,scale:number) {
 if(!Number.isFinite(scale)||scale<=0)throw Error('Scale must be positive.');
 if(!text.length||text.length>3*1024*1024)throw Error('Choose a nonempty vector file smaller than 3 MiB.');
 const parsed=format==='svg'?importVectorSVG(text,scale):importDxfSketch(text,scale,{joinConnected:true,classifyHoles:true});
 const base=document??createEmptyPartDocument(name.replace(/\.[^.]+$/,''));
 const next=insertFeature(base,{id:crypto.randomUUID(),name:name.replace(/\.[^.]+$/,''),type:'profile',plane,offsetMillimeters:0,suppressed:false,profile:parsed.drawing});
 validatePartDocument(next);
 if(new TextEncoder().encode(JSON.stringify(next)).length>4*1024*1024)throw Error('The resulting Part exceeds the 4 MiB document limit.');
 return next;
}
