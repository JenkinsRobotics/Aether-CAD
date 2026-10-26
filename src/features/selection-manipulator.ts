import { mountTransformManipulator } from '@aether/ui';
import { availableBodies, insertFeature, type NumericPartTransform, type PartDocument } from '@aether/core/document';
import { cadSelection } from '../cad-selection-store';
import type { MateViewport } from '../viewer';
import type { Point3, ProjectedManipulatorHandle } from '../viewport/selection-manipulator-math';

interface Options {
  viewport: HTMLElement; viewer: MateViewport;
  document(): PartDocument | null;
  editable(): boolean;
  apply(document: PartDocument): Promise<void>;
  status(message: string, error?: boolean): void;
}
/** One drag is one ordinary Transform feature and one undo step. Moving the
 * pivot is session state only and never moves the model or creates history. */
export function mountSelectionManipulator(options: Options) {
  const { viewer, viewport } = options;
  let pivot: Point3 | null = null, identity='', copy=false, busy=false;
  let handles: ProjectedManipulatorHandle[]=[];
  let drag: { handle: ProjectedManipulatorHandle; source: PartDocument; ids: string[]; pivot: Point3; start: Point3 | number | null;
    previous: number; angle: number; translation: Point3; transform: NumericPartTransform | null; originalPivot: Point3 | null } | null=null;
  const context=()=>{
    const source=options.document();
    if (!source || !options.editable() || document.querySelector('.cad-feature-dialog,.cad-measure-window,.cad-section-window,.cad-sketch-workspace,[role="dialog"]')) return null;
    const allowed=new Set(availableBodies(source).map(body=>body.id));
    const ids=[...new Set(cadSelection.snapshot().items.filter(item=>item.kind==='body').map(item=>item.partId))].filter(id=>allowed.has(id));
    const frame=ids.length?viewer.manipulatorFrame(ids):null;
    return frame?{source,ids,frame}:null;
  };
  const end=async(cancelled:boolean)=>{
    if (!drag) return;
    const current=drag; drag=null; viewer.clearManipulatorPreview(); viewer.clearInteractionAnchors();
    delete document.body.dataset.cadHandleDrag;
    if (cancelled) { pivot=current.originalPivot; return; }
    if (current.handle.kind==='pivot' || !current.transform) return;
    if (!options.editable() || options.document()!==current.source) { options.status('The document changed; movement was cancelled.',true); return; }
    const t=current.transform;
    if (t.kind==='translate' && Math.hypot(...t.translationMillimeters)<1e-8 || t.kind==='rotate' && Math.abs(t.angleDegrees)<1e-8) return;
    const copied=copy?Object.fromEntries(current.ids.map(id=>[id,`${current.source.documentId}:copy-${crypto.randomUUID()}`])):undefined;
    busy=true;
    try {
      const candidate=insertFeature(structuredClone(current.source),{id:crypto.randomUUID(),type:'transform',name:copy?'Move copy':t.kind==='rotate'?'Rotate parts':'Move parts',suppressed:false,bodyIds:current.ids,transform:t,...(copied?{copyBodyIds:copied}:{})});
      await options.apply(candidate);
      if (t.kind==='translate') pivot=current.pivot.map((n,i)=>n+t.translationMillimeters[i]) as Point3;
      const ids = copied ? Object.values(copied) : current.ids;
      if(copied) copy=false;
      identity=JSON.stringify([candidate.documentId,ids]);
      cadSelection.dispatch({type:'replace',items:ids.map(id=>({id:`body:${id}`,kind:'body',partId:id,label:availableBodies(candidate).find(body=>body.id===id)?.name ?? 'Part'}))});
      options.status(copied?'Copy moved.':'Transform applied.');
    } catch(error) { pivot=current.originalPivot; options.status(error instanceof Error?error.message:String(error),true); }
    finally {busy=false;}
  };
  const widget=mountTransformManipulator(viewport,{
    onStart(handle,event) {
      const selected=context(), projected=handles.find(h=>h.id===handle.id);
      if (busy || !selected || !projected) return false;
      const at=pivot??selected.frame.centerMillimeters, sample=projected.sample(event.clientX,event.clientY);
      if (handle.kind!=='pivot' && sample===null) return false;
      drag={handle:projected,source:selected.source,ids:selected.ids,pivot:[...at],start:sample,previous:typeof sample==='number'?sample:0,angle:0,translation:[0,0,0],transform:null,originalPivot:pivot&&[...pivot]};
      document.body.dataset.cadHandleDrag='1';
    },
    onMove(_handle,event) {
      if (!drag) return;
      if (drag.handle.kind==='pivot') { pivot=viewer.pickManipulatorPivot(event,drag.pivot)?.point??pivot; return; }
      const sample=drag.handle.sample(event.clientX,event.clientY); if(sample===null)return;
      if(typeof sample==='number') {
        const delta=((sample-drag.previous+540)%360)-180; drag.previous=sample; drag.angle+=delta*(event.shiftKey?.1:1);
        drag.transform={kind:'rotate',axisOriginMillimeters:drag.pivot,axisDirection:drag.handle.axis!,angleDegrees:drag.angle};
      } else if(Array.isArray(drag.start)) {
        const start=drag.start;
        drag.translation=sample.map((n,i)=>drag!.translation[i]+(n-start[i])*(event.shiftKey?.1:1)) as Point3;
        drag.start=sample;
        drag.transform={kind:'translate',translationMillimeters:drag.translation};
      }
      if(drag.transform)viewer.previewManipulatorTransform(drag.ids,drag.transform,copy);
    },
    onEnd(_handle,cancelled) { void end(cancelled); },
    onKey(handle,event) {
      if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)||busy||drag)return;
      const selected=context(),projected=handles.find(h=>h.id===handle.id);
      if(!selected||!projected?.axis)return;
      event.preventDefault();event.stopPropagation();
      const at=pivot??selected.frame.centerMillimeters,step=(['ArrowUp','ArrowRight'].includes(event.key)?1:-1)*(event.shiftKey?.1:1);
      const transform:NumericPartTransform=handle.kind==='rotation'
        ?{kind:'rotate',axisOriginMillimeters:at,axisDirection:projected.axis,angleDegrees:step*15}
        :{kind:'translate',translationMillimeters:projected.axis.map(v=>v*step) as Point3};
      drag={handle:projected,source:selected.source,ids:selected.ids,pivot:at,start:null,previous:0,angle:0,translation:[0,0,0],transform,originalPivot:pivot};
      void end(false);
    },
    onCopy() { copy=!copy; },
    onResetPivot() { pivot=null; viewer.clearInteractionAnchors(); },
  });
  widget.element.classList.add('cad-selection-manipulator');
  const place=(event:PointerEvent)=>{
    if(!event.shiftKey || event.button!==0 || !(event.target instanceof HTMLCanvasElement) || busy || drag)return;
    const selected=context();if(!selected)return;
    const point=viewer.pickManipulatorPivot(event,pivot??selected.frame.centerMillimeters);
    if(!point)return;
    event.preventDefault();event.stopImmediatePropagation();pivot=point.point;
    options.status(`Pivot placed${point.label?` at ${point.label}`:''}.`);
    viewer.clearInteractionAnchors();
  };
  viewport.addEventListener('pointerdown',place,true);
  const cancel=()=>widget.cancel();
  window.addEventListener('cad-document-navigation',cancel);
  window.addEventListener('aether-feature-preview-start',cancel);
  let raf=0;
  const update=()=>{
    const selected=context();
    if(drag && (!selected || selected.source!==drag.source || selected.ids.join()!==drag.ids.join()))widget.cancel();
    if(!selected && !drag) { widget.update([]); handles=[]; if(!busy){identity='';pivot=null;copy=false;} }
    else {
      const key=selected?JSON.stringify([selected.source.documentId,selected.ids]):identity;
      if(key!==identity&&!drag) {identity=key;pivot=null;copy=false;}
      const at=pivot??drag?.pivot??selected!.frame.centerMillimeters;
      const displayed=drag?.transform?.kind==='translate'?drag.pivot.map((v,i)=>v+(drag!.transform as {translationMillimeters:Point3}).translationMillimeters[i]) as Point3:at;
      handles=viewer.projectSelectionManipulator(displayed);
      const center=handles.find(h=>h.id==='pivot');
      widget.update(handles,{disabled:busy,copy,copyPosition:center?{x:center.x,y:Math.max(...handles.map(h=>h.y))+30}:undefined});
    }
    raf=requestAnimationFrame(update);
  };
  raf=requestAnimationFrame(update);
  return ()=>{cancelAnimationFrame(raf);widget.dispose();viewer.clearManipulatorPreview();viewer.clearInteractionAnchors();viewport.removeEventListener('pointerdown',place,true);window.removeEventListener('cad-document-navigation',cancel);window.removeEventListener('aether-feature-preview-start',cancel);};
}
