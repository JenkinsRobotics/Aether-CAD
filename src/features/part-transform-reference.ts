import {transformEdgePicker} from './transform-edge-picker';
import {identifyProfileContours,type PartTransform,type TransformVectorReference} from '@aether/core/document';
import {sketchDirectionLines} from '../modeling/extrude-direction-reference';
import {extrusionPointPicker,serializeExtrusionPoint} from './extrude-point-picker';
import type {Controls,FeatureEditorContext} from './shared';

export function transformReferenceControls(context:FeatureEditorContext):Controls {
 const {field,feature}=context,t=feature?.transform as PartTransform|undefined;
 const reference=t&&(t.kind==='translate-reference'||t.kind==='rotate-reference')?t.reference:undefined;
 const lines=sketchDirectionLines(context.doc,feature?.id);
 const key=(line:typeof lines[number])=>JSON.stringify({sourceFeatureId:line.sourceFeatureId,contourIndex:line.contourIndex,segmentIndex:line.segmentIndex});
 const referenceMode=field('Transform reference',reference?.kind==='solid-edge'?'edge':reference?.kind==='two-points'?'points':'line',['line','edge','points']);
 for(const option of (referenceMode as HTMLSelectElement).options)option.textContent=option.value==='line'?'Sketch line':option.value==='edge'?'Solid edge':'Two points';
 const selected=lines.find(line=>reference?.kind==='sketch-line'&&line.sourceFeatureId===reference.sourceFeatureId&&line.contourId===reference.contourId&&line.segmentId===reference.segmentId);
 const saved=reference?.kind==='sketch-line'?JSON.stringify(reference):'';
 const line=field('Transform sketch line',selected?key(selected):saved,['',...lines.map(key),...(saved&&!selected?[saved]:[])]);
 for(const option of (line as HTMLSelectElement).options)option.textContent=lines.find(item=>key(item)===option.value)?.label??(option.value?'Unavailable sketch line — reselect':'Choose a straight sketch line');
 return{referenceMode,referenceLine:line,referenceEdge:field('Transform edge reference',reference?.kind==='solid-edge'?JSON.stringify(reference):''),
  fromPoint:field('From point reference',reference?.kind==='two-points'?JSON.stringify(reference.from):''),toPoint:field('To point reference',reference?.kind==='two-points'?JSON.stringify(reference.to):''),
  centerPoint:field('Scale center reference',t?.kind==='scale-reference'?JSON.stringify(t.centerReference):''),
  useDistance:field('Specify distance',t?.kind==='translate-reference'&&t.distanceMillimeters!==undefined?'yes':'no',['no','yes']),distance:field('Translation distance (mm)',String(t?.kind==='translate-reference'?t.distanceMillimeters??10:10)),
  reverseReference:field('Reverse reference direction',t?.kind==='translate-reference'&&t.reversed?'yes':'no',['no','yes'])};
}
export const transformReferenceKeys=['referenceEdge','referenceMode','referenceLine','fromPoint','toPoint','centerPoint','useDistance','distance','reverseReference'];
export function layoutTransformReferences(context:FeatureEditorContext,c:Controls) {
 const edge=transformEdgePicker(context,c.referenceEdge);
 const note='Follows this earlier sketch point or solid vertex. Changed or ambiguous vertices require reselection.';
 const from=extrusionPointPicker(context,c.fromPoint,'Transform from point',note),to=extrusionPointPicker(context,c.toPoint,'Transform to point',note),center=extrusionPointPicker(context,c.centerPoint,'Scale about point',note);
 const row=(key:string)=>c[key].closest<HTMLElement>('.aui-feature-row')??c[key].parentElement;
 const render=()=>{
  const vector=c.mode.value==='translate-reference'||c.mode.value==='rotate-reference',move=c.mode.value==='translate-reference';
  for(const key of ['referenceMode','referenceLine','useDistance','distance','reverseReference']){
   const show=key==='referenceMode'?vector:key==='referenceLine'?vector&&c.referenceMode.value==='line':key==='distance'?move&&c.useDistance.value==='yes':move;
   const el=row(key);if(el)el.hidden=!show;
  }
  edge.setEnabled(vector&&c.referenceMode.value==='edge');
  from.setEnabled(vector&&c.referenceMode.value==='points');to.setEnabled(vector&&c.referenceMode.value==='points');center.setEnabled(c.mode.value==='scale-reference');
 };
 c.mode.addEventListener('change',render);c.referenceMode.addEventListener('change',render);c.useDistance.addEventListener('change',render);render();
}
export function validateTransformReferences(c:Controls):string|null {
 const mode=c.mode.value;
 if(mode==='scale-reference')return c.centerPoint.value?null:'Select a scale center point.';
 if(mode!=='translate-reference'&&mode!=='rotate-reference')return null;
 if(c.referenceMode.value==='edge'&&!c.referenceEdge.value)return 'Select a straight edge on an earlier solid part.';
 if(c.referenceMode.value==='line'&&!c.referenceLine.value)return 'Choose a straight line in an earlier sketch.';
 if(c.referenceMode.value==='points'&&(!c.fromPoint.value||!c.toPoint.value))return 'Choose the ordered From and To points.';
 if(mode==='translate-reference'&&c.useDistance.value==='yes'&&(!c.distance.value.trim()||!Number.isFinite(Number(c.distance.value))))return 'Enter a finite translation distance.';
 return null;
}
export function serializeTransformReference(v:Record<string,string>,context:FeatureEditorContext):TransformVectorReference {
 if(v.referenceMode==='edge')return JSON.parse(v.referenceEdge);
 if(v.referenceMode==='points')return{kind:'two-points',from:serializeExtrusionPoint(v.fromPoint,context),to:serializeExtrusionPoint(v.toPoint,context)};
 const choice=JSON.parse(v.referenceLine);
 if(choice.kind==='sketch-line')return choice;
 context.doc.features=identifyProfileContours(context.doc,choice.sourceFeatureId).features;
 const line=sketchDirectionLines(context.doc,context.feature?.id).find(line=>line.sourceFeatureId===choice.sourceFeatureId&&line.contourIndex===choice.contourIndex&&line.segmentIndex===choice.segmentIndex);
 if(!line?.contourId||!line.segmentId)throw Error('Reselect the transform sketch line.');
 return{kind:'sketch-line',sourceFeatureId:line.sourceFeatureId,contourId:line.contourId,segmentId:line.segmentId};
}
