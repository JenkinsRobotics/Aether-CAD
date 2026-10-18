import type {ImportedModelData,TransformPreviewFrame} from '@aether/core/contracts';
import type {NumericPartTransform} from '@aether/core/document';
import type {TransformGizmoRequest,TransformHandleKey,TransformHandleProjection} from '../viewport/transform-gizmo';
import type {Controls} from './shared';

/** Drag the existing controls; preview, validation and commit keep one owner. */
export function mountTransformHandles(panel:HTMLElement,c:Controls,lengthUnit:string,angleUnit:string) {
 const viewport=document.querySelector<HTMLElement>('.cad-studio-viewport');if(!viewport||!window.requestAnimationFrame)return;
 const root=document.createElement('div');root.className='cad-transform-handles';Object.assign(root.style,{position:'absolute',inset:'0',pointerEvents:'none',zIndex:'8'});
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');Object.assign(svg.style,{position:'absolute',inset:'0',width:'100%',height:'100%',overflow:'hidden'});svg.setAttribute('aria-hidden','true');root.append(svg);viewport.append(root);
 const keys:TransformHandleKey[]=['distance','moveX','moveY','moveZ','angle','scaleX','scaleY','scaleZ'];
 const buttons=new Map<TransformHandleKey,HTMLButtonElement>();
 const lines=new Map<TransformHandleKey,SVGPolylineElement>();
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
  const previous=drag;drag=undefined;
  if(restore){c[previous.key].value=previous.original;c[previous.key].dispatchEvent(new Event('input'));}
  const button=buttons.get(previous.key)!;if(button.hasPointerCapture(previous.id))button.releasePointerCapture(previous.id);
  c[previous.key].dispatchEvent(new Event('change'));
 };
 const receive=(event:Event)=>{
  const state=(event as CustomEvent<{model?:ImportedModelData|null;pending:boolean}>).detail;
  ready=!state.pending;
  if(!state.pending){const preview=state.model?.featurePreview;nativeFrame=preview&&preview.featureId===panel.dataset.featureId?preview.transformFrame:undefined;}
 };
 panel.addEventListener('aether-feature-preview-state',receive);
 for(const key of keys){
  const line=document.createElementNS('http://www.w3.org/2000/svg','polyline');line.style.display='none';line.setAttribute('fill','none');line.setAttribute('stroke-width','2');line.dataset.transformAxis=key;lines.set(key,line);svg.append(line);
  const button=document.createElement('button');button.type='button';button.dataset.transformHandle=key;button.hidden=true;
  Object.assign(button.style,{position:'absolute',pointerEvents:'auto',touchAction:'none',cursor:'grab',transform:'translate(-50%, -50%)',border:'1px solid currentColor',borderRadius:key==='angle'?'14px':'4px',padding:'5px 8px',background:'var(--aui-surface, white)',fontSize:'11px',fontWeight:'600',whiteSpace:'nowrap',boxShadow:'0 1px 4px #0002'});
  buttons.set(key,button);root.append(button);
  button.addEventListener('pointerdown',event=>{
   if(event.button!==0||!ready||drag)return;
   const projection=projections.find(p=>p.key===key);if(!projection)return;
   const value=projection.valueAt(event.clientX,event.clientY);if(value===null||!Number.isFinite(read(key)))return;
   event.preventDefault();event.stopPropagation();button.focus();drag={id:event.pointerId,key,projection,previous:value,value:read(key),original:c[key].value};button.setPointerCapture(event.pointerId);
  });
  button.addEventListener('pointermove',event=>{
   if(!drag||drag.key!==key||event.pointerId!==drag.id)return;
   const value=drag.projection.valueAt(event.clientX,event.clientY);if(value===null)return;
   let delta=value-drag.previous;const period=drag.projection.cyclic;if(period)delta=((delta+period/2)%period+period)%period-period/2;
   drag.previous=value;drag.value+=delta*(event.shiftKey?.1:1);
   if(key.startsWith('scale'))drag.value=Math.max(drag.value,1e-6);
   set(key,drag.value);event.stopPropagation();
  });
  button.addEventListener('pointerup',event=>{if(drag?.key===key&&drag.id===event.pointerId){event.stopPropagation();finish(false);}});
  button.addEventListener('pointercancel',()=>finish(true));button.addEventListener('lostpointercapture',()=>finish(true));
  button.addEventListener('keydown',event=>{
   if(event.key==='Escape'&&drag){event.preventDefault();event.stopPropagation();finish(true);return;}
   if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)||!ready)return;
   event.preventDefault();event.stopPropagation();const sign=['ArrowUp','ArrowRight'].includes(event.key)?1:-1;
   const step=key==='angle'?(event.shiftKey?1:15):key.startsWith('scale')?(event.shiftKey?.01:.1):factor(key)*(event.shiftKey?.1:1);
   set(key,read(key)+step*sign);c[key].dispatchEvent(new Event('change'));
  });
 }
 const modeChanged=()=>finish(true);const watched=['mode','uniform','faces','bodies','referenceMode','referenceLine','referenceEdge','fromPoint','toPoint','centerPoint','useDistance','reverseReference'].flatMap(key=>c[key]?[c[key]]:[]);watched.forEach(control=>control.addEventListener('change',modeChanged));
 const update=()=>{
  if(!panel.isConnected){dispose();return;}
  const t=transform();let next:TransformHandleProjection[]=[];
  if(nativeFrame&&t){const request:TransformGizmoRequest={frame:nativeFrame,transform:t,uniform:c.uniform?.value==='yes',...(c.mode.value==='translate-reference'?{translationAxis:nativeFrame.referenceDirection}:{})};window.dispatchEvent(new CustomEvent('aether-transform-handles',{detail:{...request,respond:(p:TransformHandleProjection[])=>{next=p;}}}));}
  if(drag&&!next.some(p=>p.key===drag!.key))next.push(drag.projection);
  projections=next;const rect=viewport.getBoundingClientRect();
  for(const[key,button]of buttons){
   const p=next.find(p=>p.key===key),line=lines.get(key)!;button.hidden=!p;line.style.display=p?'':'none';button.disabled=!drag&&!ready;if(!p)continue;
   button.style.left=`${p.x-rect.left}px`;button.style.top=`${p.y-rect.top}px`;button.style.color=p.color;
   button.setAttribute('aria-label',p.label);button.title=`${p.label}. Drag; Shift for fine adjustment. Arrow keys adjust. Escape restores the drag.`;
   const text=`${key==='distance'?'Distance':key==='angle'?'Rotate':key.startsWith('scale')&&c.uniform?.value==='yes'?'Scale':key.slice(-1)} · ${c[key].value}${key==='angle'?` ${angleUnit}`:key.startsWith('scale')?'×':` ${lengthUnit}`}`;
   if(button.textContent!==text)button.textContent=text;
   const points=p.points.map(q=>`${q.x-rect.left},${q.y-rect.top}`).join(' ');if(line.getAttribute('points')!==points)line.setAttribute('points',points);line.setAttribute('stroke',p.color);line.setAttribute('opacity',ready?'0.85':'0.4');
  }
  raf=window.requestAnimationFrame(update);
 };
 const dispose=()=>{if(disposed)return;disposed=true;window.cancelAnimationFrame(raf);finish(true);panel.removeEventListener('aether-feature-preview-state',receive);watched.forEach(control=>control.removeEventListener('change',modeChanged));observer.disconnect();root.remove();};
 const observer=new window.MutationObserver(()=>{if(!panel.isConnected)dispose();});observer.observe(document.body,{childList:true,subtree:true});raf=window.requestAnimationFrame(update);
 return dispose;
}
