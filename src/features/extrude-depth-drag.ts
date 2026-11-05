import {registerValueHandle} from './value-handles';
import {evaluateQuantityExpression} from '@aether/core/units';
// Several handles may share a label (a face offset's sides): the serial keeps their ids apart.
let handleSerial=0;
import {directionVector} from './extrude-direction';
import dragIcon from '@aether/assets/icons/arrows-vertical.svg?raw';
import './extrude-depth-drag.css';
/** Scrub the existing depth field; preview/commit remain owned by the feature editor. */
export function extrudeDepthDrag(distance: HTMLInputElement | HTMLSelectElement, reversed: HTMLInputElement | HTMLSelectElement, unit: string): HTMLButtonElement {
  const handle = document.createElement('button');
  handle.type = 'button';
  handle.innerHTML = dragIcon; // icon-only, so the depth field keeps the row's width
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

export type AxisProjection = import('../viewport/linear-axis-projection').LinearAxisProjection;
type HandleOptions = {
  valueMode?: 'signed'|'magnitude'|'positive'|'nonnegative';
  label?: string;
  ready?: ()=>boolean;
  enabled?: ()=>boolean;
  formatLabel?: (value:string,unit:string)=>string;
};
/** Uses the viewer's evaluated sketch frame; this never manufactures geometry. The handle is a
 *  provider on the viewport's shared value manipulator (value-handles.ts). */
export function mountExtrusionHandle(panel: HTMLElement, controls: Record<string,HTMLInputElement|HTMLSelectElement>, unit:string, axisRequest?: (depthMillimeters:number, respond:(projection:AxisProjection|null)=>void)=>void, options:HandleOptions={}): void {
  if(!window.requestAnimationFrame)return;
  const {distance,selections,endType,offset,second}=controls;
  const reversed=controls.reversed ?? document.createElement('input');
  // Native Remove grows into the sketch plane by default; Add grows outward.
  const operationDirection=()=>!axisRequest && controls.operation?.value==='cut'?-1:1;
  const valueMode=options.valueMode??(axisRequest?'signed':'magnitude');
  const direction=()=>valueMode!=='magnitude'?1:operationDirection()*(reversed.value==='true'?-1:1);
  const factor=Number(distance.dataset.canonicalFactor??1);
  const projectAt=(depth:number):AxisProjection|null=>{
    let projection:AxisProjection|null=null;
    const respond=(value:AxisProjection|null)=>{projection=value;};
    if(options.enabled?.()===false)return null;
    if(axisRequest)axisRequest(depth,respond);
    else {
      const picks=JSON.parse(selections.value) as {featureId:string}[];
      const ids=[...new Set(picks.map(p=>p.featureId))];
      if(ids.length===1 && !(controls.startEnabled?.value==='true'&&controls.startMode?.value!=='offset') && endType.value==='blind' && (controls.startEnabled?.value==='false'||Number(offset.value)===0) && (controls.secondEnabled?controls.secondEnabled.value!=='true':Number(second.value)===0)) {
        const vector=directionVector(Object.fromEntries(Object.entries(controls).map(([key,control])=>[key,control.value])));
        if(vector!==null)window.dispatchEvent(new CustomEvent('aether-extrusion-handle',{detail:{featureId:ids[0],depth,directionVector:vector,respond}}));
      }
    }
    return projection;
  };
  let drag:{start:number;axis:number;projection:AxisProjection;value:string;reverse:string}|undefined;
  const change=(mm:number)=>{
    if(!Number.isFinite(mm))return;
    const depth=valueMode==='signed'?mm:valueMode==='nonnegative'?Math.max(mm,0):Math.max(valueMode==='positive'?mm:Math.abs(mm),0.000001);
    distance.value=String(Number((depth/factor).toPrecision(8)));
    if(valueMode==='magnitude'){reversed.value=String(mm*operationDirection()<0);reversed.dispatchEvent(new Event('change'));}
    distance.dispatchEvent(new Event('input'));
  };
  registerValueHandle({
    id:`${panel.dataset.featureId??panel.id??'feature'}:${options.label??'depth'}:${++handleSerial}`, kind:'axis', label:options.label??'Pull extrusion depth', panel,
    project(){
      // The origin (depth 0) first, so the live depth is the last projection the viewer served.
      const origin=projectAt(0), probe=Number(distance.value)===0?projectAt(1):null;
      const point=projectAt(Number(distance.value)*factor*direction()); if(!point)return null;
      const angle=probe&&origin?Math.atan2(probe.y-origin.y,probe.x-origin.x)*180/Math.PI+90:undefined;
      return {...point, angle, origin: origin && (origin.x!==point.x||origin.y!==point.y) ? {x:origin.x,y:origin.y} : undefined};
    },
    text(){ return `${distance.value} ${unit}`; },
    ready(){ return options.ready?.()!==false; },
    begin(event,projection){
      const p=projection as AxisProjection; const axis=p.depthAt(event.clientX,event.clientY); if(axis===null)return false;
      drag={start:Number(distance.value)*factor*direction(),axis,projection:p,value:distance.value,reverse:reversed.value}; return true;
    },
    move(event){ if(!drag)return; const axis=drag.projection.depthAt(event.clientX,event.clientY); if(axis!==null){drag.start+=(axis-drag.axis)*(event.shiftKey?0.1:1);drag.axis=axis;change(drag.start);} },
    end(cancelled){
      if(!drag)return; const previous=drag; drag=undefined;
      if(cancelled){distance.value=previous.value;reversed.value=previous.reverse;reversed.dispatchEvent(new Event('change'));distance.dispatchEvent(new Event('input'));}
      distance.dispatchEvent(new Event('change'));
    },
    key(event){
      if((event.key==='ArrowUp'||event.key==='ArrowDown')&&options.ready?.()!==false){event.preventDefault();event.stopPropagation();change((Number(distance.value)+(event.key==='ArrowUp'?1:-1)*(event.shiftKey?0.1:1))*factor*direction());distance.dispatchEvent(new Event('change'));}
    },
    commit(text){
      try {
        const value=evaluateQuantityExpression(text,{family:'length',factor:factor/1000});
        if(!text.trim()||!Number.isFinite(value))throw new Error('Invalid length');
        if(valueMode==='positive'&&value<=0)return 'Enter a positive length.';
        if(valueMode==='nonnegative'&&value<0)return 'Enter a nonnegative length.';
        change(value*factor*direction());distance.dispatchEvent(new Event('change'));
      } catch { return 'Enter a valid length or expression, such as 10 mm or 1/2 in.'; }
    },
  });
}
