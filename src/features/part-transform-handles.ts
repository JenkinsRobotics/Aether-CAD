import { mountTransformManipulator, type ManipulatorHandle } from '@aether/ui';
import type {ImportedModelData,TransformPreviewFrame} from '@aether/core/contracts';
import type {NumericPartTransform} from '@aether/core/document';
import type {TransformGizmoRequest,TransformHandleKey,TransformHandleProjection} from '../viewport/transform-gizmo';
import type {Controls} from './shared';

/** Drag the existing controls; preview, validation and commit keep one owner. */
export function mountTransformHandles(panel:HTMLElement,c:Controls,lengthUnit:string,angleUnit:string) {
 const viewport=document.querySelector<HTMLElement>('.cad-studio-viewport');if(!viewport||!window.requestAnimationFrame)return;
 const keys:TransformHandleKey[]=['distance','moveX','moveY','moveZ','angle','scaleX','scaleY','scaleZ'];
 let nativeFrame:TransformPreviewFrame|undefined,ready=false,raf=0,disposed=false;
 let projections:TransformHandleProjection[]=[];
 type Drag={id:number;key:TransformHandleKey;projection:TransformHandleProjection;previous:number;value:number;original:string};let drag:Drag|undefined;
 const factor=(key:TransformHandleKey)=>Number(c[key].dataset.canonicalFactor??1);
 const read=(key:string)=>Number(c[key].value)*Number(c[key].dataset.canonicalFactor??1);
 const vector=(prefix:string):[number,number,number]=>['X','Y','Z'].map(axis=>read(prefix+axis)) as [number,number,number];
 const transform=():NumericPartTransform|null=>{
  const resolved=nativeFrame?.resolvedTransform;
  if(c.mode.value==='translate-reference'){
   if(c.useDistance.value!=='yes'||resolved?.kind!=='translate'||!nativeFrame?.referenceDirection)return null;
   return{kind:'translate',translationMillimeters:nativeFrame.referenceDirection.map(n=>n*read('distance')) as [number,number,number]};
  }
  if(c.mode.value==='rotate-reference')return resolved?.kind==='rotate'?{...resolved,angleDegrees:read('angle')}:null;
  if(c.mode.value==='scale-reference')return resolved?.kind==='scale'?{...resolved,scaleFactors:c.uniform?.value==='yes'?[read('scaleX'),read('scaleX'),read('scaleX')]:vector('scale')}:null;
  if(c.mode.value==='translate')return {kind:'translate',translationMillimeters:vector('move')};
  if(c.mode.value==='rotate'){const axis=vector('axis'),len=Math.hypot(...axis);if(!Number.isFinite(len)||len<1e-12)return null;return{kind:'rotate',axisOriginMillimeters:vector('origin'),axisDirection:axis.map(v=>v/len) as [number,number,number],angleDegrees:read('angle')};}
  if(c.mode.value==='scale')return {kind:'scale',centerMillimeters:vector('center'),scaleFactors:c.uniform?.value==='yes'?[read('scaleX'),read('scaleX'),read('scaleX')]:vector('scale')};
  return null;
 };
 const set=(key:TransformHandleKey,value:number)=>{
  if(!Number.isFinite(value))return;
  if(key.startsWith('scale'))value=Math.max(value,1e-6);
  c[key].value=String(Number((value/factor(key)).toPrecision(8)));c[key].dispatchEvent(new Event('input'));
 };
 const finish=(restore:boolean)=>{
  if(!drag)return;
  const previous=drag;drag=undefined;delete document.body.dataset.cadHandleDrag;
  if(restore){c[previous.key].value=previous.original;c[previous.key].dispatchEvent(new Event('input'));}
  c[previous.key].dispatchEvent(new Event('change'));
 };
 const receive=(event:Event)=>{
  const state=(event as CustomEvent<{model?:ImportedModelData|null;pending:boolean}>).detail;
  ready=!state.pending;
  if(!state.pending){const preview=state.model?.featurePreview;nativeFrame=preview&&preview.featureId===panel.dataset.featureId?preview.transformFrame:undefined;}
 };
 panel.addEventListener('aether-feature-preview-state',receive);
 const widget=mountTransformManipulator(viewport,{
  onStart(handle,event){
   if(!ready||drag)return false;
   const key=handle.id as TransformHandleKey,projection=projections.find(p=>p.key===key);if(!projection)return false;
   const value=projection.valueAt(event.clientX,event.clientY);if(value===null||!Number.isFinite(read(key)))return false;
   drag={id:event.pointerId,key,projection,previous:value,value:read(key),original:c[key].value};document.body.dataset.cadHandleDrag='1';
  },
  onMove(_handle,event){
   if(!drag)return;
   const value=drag.projection.valueAt(event.clientX,event.clientY);if(value===null)return;
   let delta=value-drag.previous;const period=drag.projection.cyclic;if(period)delta=((delta+period/2)%period+period)%period-period/2;
   drag.previous=value;drag.value+=delta*(event.shiftKey?.1:1);
   if(drag.key.startsWith('scale'))drag.value=Math.max(drag.value,1e-6);
   set(drag.key,drag.value);
  },
  onEnd(_handle,cancelled){finish(cancelled);},
  onKey(handle,event){
   if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)||!ready||drag)return;
   const key=handle.id as TransformHandleKey;
   event.preventDefault();event.stopPropagation();const sign=['ArrowUp','ArrowRight'].includes(event.key)?1:-1;
   const step=key==='angle'?(event.shiftKey?1:15):key.startsWith('scale')?(event.shiftKey?.01:.1):factor(key)*(event.shiftKey?.1:1);
   set(key,read(key)+step*sign);c[key].dispatchEvent(new Event('change'));
  },
 });
 widget.element.classList.add('cad-transform-handles');
 const kind=(key:TransformHandleKey):ManipulatorHandle['kind']=>key==='angle'?'rotation':key.startsWith('scale')?'scale':'axis';
 // Stable handles retain focus and pointer ownership through native previews.
 widget.update(keys.map(key=>({id:key,kind:kind(key),label:key,x:0,y:0})));widget.update([]);
 const modeChanged=()=>widget.cancel();const watched=['mode','uniform','faces','bodies','referenceMode','referenceLine','referenceEdge','fromPoint','toPoint','centerPoint','useDistance','reverseReference'].flatMap(key=>c[key]?[c[key]]:[]);watched.forEach(control=>control.addEventListener('change',modeChanged));
 const update=()=>{
  if(!panel.isConnected){dispose();return;}
  const t=transform();let next:TransformHandleProjection[]=[];
  if(nativeFrame&&t){const request:TransformGizmoRequest={frame:nativeFrame,transform:t,uniform:c.uniform?.value==='yes',...(c.mode.value==='translate-reference'?{translationAxis:nativeFrame.referenceDirection}:{})};window.dispatchEvent(new CustomEvent('aether-transform-handles',{detail:{...request,respond:(p:TransformHandleProjection[])=>{next=p;}}}));}
  if(drag&&!next.some(p=>p.key===drag!.key))next.push(drag.projection);
  projections=next;const rect=viewport.getBoundingClientRect();
  widget.update(next.map(p=>{
   const start=p.points[0];
   return {id:p.key,kind:kind(p.key),x:p.x-rect.left,y:p.y-rect.top,
    angle:p.key==='angle'?0:Math.atan2(p.y-start.y,p.x-start.x)*180/Math.PI+90,
    label:`${p.label} · ${c[p.key].value} ${p.key==='angle'?angleUnit:p.key.startsWith('scale')?'×':lengthUnit}. Shift for fine adjustment; arrow keys adjust; Escape cancels.`};
  }),{disabled:!ready});
  raf=window.requestAnimationFrame(update);
 };
 const dispose=()=>{if(disposed)return;disposed=true;window.cancelAnimationFrame(raf);widget.dispose();panel.removeEventListener('aether-feature-preview-state',receive);watched.forEach(control=>control.removeEventListener('change',modeChanged));observer.disconnect();};
 const observer=new window.MutationObserver(()=>{if(!panel.isConnected)dispose();});observer.observe(document.body,{childList:true,subtree:true});raf=window.requestAnimationFrame(update);
 return dispose;
}
