import {mountExtrusionHandle} from './extrude-depth-drag';
import {planarFacePicker} from './planar-face-picker';
import type {FeatureEditor} from './shared';

/** Native face footprint extrusion; references never persist transient FaceN indices. */
export const faceExtrudeEditor: FeatureEditor = {
 type:'face-extrude',
 controls({field,feature}) {
  return {
   face:field('Planar face',feature ? JSON.stringify({sourceFeatureId:feature.sourceFeatureId,bodyId:feature.targetBodyId,normal:feature.normal,label:feature.faceLabel,...(feature.faceAnchor?{faceAnchor:feature.faceAnchor}:{})}) : ''),
   distance:field('Distance (mm)',String(feature?.distanceMillimeters??5)),
  };
 },
 layout(context,controls) {
  const {win,feature}=context;controls.target.disabled=true;
  const picker=planarFacePicker(context,controls.face,'Planar face to push or pull',reference=>{
   if(![...(controls.target as HTMLSelectElement).options].some(o=>o.value===reference.bodyId))return 'Select a face on an earlier body.';
   controls.target.value=reference.bodyId;return null;
  });
  picker.setEnabled(true);
  const note=document.createElement('p');note.className='cad-form-note';note.textContent='Positive extends the face footprint; negative removes material. Use Change face to reselect on the earlier geometry. Curved-face offsets and general face translation are not supported.';win.body.append(note);
  mountExtrusionHandle(win.panel,controls,context.lengthUnitLabel,(depth,respond)=>{
   const face=picker.read();if(!face||!Number.isFinite(depth)){respond(null);return;}
   window.dispatchEvent(new CustomEvent('aether-face-extrusion-handle',{detail:{bodyId:face.bodyId,normal:face.normal,faceAnchor:face.faceAnchor,depth,respond}}));
  });
  if(!feature)queueMicrotask(picker.request);
 },
 validate(controls) {
  if(!controls.face.value)return 'Select a planar face.';
  const face=JSON.parse(controls.face.value);
  if(face.bodyId!==controls.target.value)return 'Reselect the face on its target body.';
  if(!controls.distance.value.trim()||!Number.isFinite(Number(controls.distance.value))||Number(controls.distance.value)===0)return 'Enter a finite nonzero distance.';
  return null;
 },
 serialize(values) {
  const face=JSON.parse(values.face);
  return {sourceFeatureId:face.sourceFeatureId,targetBodyId:face.bodyId,normal:face.normal,...(face.faceAnchor?{faceAnchor:face.faceAnchor}:{}),faceLabel:face.label,distanceMillimeters:Number(values.distance)};
 },
};
