import { rowIn, unitSuffix, type Controls, type FeatureEditorContext } from './shared';

function fields({field}: FeatureEditorContext, angle: number | undefined, opposite: boolean): Controls {
  const prefix=opposite?'secondDraft':'draft', label=opposite?'Opposite draft':'Draft';
  return {
    [prefix+'Enabled']:field(opposite?'Use opposite draft':'Use extrusion draft',String(Boolean(angle)),['false','true']),
    [prefix+'Angle']:field(`${label} angle (degrees)`,String(Math.abs(angle||3))),
    [prefix+'Reverse']:field(opposite?'Opposite draft widens':'Draft widens',String((angle??0)<0),['false','true']),
  };
}
export function extrudeDraftControls(context: FeatureEditorContext): Controls {
  return {...fields(context,context.feature?.draftAngleDegrees,false),...fields(context,context.feature?.secondEnd?.draftAngleDegrees,true)};
}
export function layoutExtrudeDraft({win,form,angleUnitLabel}: FeatureEditorContext, controls: Controls, opposite=false) {
  const prefix=opposite?'secondDraft':'draft',label=opposite?'Opposite draft':'Draft';
  const enabled=controls[prefix+'Enabled'],angle=controls[prefix+'Angle'],reverseValue=controls[prefix+'Reverse'];
  for(const control of [enabled,reverseValue]){
    control.closest('label')?.remove();control.hidden=true;control.setAttribute('form',form.id);form.append(control);
  }
  const section=win.subsection(label,{kind:'checkbox',open:enabled.value==='true',onToggle:value=>{
    enabled.value=String(value);enabled.dispatchEvent(new Event('change'));
  }});
  angle.closest('label')?.remove();angle.setAttribute('form',form.id);
  section.body.append(rowIn(`${label} angle`,angle,unitSuffix(angleUnitLabel)));
  const reverse=document.createElement('input');reverse.type='checkbox';reverse.setAttribute('aria-label',opposite?'Widen opposite extrusion draft':'Widen extrusion draft');reverse.checked=reverseValue.value==='true';
  reverse.onchange=()=>{reverseValue.value=String(reverse.checked);reverseValue.dispatchEvent(new Event('change'));};
  section.body.append(rowIn('Widen outward',reverse));
  const help=document.createElement('p');help.className='cad-form-note';
  help.textContent='Draft narrows away from the sketch; Widen reverses it. The sketch stays neutral with a starting offset. Each end can have its own draft. Symmetric applies the same draft on both sides. The stopping face must fully terminate the tapered profile.';
  section.body.append(help);return section.element;
}
export function validateExtrudeDraft(controls: Controls): string | null {
  for(const opposite of [false,true]){
    if(opposite && (controls.secondEnabled.value!=='true'||controls.endType.value.startsWith('symmetric')))continue;
    const prefix=opposite?'secondDraft':'draft';
    if(controls[prefix+'Enabled'].value!=='true')continue;
    const control=controls[prefix+'Angle'],text=control.value;
    const angle=text===control.dataset.displayValue?Number(control.dataset.originalValue??text):Number(text)*Number(control.dataset.canonicalFactor??1);
    if(!text.trim()||!Number.isFinite(angle)||angle<=0||angle>=90)return `${opposite?'Opposite draft':'Draft'} angle must be greater than 0 and less than 90 degrees.`;
  }
  return null;
}
export function serializeExtrudeDraft(values: Record<string,string>,opposite=false) {
  const prefix=opposite?'secondDraft':'draft';
  return values[prefix+'Enabled']==='true'?{draftAngleDegrees:Number(values[prefix+'Angle'])*(values[prefix+'Reverse']==='true'?-1:1)}:{};
}
