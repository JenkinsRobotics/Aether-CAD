import { matchesProfileRegion, type ProfileRegionSelection } from '@aether/core/sketch/reference/profile-region-reference';
import { sketchRegions } from "@aether/core/document";
import {layoutRegion, regionControls, stampProfileSelections} from './regions';
import {bodyAndOperationTabs, planned, rowIn, type FeatureEditor, type FeatureEditorContext, type Controls} from './shared';
import {availableBodies} from '@aether/core/document';
import {mountPartBox} from './part-box';
import {extrusionPointPicker, serializeExtrusionPoint} from './extrude-point-picker';

type Section = {profileFeatureId: string; contourIndex: number} & ProfileRegionSelection;
const sectionsOf = (controls: Controls): Section[] => JSON.parse(controls.sections.value);
const regionFor = (context: FeatureEditorContext, section: Section) => {
  const profile = context.doc.features.find(f => f.id === section.profileFeatureId);
  return profile && sketchRegions(profile, false, context.doc.features).find(r => section.profileContourId || section.profileRegion ? matchesProfileRegion(section, r) : r.contourIndex === section.contourIndex);
};

export const loftEditor: FeatureEditor = {
  type: 'loft',
  controls(context) {
    const source = context.reference('Section sketch', ['profile','sketch']);
    const sections: Section[] = (context.feature?.sections ?? []).map((s: Section) => {
      const profile = context.doc.features.find(f=>f.id === s.profileFeatureId);
      const regions = profile ? sketchRegions(profile, false, context.doc.features) : [];
      return {...s, contourIndex:(s.profileContourId || s.profileRegion ? regions.find(r=>matchesProfileRegion(s,r)) : regions.length===1 ? regions[0] : undefined)?.contourIndex ?? -1};
    });
    return {
      source, region:regionControls(context,source),
      sections:context.field('Sections',JSON.stringify(sections)),
      operation:context.field('Operation',context.feature?.operation ?? 'new',['new','add','cut']),
      ruled:context.field('Surface',context.feature?.ruled ? 'ruled' : 'smooth',['smooth','ruled']),
      endPoint:context.field('Apex',context.feature?.endPoint&&context.feature.endPoint.kind!=='point'?JSON.stringify(context.feature.endPoint):''),
      mergeScope:context.field('Merge scope part',JSON.stringify(context.feature?.targetBodyId?[context.feature.targetBodyId]:availableBodies(context.doc).at(-1)?[availableBodies(context.doc).at(-1)!.id]:[])),
    };
  },
  layout(context, controls) {
    const {win,form} = context;
    bodyAndOperationTabs(win,form,controls.operation,['new','add','cut']);
    const apex=extrusionPointPicker(context,controls.endPoint,'Apex (optional)','The loft runs to this point after its last section. A changed or ambiguous vertex requires reselection.');apex.setEnabled(true);
    controls.sections.closest('label')?.remove();
    controls.sections.hidden = true;
    controls.sections.setAttribute('form',form.id);
    form.append(controls.sections);
    controls.source.closest('label')?.remove();
    controls.source.setAttribute('form',form.id);
    win.row('Section sketch',controls.source);
    layoutRegion(context,controls.source,controls.region);
    const list = document.createElement('select');
    list.size = 4; list.style.height = 'auto'; list.className = 'aui-feature-method';
    list.setAttribute('aria-label','Loft section order');
    const buttons = document.createElement('span');
    const button = (label: string, action:()=>void) => {
      const element = document.createElement('button');
      element.type = 'button'; element.className = 'aui-button'; element.textContent = label; element.setAttribute('aria-label', label); element.onclick = action;
      buttons.append(element); return element;
    };
    const change = (sections: Section[], index: number) => {
      controls.sections.value = JSON.stringify(sections);
      render(index);
      controls.sections.dispatchEvent(new Event('change'));
    };
    const add = button('Add section', () => {
      const profile = context.doc.features.find(f=>f.id===controls.source.value);
      const region = profile && sketchRegions(profile, false, context.doc.features).find(r=>String(r.contourIndex)===controls.region.value);
      if (!region || region.closed === false) return;
      const sections = sectionsOf(controls);
      if (sections.some(s=>s.profileFeatureId===profile!.id && s.contourIndex===region.contourIndex)) return;
      sections.push({profileFeatureId:profile!.id,profileContourId:region.contourId,contourIndex:region.contourIndex});
      change(sections,sections.length-1);
    });
    win.row('',buttons);
    win.entitiesBox('Sections in order').element.append(list);
    const orderButtons = document.createElement('span');
    const move = (delta: number) => {
      const sections = sectionsOf(controls), index = list.selectedIndex, next = index+delta;
      if (index<0 || next<0 || next>=sections.length) return;
      [sections[index],sections[next]]=[sections[next],sections[index]];
      change(sections,next);
    };
    const up = button('Move up',()=>move(-1));
    const down = button('Move down',()=>move(1));
    const remove = button('Remove section',()=>{
      const sections=sectionsOf(controls),index=list.selectedIndex;
      if(index<0)return;
      sections.splice(index,1); change(sections,Math.min(index,sections.length-1));
    });
    remove.textContent = 'Remove';
    orderButtons.append(up,down,remove);
    win.row('',orderButtons);
    const sync = () => {
      const sections=sectionsOf(controls),index=list.selectedIndex;
      const profile=context.doc.features.find(f=>f.id===controls.source.value);
      const region=profile && sketchRegions(profile, false, context.doc.features).find(r=>String(r.contourIndex)===controls.region.value);
      add.disabled=!region || region.closed === false || sections.some(s=>s.profileFeatureId===controls.source.value && s.contourIndex===region.contourIndex);
      up.disabled=index<=0; down.disabled=index<0 || index>=sections.length-1; remove.disabled=index<0;
    };
    const render = (index: number) => {
      list.replaceChildren();
      sectionsOf(controls).forEach((section,index)=>{
        const option=document.createElement('option');
        const profile=context.doc.features.find(f=>f.id===section.profileFeatureId),region=regionFor(context,section);
        option.value=String(index); option.textContent=`${index+1}. ${profile?.name ?? 'Missing sketch'} · ${region?.label ?? 'Missing region'}`;
        list.append(option);
      });
      list.selectedIndex=index; sync();
    };
    controls.source.addEventListener('change',sync);
    controls.region.addEventListener('change',sync);
    list.addEventListener('change',sync);
    render(0);
    // Onshape's rows after the profiles (help: PartStudio/loft.htm); this kernel lofts smooth or ruled
    // through closed sections to an optional apex, so these are present and disabled with the gap named.
    const gapRow=(label:string,reason:string)=>{const sel=document.createElement('select');sel.setAttribute('aria-label',label);const o=document.createElement('option');o.textContent='Normal to profile';sel.append(o);const r=rowIn(label,sel);planned(r,reason);win.body.append(r);return r;};
    const conditionGap='Not available in this kernel: loft end conditions (tangent, match tangent or curvature, with a magnitude) are a recorded gap.';
    gapRow('Start profile condition',conditionGap);gapRow('End profile condition',conditionGap);
    const gapSection=(label:string,reason:string,fields:string[])=>{const section=win.subsection(label,{kind:'checkbox',open:false});for(const name of fields){const box=win.entitiesBox(name);box.render([]);section.body.append(box.element);}planned(section.element,reason);win.body.append(section.element);};
    gapSection('Guides and continuity','Not available in this kernel: guide curves with continuity are a recorded gap.',['Guides']);
    gapSection('Path','Not available in this kernel: a centreline path with a section count is a recorded gap.',['Path']);
    gapSection('Connections','Not available in this kernel: vertex or edge connections between profiles are a recorded gap.',['Vertices or edges']);
    const iso=document.createElement('input');iso.type='checkbox';iso.setAttribute('aria-label','Show isocurves');const isoRow=rowIn('Show isocurves',iso);planned(isoRow,'Not available in this kernel: an isocurve overlay is a recorded gap.');win.body.append(isoRow);
    const {doc,feature}=context;
    const end=feature?doc.features.findIndex(f=>f.id===feature.id):doc.rollbackIndex??doc.features.length;
    const scope=mountPartBox(context,controls.mergeScope,'Merge scope',availableBodies({...doc,features:doc.features.slice(0,end),rollbackIndex:undefined}),()=>'',{single:true});
    win.body.append(scope.element);
    controls.mergeScope.addEventListener('change',()=>{const id=JSON.parse(controls.mergeScope.value||'[]')[0];if(id){controls.target.value=id;controls.target.dispatchEvent(new Event('change'));}});
    const syncScope=()=>{scope.element.hidden=controls.operation.value==='new';};controls.operation.addEventListener('change',syncScope);syncScope();
  },
  validate(controls,context) {
    if (JSON.parse(controls.sections.value).length === 1 && controls.endPoint.value) return null;
    const sections=sectionsOf(controls);
    if (sections.length<2) return 'Add at least two closed sketch sections in loft order.';
    if (sections.some(section=>{const region=regionFor(context,section); return !region || region.closed===false;})) return 'A loft section is unavailable. Remove it and choose a closed sketch region.';
    if (controls.operation.value!=='new' && !JSON.parse(controls.mergeScope.value||'[]').length) return 'Select the merge scope part.';
    return null;
  },
  serialize(values,context) {
    const sections: Section[]=JSON.parse(values.sections);
    return {operation:values.operation,...(values.operation!=='new'?{targetBodyId:JSON.parse(values.mergeScope||'[]')[0]}:{}),ruled:values.ruled==='ruled',...(values.endPoint?{endPoint:serializeExtrusionPoint(values.endPoint,context)}:{}),sections:stampProfileSelections(context, sections.map(section=>{
      const profile=context.doc.features.find(f=>f.id===section.profileFeatureId);
      const region=regionFor(context,section);
      if (!profile || !region) throw Error('A selected loft section is no longer available.');
      return {featureId:profile.id,contourIndex:region.contourIndex};
    }))};
  },
};
