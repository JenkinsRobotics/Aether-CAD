import { matchesProfileRegion, type ProfileRegionSelection } from '../../freecad-engine/browser/profile-region-reference';
import {sketchRegions} from '../freecad-translate';
import {layoutRegion, regionControls, stampProfileSelections} from './regions';
import {bodyAndOperationTabs, type FeatureEditor, type FeatureEditorContext, type Controls} from './shared';

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
    };
  },
  layout(context, controls) {
    const {win,form} = context;
    bodyAndOperationTabs(win,form,controls.operation,['new','add','cut']);
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
  },
  validate(controls,context) {
    const sections=sectionsOf(controls);
    if (sections.length<2) return 'Add at least two closed sketch sections in loft order.';
    if (sections.some(section=>{const region=regionFor(context,section); return !region || region.closed===false;})) return 'A loft section is unavailable. Remove it and choose a closed sketch region.';
    if (controls.operation.value!=='new' && !controls.target?.value) return 'Select a target body for the loft.';
    return null;
  },
  serialize(values,context) {
    const sections: Section[]=JSON.parse(values.sections);
    return {operation:values.operation,ruled:values.ruled==='ruled',sections:stampProfileSelections(context, sections.map(section=>{
      const profile=context.doc.features.find(f=>f.id===section.profileFeatureId);
      const region=regionFor(context,section);
      if (!profile || !region) throw Error('A selected loft section is no longer available.');
      return {featureId:profile.id,contourIndex:region.contourIndex};
    }))};
  },
};
