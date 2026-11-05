import { matchesProfileRegion, type ProfileRegionSelection } from '@aether/core/sketch/reference/profile-region-reference';
import { sketchRegions } from "@aether/core/document";
import {layoutRegion, regionControls, stampProfileSelections} from './regions';
import {bodyAndOperationTabs, entityChips, iconButton, planned, rowIn, type FeatureEditor, type FeatureEditorContext, type Controls} from './shared';
import {mountSketchPointsBox} from './sketch-points-box';
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
      pathOn:context.field('Path',context.feature?.path?'yes':'no',['no','yes']),
      path:context.reference('Path sketch',['sketch','profile','curve3d'],context.feature?.path?.pathFeatureId),
      connections:context.field('Connection points',JSON.stringify((context.feature?.connections??[]).flat())),
      mergeScope:context.field('Merge scope part',JSON.stringify(context.feature?.targetBodyId?[context.feature.targetBodyId]:availableBodies(context.doc).at(-1)?[availableBodies(context.doc).at(-1)!.id]:[])),
    };
  },
  layout(context, controls) {
    const {win,form} = context;
    bodyAndOperationTabs(win,form,controls.operation,['new','add','cut']);
    const hide=(control:Controls[string])=>{control.closest('label')?.remove();control.hidden=true;control.setAttribute('form',form.id);form.append(control);};
    hide(controls.sections);
    controls.source.closest('label')?.remove();
    controls.source.setAttribute('form',form.id);
    const selection = win.subsection('Profile selection', {kind:'disclosure', open: false});
    const sourceRow = win.row('Section sketch',controls.source);
    layoutRegion(context,controls.source,controls.region);
    selection.body.append(sourceRow, controls.region.closest('.aui-feature-row')!);
    const list = document.createElement('select');
    list.size = 4; list.style.height = 'auto'; list.className = 'aui-feature-method';
    list.setAttribute('aria-label','Loft section order');
    const buttons = document.createElement('span');
    const button = (label: string, action:()=>void, icon?: string) => {
      const element = icon ? iconButton(icon,label) : document.createElement('button');
      element.type = 'button';
      if (!icon) { element.className = 'aui-button'; element.textContent = label; }
      element.setAttribute('aria-label', label); element.onclick = action;
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
    selection.body.append(rowIn('',buttons));
    const profiles = win.entitiesBox('Profiles');
    profiles.element.append(list);
    profiles.element.addEventListener('pointerdown',()=>selection.setOpen(true));
    win.body.insertBefore(profiles.element, selection.element);
    const orderButtons = document.createElement('span');
    const move = (delta: number) => {
      const sections = sectionsOf(controls), index = list.selectedIndex, next = index+delta;
      if (index<0 || next<0 || next>=sections.length) return;
      [sections[index],sections[next]]=[sections[next],sections[index]];
      change(sections,next);
    };
    const up = button('Move up',()=>move(-1),'chevron-up');
    const down = button('Move down',()=>move(1),'chevron-down');
    const remove = button('Remove section',()=>{
      const sections=sectionsOf(controls),index=list.selectedIndex;
      if(index<0)return;
      sections.splice(index,1); change(sections,Math.min(index,sections.length-1));
    },'close');
    orderButtons.append(up,down,remove);
    selection.body.append(rowIn('',orderButtons));
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
      list.size=Math.max(1,Math.min(4,sectionsOf(controls).length));
      list.hidden=sectionsOf(controls).length===0;
      list.selectedIndex=index; sync();
    };
    controls.source.addEventListener('change',sync);
    controls.region.addEventListener('change',sync);
    list.addEventListener('change',sync);
    render(0);
    // Onshape's rows after the profiles (help: PartStudio/loft.htm); this kernel lofts smooth or ruled
    // through closed sections to an optional apex, so these are present and disabled with the gap named.
    const gapRow=(label:string,reason:string)=>{const sel=document.createElement('select');sel.setAttribute('aria-label',label);const o=document.createElement('option');o.textContent='None';sel.append(o);const r=rowIn(label,sel);planned(r,reason);win.body.append(r);return r;};
    const conditionGap='Not available in this kernel: loft end conditions (tangent, match tangent or curvature, with a magnitude) are a recorded gap.';
    const ends = win.subsection('End conditions',{kind:'disclosure',open:true});
    ends.body.append(gapRow('Start profile condition',conditionGap),gapRow('End profile condition',conditionGap));
    const gapSection=(label:string,reason:string,fields:string[])=>{const section=win.subsection(label,{kind:'checkbox',open:false});for(const name of fields){const box=win.entitiesBox(name);box.render([]);section.body.append(box.element);}planned(section.element,reason);win.body.append(section.element);};
    gapSection('Guides and continuity','Not available in this kernel: guide curves with continuity are a recorded gap.',['Guides']);
    // Path: the sections swept along a curve of an earlier sketch.
    for(const key of ['pathOn'])hide(controls[key]);
    const pathSection=win.subsection('Path',{kind:'checkbox',open:controls.pathOn.value==='yes',onToggle:(open)=>{controls.pathOn.value=open?'yes':'no';controls.pathOn.dispatchEvent(new Event('change'));}});
    const pathChips=entityChips(win,'Path',controls.path,form);pathSection.body.append(pathChips.element);win.body.append(pathSection.element);
    // Connections: one sketch point per section, in section order (several sets: N points each).
    const connections=win.subsection('Connections',{kind:'checkbox',open:JSON.parse(controls.connections.value||'[]').length>0,onToggle:(open)=>{if(!open){controls.connections.value='[]';controls.connections.dispatchEvent(new Event('change'));}}});
    const points=mountSketchPointsBox(context,controls.connections,'Vertices to connect');
    connections.body.append(points.element);win.body.append(connections.element);
    const iso=document.createElement('input');iso.type='checkbox';iso.setAttribute('aria-label','Show isocurves');const isoRow=rowIn('Show isocurves',iso);planned(isoRow,'Not available in this kernel: an isocurve overlay is a recorded gap.');win.body.append(isoRow);
    const {doc,feature}=context;
    const end=feature?doc.features.findIndex(f=>f.id===feature.id):doc.rollbackIndex??doc.features.length;
    const scope=mountPartBox(context,controls.mergeScope,'Merge scope',availableBodies({...doc,features:doc.features.slice(0,end),rollbackIndex:undefined}),()=>'',{single:true});
    win.body.append(scope.element);
    controls.mergeScope.addEventListener('change',()=>{const id=JSON.parse(controls.mergeScope.value||'[]')[0];if(id){controls.target.value=id;controls.target.dispatchEvent(new Event('change'));}});
    const more = win.subsection('Aether options',{kind:'disclosure',open:Boolean(controls.endPoint.value)||controls.ruled.value==='ruled'});
    controls.ruled.closest('label')?.remove(); controls.ruled.setAttribute('form',form.id);
    more.body.append(rowIn('Surface interpolation', controls.ruled));
    const apex=extrusionPointPicker(context,controls.endPoint,'Apex (optional)','The loft runs to this point after its last section. A changed or ambiguous vertex requires reselection.');
    more.body.append(apex.element); apex.setEnabled(true);
    const syncScope=()=>{scope.element.hidden=controls.operation.value==='new';};controls.operation.addEventListener('change',syncScope);syncScope();
  },
  validate(controls,context) {
    if (JSON.parse(controls.sections.value).length === 1 && controls.endPoint.value) return null;
    const sections=sectionsOf(controls);
    if (sections.length<2) return 'Add at least two closed sketch sections in loft order.';
    if (sections.some(section=>{const region=regionFor(context,section); return !region || region.closed===false;})) return 'A loft section is unavailable. Remove it and choose a closed sketch region.';
    if (controls.operation.value!=='new' && !JSON.parse(controls.mergeScope.value||'[]').length) return 'Select the merge scope part.';
    if (controls.pathOn.value==='yes'){ if(!controls.path.value) return 'Choose the path sketch.'; if(controls.ruled.value==='ruled'||controls.endPoint.value) return 'A loft along a path is smooth through closed sections, without an apex.'; }
    const connected=JSON.parse(controls.connections.value||'[]').length;
    if (connected && connected % sections.length) return `Connections take one sketch point per section: ${sections.length} points per connection, in section order.`;
    return null;
  },
  serialize(values,context) {
    const sections: Section[]=JSON.parse(values.sections);
    const connected=(JSON.parse(values.connections||'[]') as unknown[]).map((ref)=>serializeExtrusionPoint(JSON.stringify(ref),context));
    const perSet=sections.length,connections=connected.length?Array.from({length:connected.length/perSet},(_,i)=>connected.slice(i*perSet,(i+1)*perSet)):undefined;
    return {operation:values.operation,...(values.operation!=='new'?{targetBodyId:JSON.parse(values.mergeScope||'[]')[0]}:{}),ruled:values.ruled==='ruled',...(values.endPoint?{endPoint:serializeExtrusionPoint(values.endPoint,context)}:{}),...(values.pathOn==='yes'?{path:{pathFeatureId:values.path}}:{}),...(connections?{connections}:{}),sections:stampProfileSelections(context, sections.map(section=>{
      const profile=context.doc.features.find(f=>f.id===section.profileFeatureId);
      const region=regionFor(context,section);
      if (!profile || !region) throw Error('A selected loft section is no longer available.');
      return {featureId:profile.id,contourIndex:region.contourIndex};
    }))};
  },
};
