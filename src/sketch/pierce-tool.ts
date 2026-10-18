import type { PartDocument } from '@aether/core/document';
import { sketchEntities,type SketchDrawing,type SketchEntityRef,type SketchPoint } from '@aether/core/sketch';
import { unitChoice } from '@aether/core/units';
import { documentUnits,subscribeDocumentUnits } from '../document-preferences';
import { sketchNodeLabel } from './point-roles';
import { sketchPierceChoices,type PierceChoice } from '../../freecad-engine/browser/pierce-choices';
import { pierceTargetReference } from '../../freecad-engine/browser/pierce-constraints';
import { pierceBranch } from '../../freecad-engine/browser/pierce-geometry';
import './pierce-tool.css';

/** Document-aware external constraint picker, hosted by the common sketch tool
 * window. Contact markers represent exact plane intersections, not projections. */
export function mountPierceTool(o:{
 parent:HTMLElement;svg:SVGSVGElement;targetId:string;document():PartDocument;drawing():SketchDrawing;
 reveal():void;select(refs:readonly SketchEntityRef[]):void;report(text:string):void;
 apply(target:SketchEntityRef,choice:PierceChoice,hit:number,replaceId?:string):boolean;
}) {
 const box=document.createElement('section');box.className='sketch-pierce-controls';box.hidden=true;o.parent.append(box);
 const title=document.createElement('h3');title.textContent='Pierce';box.append(title);
 const field=(label:string)=>{const row=document.createElement('label'),select=document.createElement('select');row.append(label,select);select.setAttribute('aria-label',label);box.append(row);return select;};
 const target=field('Pierce target'),source=field('Pierce source curve'),intersection=field('Pierce intersection');
 const hint=document.createElement('p');hint.className='aui-muted';box.append(hint);
 const buttons=document.createElement('div');box.append(buttons);
 const button=(label:string,run:()=>void)=>{const b=document.createElement('button');b.type='button';b.className='aui-button';b.textContent=label;b.onclick=run;buttons.append(b);return b;};
 const apply=button('Apply Pierce',()=>applySelected());button('Stop Pierce',()=>cancel());
 let enabled=false,replaceId:string|undefined,selected:SketchEntityRef|undefined,choices:PierceChoice[]=[],fingerprint='',size=2;
 let changed:((active:boolean)=>void)|undefined;
 const option=(select:HTMLSelectElement,value:string,label:string)=>{const n=document.createElement('option');n.value=value;n.textContent=label;select.append(n);};
 const choiceLabel=(c:PierceChoice)=>`${c.sourceName} · ${c.curveType} ${c.contourIndex+1}${c.segmentIndex===undefined?'':`.${c.segmentIndex+1}`}`;
 const coordinate=(p:SketchPoint)=>{const u=unitChoice(documentUnits(),'length');return `${p.map(v=>Number((v*.001/u.factor).toPrecision(8))).join(', ')} ${u.unit}`;};
 const currentChoice=()=>choices.find(c=>c.key===source.value);
 const prompt=()=>!selected?'Pierce: select an editable point, center, control, or curve.':!choices.length?'Pierce: no earlier sketch curve crosses this plane. Choose another plane or repair the source sketch.':'Pierce: choose a source curve and its intersection, or click an exact contact marker. Escape exits.';
 const validTarget=(ref:SketchEntityRef)=>{try{pierceTargetReference(o.drawing(),ref,[0,0]);return true;}catch{return false;}};
 function syncTarget() {
  target.replaceChildren();option(target,'','Choose target');
  for(const item of sketchEntities(o.drawing()))if(validTarget(item.ref))option(target,JSON.stringify(item.ref),sketchNodeLabel(o.drawing(),item.ref,item.label));
  if(selected){const key=JSON.stringify(selected);if(![...target.options].some(x=>x.value===key))option(target,key,'Picked curve contact');target.value=key;}
 }
 function syncIntersections(previous='') {
  intersection.replaceChildren();option(intersection,'','Choose intersection');
  const c=currentChoice();c?.hits.forEach((hit,i)=>option(intersection,String(i),`${i+1}: (${coordinate(hit.point)})${hit.direction===0?' · tangent':''}`));
  if(previous!==''&&c?.hits[Number(previous)])intersection.value=previous;
  else if(c?.hits.length===1)intersection.value='0';
  apply.disabled=!selected||!c||intersection.value==='';hint.textContent=prompt();renderMarkers();
 }
 function refresh(force=false) {
  if(!enabled)return;
  const doc=o.document(),active=doc.features.find(f=>f.id===o.targetId);
  // Source identity/geometry and target plane are stable across pointer moves.
  const key=JSON.stringify([doc.features.filter(f=>f.id!==o.targetId),active&&'plane'in active?[active.plane,'frame'in active?active.frame:undefined,'offsetMillimeters'in active?active.offsetMillimeters:0]:null]);
  const old=source.value,hit=intersection.value;
  if(force||key!==fingerprint){fingerprint=key;choices=sketchPierceChoices(doc.features,o.targetId);source.replaceChildren();option(source,'','Choose source curve');for(const c of choices)option(source,c.key,choiceLabel(c));if(choices.some(c=>c.key===old))source.value=old;else if(choices.length===1)source.value=choices[0].key;}
  syncTarget();syncIntersections(source.value===old?hit:'');
 }
 function begin(initial:readonly SketchEntityRef[]=[]) {
  o.reveal();enabled=true;replaceId=undefined;selected=initial.length===1&&validTarget(initial[0])?structuredClone(initial[0]):undefined;
  box.hidden=false;changed?.(true);refresh(true);o.select(selected?[selected]:[]);o.report(prompt());
 }
 function cancel() {if(!enabled)return;enabled=false;replaceId=undefined;selected=undefined;box.hidden=true;o.svg.querySelector('.sketch-pierce-contacts')?.remove();changed?.(false);o.select([]);}
 function applySelected() {
  const c=currentChoice(),index=Number(intersection.value);
  if(!selected||!c||intersection.value==='')return;
  try {
   const added=o.apply(selected,c,index,replaceId),wasEditing=!!replaceId;
   replaceId=undefined;selected=undefined;o.select([]);refresh();
   o.report(`Pierce ${added?(wasEditing?'updated.':'applied.'):'already exists.'} ${prompt()}`);
  }catch(error){o.report(`${error instanceof Error?error.message:String(error)} ${prompt()}`);}
 }
 function chooseContact(c:PierceChoice,index:number) {source.value=c.key;syncIntersections(String(index));applySelected();}
 function renderMarkers() {
  o.svg.querySelector('.sketch-pierce-contacts')?.remove();if(!enabled||!selected)return;
  const ns='http://www.w3.org/2000/svg',g=document.createElementNS(ns,'g');g.classList.add('sketch-pierce-contacts');o.svg.append(g);
  for(const c of currentChoice()?[currentChoice()!]:choices)for(const [index,hit] of c.hits.entries()) {
   const marker=document.createElementNS(ns,'circle');marker.setAttribute('cx',String(hit.point[0]));marker.setAttribute('cy',String(-hit.point[1]));marker.setAttribute('r',String(size));
   marker.dataset.pierceSource=c.sourceId;marker.dataset.pierceContact=String(index);marker.setAttribute('tabindex','0');marker.setAttribute('role','button');marker.setAttribute('aria-label',`${choiceLabel(c)} · intersection ${index+1} (${coordinate(hit.point)})`);
   // Pointer hits are handled geometrically by the workspace, including its
   // 3D-forwarded events. Keyboard focus selects this explicitly named contact.
   marker.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();chooseContact(c,index);}});
   g.append(marker);
  }
 }
 target.onchange=()=>{selected=target.value?JSON.parse(target.value):undefined;o.select(selected?[selected]:[]);syncIntersections(intersection.value);};
 source.onchange=()=>syncIntersections();intersection.onchange=()=>syncIntersections(intersection.value);
 const disposeUnits=subscribeDocumentUnits(()=>{if(enabled)syncIntersections(intersection.value);});
 return {
  active:()=>enabled,prompt,begin,cancel,refresh,
  sourceLabel(id:string){const relation=o.drawing().constraints?.find(c=>c.id===id);const name=o.document().features.find(f=>f.id===relation?.source?.sourceFeatureId)?.name;return name??'Missing source';},
  onChanged(listener:(active:boolean)=>void){changed=listener;},
  pick(ref:SketchEntityRef|null){if(!enabled)return false;if(!ref){selected=undefined;o.select([]);refresh();o.report(prompt());return true;}if(!validTarget(ref)){o.report('Pierce requires an editable point or finite curve. Choose its actual source intersection afterward.');return true;}selected=structuredClone(ref);o.select([selected]);refresh();o.report(prompt());return true;},
  pickPoint(point:SketchPoint,tolerance:number){
   if(!enabled||!selected)return false;
   const hits=(currentChoice()?[currentChoice()!]:choices).flatMap(c=>c.hits.flatMap((hit,i)=>Math.hypot(hit.point[0]-point[0],hit.point[1]-point[1])<=tolerance?[{c,i}]:[]));
   if(!hits.length)return false;
   if(hits.length>1){o.report('Several source intersections overlap here. Choose the source curve and intersection in Pierce controls.');return true;}
   chooseContact(hits[0].c,hits[0].i);return true;
  },
  edit(id:string){const c=o.drawing().constraints?.find(c=>c.id===id);if(c?.kind!=='pierce')return;begin([c.a]);replaceId=id;const match=choices.find(q=>q.sourceId===c.source?.sourceFeatureId&&q.contourId===c.source?.sourceContourId&&q.segmentId===c.source?.sourceSegmentId);if(match){source.value=match.key;const i=match.hits.findIndex((_,i)=>JSON.stringify(pierceBranch(match.hits,i))===JSON.stringify(c.source!.branch));syncIntersections(i>=0?String(i):'');}else{source.value='';syncIntersections();}o.report('Choose a replacement source intersection for this Pierce constraint.');},
  reset(){if(enabled){replaceId=undefined;selected=undefined;o.select([]);refresh();o.report(prompt());}},
  render(markerSize:number){size=markerSize;renderMarkers();},
  dispose(){cancel();disposeUnits();box.remove();},
 };
}
