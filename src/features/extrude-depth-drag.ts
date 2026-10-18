import {directionVector} from './extrude-direction';
/** Scrub the existing depth field; preview/commit remain owned by the feature editor. */
export function extrudeDepthDrag(distance: HTMLInputElement | HTMLSelectElement, reversed: HTMLInputElement | HTMLSelectElement, unit: string): HTMLButtonElement {
  const handle = document.createElement('button');
  handle.type = 'button';
  handle.textContent = 'Drag depth';
  handle.className = 'cad-depth-drag';
  handle.setAttribute('aria-label', 'Drag extrusion depth');
  handle.title = `Drag up/down to change depth (${unit}); Shift for fine adjustment. Arrow keys adjust; Escape restores the drag.`;
  handle.style.touchAction = 'none';
  handle.style.cursor = 'ns-resize';
  let drag: {id:number;y:number;value:string;reverse:string;start:number;step:number} | undefined;
  const signed = () => Number(distance.value) * (reversed.value === 'true' ? -1 : 1);
  const set = (value:number) => {
    if (!Number.isFinite(value)) return;
    distance.value = String(Number(Math.max(Math.abs(value), 0.000001).toPrecision(8)));
    reversed.value = String(value < 0);
    reversed.dispatchEvent(new Event('change'));
    distance.dispatchEvent(new Event('input'));
  };
  handle.addEventListener('pointerdown', event => {
    if(event.button !== 0 || !Number.isFinite(signed()))return;
    event.preventDefault(); handle.focus();
    drag={id:event.pointerId,y:event.clientY,value:distance.value,reverse:reversed.value,start:signed(),step:Math.max(Math.abs(signed())/100,0.01)};
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener('pointermove', event => {
    if(!drag || event.pointerId!==drag.id)return;
    set(drag.start+(drag.y-event.clientY)*drag.step*(event.shiftKey?0.1:1));
  });
  const finish = (restore:boolean) => {
    if(!drag)return;
    const previous=drag;drag=undefined;
    if(restore){distance.value=previous.value;reversed.value=previous.reverse;reversed.dispatchEvent(new Event('change'));distance.dispatchEvent(new Event('input'));}
    if(handle.hasPointerCapture(previous.id))handle.releasePointerCapture(previous.id);
    distance.dispatchEvent(new Event('change'));
  };
  handle.addEventListener('pointerup',()=>finish(false));
  handle.addEventListener('pointercancel',()=>finish(true));
  handle.addEventListener('lostpointercapture',()=>finish(true));
  handle.addEventListener('keydown',event=>{
    if(event.key==='Escape' && drag){event.preventDefault();event.stopPropagation();finish(true);}
    if(event.key==='ArrowUp'||event.key==='ArrowDown'){
      event.preventDefault();event.stopPropagation();
      set(signed()+(event.key==='ArrowUp'?1:-1)*(event.shiftKey?0.1:1));
    }
  });
  return handle;
}

export type AxisProjection = {x:number;y:number;depthAt:(x:number,y:number)=>number|null};
type HandleOptions = {
  valueMode?: 'signed'|'magnitude'|'positive';
  label?: string;
  ready?: ()=>boolean;
  enabled?: ()=>boolean;
  formatLabel?: (value:string,unit:string)=>string;
};
/** Uses the viewer's evaluated sketch frame; this never manufactures geometry. */
export function mountExtrusionHandle(panel: HTMLElement, controls: Record<string,HTMLInputElement|HTMLSelectElement>, unit:string, axisRequest?: (depthMillimeters:number, respond:(projection:AxisProjection|null)=>void)=>void, options:HandleOptions={}): void {
  const viewport=document.querySelector<HTMLElement>('.cad-studio-viewport');
  if(!viewport || !window.requestAnimationFrame)return;
  const handle=document.createElement('button');handle.type='button';handle.className='cad-extrusion-handle';
  handle.hidden=true;
  handle.setAttribute('aria-label',options.label??'Pull extrusion depth');
  handle.title='Drag along the extrusion direction to push or pull. Escape restores the depth.';
  Object.assign(handle.style,{position:'absolute',zIndex:'8',touchAction:'none',cursor:'grab',transform:'translate(-50%, -50%)',border:'1px solid #6ba7e0',borderRadius:'4px',background:'#2672b6',color:'white',padding:'5px 9px'});
  viewport.append(handle);
  const {distance,selections,endType,offset,second}=controls;
  const reversed=controls.reversed ?? document.createElement('input');
  // Native Remove grows into the sketch plane by default; Add grows outward.
  const operationDirection=()=>!axisRequest && controls.operation?.value==='cut'?-1:1;
  const valueMode=options.valueMode??(axisRequest?'signed':'magnitude');
  const direction=()=>valueMode!=='magnitude'?1:operationDirection()*(reversed.value==='true'?-1:1);
  const factor=Number(distance.dataset.canonicalFactor??1);
  let projection:AxisProjection|null=null, frame=0;
  let drag:{id:number;start:number;axis:number;projection:AxisProjection;value:string;reverse:string}|undefined;
  const update=()=>{
    if(!panel.isConnected){cancel(true);handle.remove();return;}
    projection=null;
    const respond=(value:AxisProjection|null)=>{projection=value;};
    const depth=Number(distance.value)*factor*direction();
    if(options.enabled?.()===false){ /* No axis for the current preview. */ }
    else if(axisRequest)axisRequest(depth,respond);
    else {
      const picks=JSON.parse(selections.value) as {featureId:string}[];
      const ids=[...new Set(picks.map(p=>p.featureId))];
      if(ids.length===1 && !(controls.startEnabled?.value==='true'&&controls.startMode?.value!=='offset') && endType.value==='blind' && (controls.startEnabled?.value==='false'||Number(offset.value)===0) && (controls.secondEnabled?controls.secondEnabled.value!=='true':Number(second.value)===0)){
        const vector=directionVector(Object.fromEntries(Object.entries(controls).map(([key,control])=>[key,control.value])));
        if(vector!==null)window.dispatchEvent(new CustomEvent('aether-extrusion-handle',{detail:{featureId:ids[0],depth,directionVector:vector,respond}}));
      }
    }
    const point=projection as AxisProjection|null;
    handle.hidden=!point;
    handle.disabled=!drag&&options.ready?.()===false;
    if(point){const rect=viewport.getBoundingClientRect();handle.style.left=`${point.x-rect.left}px`;handle.style.top=`${point.y-rect.top}px`;const label=options.formatLabel?.(distance.value,unit)??`${distance.value} ${unit}`;if(handle.textContent!==label)handle.textContent=label;}
    frame=window.requestAnimationFrame(update);
  };
  const change=(mm:number)=>{
    if(!Number.isFinite(mm))return;
    const depth=valueMode==='signed'?mm:Math.max(valueMode==='positive'?mm:Math.abs(mm),0.000001);
    distance.value=String(Number((depth/factor).toPrecision(8)));
    if(valueMode==='magnitude'){reversed.value=String(mm*operationDirection()<0);reversed.dispatchEvent(new Event('change'));}
    distance.dispatchEvent(new Event('input'));
  };
  const cancel=(restore:boolean)=>{
    if(!drag)return;
    const previous=drag;drag=undefined;
    if(restore){distance.value=previous.value;reversed.value=previous.reverse;reversed.dispatchEvent(new Event('change'));distance.dispatchEvent(new Event('input'));}
    if(handle.hasPointerCapture(previous.id))handle.releasePointerCapture(previous.id);
  };
  handle.addEventListener('pointerdown',event=>{
    if(event.button!==0||!projection||options.ready?.()===false)return;
    const axis=projection.depthAt(event.clientX,event.clientY);if(axis===null)return;
    event.preventDefault();event.stopPropagation();handle.focus();
    drag={id:event.pointerId,start:Number(distance.value)*factor*direction(),axis,projection,value:distance.value,reverse:reversed.value};
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener('pointermove',event=>{
    if(!drag||event.pointerId!==drag.id)return;
    const axis=drag.projection.depthAt(event.clientX,event.clientY);
    if(axis!==null)change(drag.start+axis-drag.axis);
  });
  handle.addEventListener('pointerup',()=>cancel(false));
  handle.addEventListener('pointercancel',()=>cancel(true));
  handle.addEventListener('lostpointercapture',()=>cancel(true));
  handle.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&drag){event.preventDefault();event.stopPropagation();cancel(true);}
    if((event.key==='ArrowUp'||event.key==='ArrowDown')&&options.ready?.()!==false){event.preventDefault();event.stopPropagation();change((Number(distance.value)+(event.key==='ArrowUp'?1:-1)*(event.shiftKey?0.1:1))*factor*direction());}
  });
  const observer=new window.MutationObserver(()=>{if(!panel.isConnected){window.cancelAnimationFrame(frame);cancel(true);handle.remove();observer.disconnect();}});
  observer.observe(document.body,{childList:true,subtree:true});
  frame=window.requestAnimationFrame(update);
}
