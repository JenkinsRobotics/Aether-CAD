/** Linear and Circular pattern, as Onshape's (help: PartStudio/linear_pattern.htm,
 *  circular_pattern.htm): Part / Feature / Face pattern type, the New / Add / Remove / Intersect
 *  result, Entities to pattern, then for Linear the Direction box and flip, Distance, Instance
 *  count, Centered and the Second direction; for Circular the Axis of pattern box and flip, Angle,
 *  Instance count, Equal spacing and Centered; then Skip instances, Reapply features and Merge
 *  scope. A feature pattern repeats its feature's own result; a part pattern makes new parts, or
 *  adds, removes or intersects its copies with the merge scope part. The direction (or axis) comes
 *  from the principal axes, a picked straight edge or a picked face (planar for a direction,
 *  cylindrical or conical for an axis). Skip instances takes instance numbers. Face patterns and
 *  Reapply features are present and disabled with the gap named (ledger: Patterns). The curve
 *  pattern keeps its path rows under the Curve tab. */
import {mountPartBox} from './part-box';
import {patternSourceTypes,availableBodies} from '@aether/core/document';
import {mountPlaneBox} from './plane-box';
import {requireSelections,layoutParameterRows,entityChips,planned,iconButton,rowIn,checkRow,type Controls,type FeatureEditor,type FeatureEditorContext} from './shared';
import {transformEdgePicker} from './transform-edge-picker';

const faceGap='Not available in this kernel: patterning faces of a part is a recorded gap (pattern the feature or the part).';
const resultGap='A feature pattern repeats its feature\'s own result (add or remove), as Onshape\'s; Add, Remove and Intersect apply to part patterns.';
const reapplyGap='Not available in this kernel: regenerating each instance\'s feature references is a recorded gap.';

export const patternEditor:FeatureEditor={
  type:'pattern',
  controls({field,reference,feature,doc}:FeatureEditorContext):Controls {
    const end=feature?doc.features.findIndex(f=>f.id===feature.id):doc.rollbackIndex??doc.features.length;
    const choices=availableBodies({...doc,features:doc.features.slice(0,end),rollbackIndex:undefined});
    const linear=feature?.patternType==='linear'?feature:undefined,polar=feature?.patternType==='polar'?feature:undefined,path=feature?.patternType==='path'?feature:undefined;
    const dir=linear?.direction,second=linear?.second,axisRef=polar?.axisReference;
    const vec=(v:readonly number[]|undefined,i:number,fallback=0)=>String(v?.[i]??fallback);
    return {
      what:field('Pattern',feature?.bodyIds?'parts':'feature',['feature','parts']),
      parts:field('Parts to pattern',JSON.stringify(feature?.bodyIds??[])),
      partNames:field('Part names',JSON.stringify(choices)),
      copyPrefix:field('Copy ID prefix',feature?.copyBodyIds?String(Object.values(feature.copyBodyIds as Record<string,string>)[0]??'').replace(/-\d+$/,''):`${doc.documentId}:pattern-${crypto.randomUUID()}`),
      source:reference('Source feature',[...patternSourceTypes],feature?.sourceFeatureId),
      patternType:field('Pattern type',feature?.patternType ?? 'linear',['linear','polar','path']),
      pathSketch:reference('Path sketch',['sketch','profile','curve3d'],path?.pathFeatureId),
      pathMode:field('Path spacing by',path?.distanceMillimeters!==undefined?'distance':'spacing',['spacing','distance']),
      pathSpacing:field('Spacing along path (mm)',String(path?.spacingMillimeters ?? 10)),
      pathDistance:field('Overall distance (mm)',String(path?.distanceMillimeters ?? 30)),
      pathOrientation:field('Orientation',path?.orientation ?? 'identical',['identical','path']),
      directionSource:field('Direction source',dir?.kind==='vector'?'vector':dir?.kind==='solid-edge'||axisRef?.kind==='solid-edge'?'edge':dir?.kind==='face'||axisRef?.kind==='face'?'face':'axis',['axis','vector','edge','face']),
      directionFace:field('Direction face',dir&&dir.kind!=='vector'&&dir.kind!=='solid-edge'?JSON.stringify(dir):axisRef?.kind==='face'?JSON.stringify(axisRef):''),
      result:field('Result',feature?.resultOperation??'new',['new','add','cut','intersect']),
      skip:field('Skipped instances',(feature?.skipInstances??[]).join(', ')),
      axis:field('Axis',feature?.axis ?? 'X',['X','Y','Z']),
      vectorX:field('Direction X',vec(dir?.kind==='vector'?dir.direction:undefined,0,1)),vectorY:field('Direction Y',vec(dir?.kind==='vector'?dir.direction:undefined,1)),vectorZ:field('Direction Z',vec(dir?.kind==='vector'?dir.direction:undefined,2)),
      edge:field('Direction edge',JSON.stringify(dir?.kind==='solid-edge'?dir:axisRef?.kind==='solid-edge'?axisRef:'')),
      count:field('Instance count',String(feature?.count ?? 3)),
      spacing:field('Distance (mm)',String(linear?.spacingMillimeters ?? 10)),
      angle:field('Angle (degrees)',String(polar?.angleDegrees ?? 360)),
      equalSpacing:field('Equal spacing','true',['false','true']),
      direction:field('Direction',feature?.reversed ? 'reverse' : 'normal',['normal','reverse']),
      centered:field('Centered',feature?.alignment==='center'?'true':'false',['false','true']),
      useSecond:field('Second direction',second?'yes':'no',['no','yes']),
      secondAxis:field('Second axis',second?.axis ?? 'Y',['X','Y','Z']),
      secondCount:field('Second instance count',String(second?.count ?? 2)),
      secondSpacing:field('Second distance (mm)',String(second?.spacingMillimeters ?? 10)),
      secondDirection:field('Second direction sense',second?.reversed?'reverse':'normal',['normal','reverse']),
      secondCentered:field('Second centered',second?.alignment==='center'?'true':'false',['false','true']),
      mergeScope:field('Merge scope part',JSON.stringify(feature?.targetBodyId?[feature.targetBodyId]:choices.at(-1)?[choices.at(-1)!.id]:[])),
    };
  },
  layout(context:FeatureEditorContext,controls:Controls) {
    const {win,form,lengthUnitLabel,angleUnitLabel}=context;
    const rows=layoutParameterRows(context,control=>![controls.pathSketch,controls.pathMode,controls.pathSpacing,controls.pathDistance,controls.pathOrientation,controls.axis,controls.vectorX,controls.vectorY,controls.vectorZ].includes(control));
    const hide=(control:Controls[string])=>{control.closest('label')?.remove();control.hidden=true;control.setAttribute('form',form.id);form.append(control);};
    for(const key of ['what','parts','partNames','copyPrefix','source','patternType','edge','count','spacing','angle','equalSpacing','direction','centered','useSecond','secondAxis','secondCount','secondSpacing','secondDirection','secondCentered','mergeScope','directionSource','result','skip'])hide(controls[key]);
    const row=(label:string,control:Controls[string],unit?:string)=>{control.closest('label')?.remove();control.setAttribute('form',form.id);const r=unit?rowIn(label,control,Object.assign(document.createElement('span'),{className:'aui-feature-unit',textContent:unit})):rowIn(label,control);win.body.append(r);return r;};
    const check=(control:Controls[string],label:string)=>checkRow(context,control,label);
    // Pattern type: Linear / Circular / Curve as the window's first tabs (Onshape opens them as three tools).
    const kinds=win.tabs(['Linear','Circular','Curve'],['linear','polar','path'].indexOf(controls.patternType.value));
    [...kinds.children].forEach((tab,index)=>{(tab as HTMLButtonElement).onclick=()=>{controls.patternType.value=['linear','polar','path'][index];if(controls.patternType.value==='polar'&&controls.directionSource.value==='vector')controls.directionSource.value='axis';[...kinds.children].forEach((o,i)=>o.classList.toggle('active',i===index));sync();controls.patternType.dispatchEvent(new Event('change'));};});
    // Part / Feature / Face, then the result.
    const whats=win.tabs(['Part','Feature','Face'],controls.what.value==='parts'?0:1);
    [...whats.children].forEach((tab,index)=>{if(index===2){planned(tab as HTMLButtonElement,faceGap);return;}(tab as HTMLButtonElement).onclick=()=>{controls.what.value=index===0?'parts':'feature';[...whats.children].forEach((o,i)=>o.classList.toggle('active',i===index));sync();controls.what.dispatchEvent(new Event('change'));};});
    const resultValues=['new','add','cut','intersect'];
    const results=win.tabs(['New','Add','Remove','Intersect'],Math.max(0,resultValues.indexOf(controls.result.value)));
    [...results.children].forEach((tab,index)=>{(tab as HTMLButtonElement).onclick=()=>{if(controls.what.value!=='parts')return;controls.result.value=resultValues[index];[...results.children].forEach((o,i)=>o.classList.toggle('active',i===index));sync();controls.result.dispatchEvent(new Event('change'));};});
    win.body.append(kinds,whats,results);
    // Entities to pattern: parts picked in the viewport, or the feature from the list.
    const choices=JSON.parse(controls.partNames.value) as {id:string;name:string}[];
    const box=mountPartBox(context,controls.parts,'Entities to pattern',choices);
    win.body.append(box.element);
    const sourceRow=row('Entities to pattern',controls.source);
    // Direction / Axis of pattern: a list of the principal axes, or a solid edge picked in the viewport, with the flip.
    const directionRow=row('Direction',controls.axis);
    const flip=iconButton('flip-horizontal','Opposite direction');
    const paintFlip=()=>flip.setAttribute('aria-pressed',String(controls.direction.value==='reverse'));
    flip.onclick=()=>{controls.direction.value=controls.direction.value==='reverse'?'normal':'reverse';paintFlip();controls.direction.dispatchEvent(new Event('change'));};
    paintFlip();directionRow.querySelector('.aui-feature-row-control')?.append(flip);
    const edgePicker=transformEdgePicker(context,controls.edge);
    controls.edge.addEventListener('change',()=>{if(controls.edge.value){controls.directionSource.value='edge';controls.directionSource.dispatchEvent(new Event('change'));}});
    // A picked face: a planar face's normal is a direction; a cylindrical or conical face's axis is the axis of pattern.
    // A picked plane, Plane feature, face or sketch line: a plane's normal (or a line) is the direction; a cylindrical or conical face's axis is the axis of pattern.
    const faces=mountPlaneBox(context,controls.directionFace,'Direction face',{sketchLines:true,anyFace:true});
    controls.directionFace.addEventListener('change',()=>{if(controls.directionFace.value){controls.directionSource.value='face';controls.directionSource.dispatchEvent(new Event('change'));}});
    edgePicker.element.after(faces.element);
    controls.axis.addEventListener('change',()=>{if(controls.directionSource.value==='edge'&&!controls.edge.value)return;if(controls.directionSource.value==='face'&&!controls.directionFace.value)return;if(controls.directionSource.value!=='vector'){controls.directionSource.value='axis';controls.directionSource.dispatchEvent(new Event('change'));}});
    const spacingRow=row('Distance',controls.spacing,lengthUnitLabel);
    const angleRow=row('Angle',controls.angle,angleUnitLabel);
    row('Instance count',controls.count);
    const equalRow=check(controls.equalSpacing,'Equal spacing');
    check(controls.centered,'Centered');
    // Second direction (Linear).
    const second=win.subsection('Second direction',{kind:'checkbox',open:controls.useSecond.value==='yes',onToggle:(open)=>{controls.useSecond.value=open?'yes':'no';sync();controls.useSecond.dispatchEvent(new Event('change'));}});
    const into=(label:string,control:Controls[string],unit?:string)=>{control.closest('label')?.remove();control.setAttribute('form',form.id);const r=unit?rowIn(label,control,Object.assign(document.createElement('span'),{className:'aui-feature-unit',textContent:unit})):rowIn(label,control);second.body.append(r);return r;};
    const secondDirection=into('Direction',controls.secondAxis);
    const secondFlip=iconButton('flip-horizontal','Opposite direction');
    const paintSecond=()=>secondFlip.setAttribute('aria-pressed',String(controls.secondDirection.value==='reverse'));
    secondFlip.onclick=()=>{controls.secondDirection.value=controls.secondDirection.value==='reverse'?'normal':'reverse';paintSecond();controls.secondDirection.dispatchEvent(new Event('change'));};
    paintSecond();secondDirection.querySelector('.aui-feature-row-control')?.append(secondFlip);
    into('Distance',controls.secondSpacing,lengthUnitLabel);into('Instance count',controls.secondCount);
    const secondCentered=document.createElement('input');secondCentered.type='checkbox';secondCentered.setAttribute('aria-label','Second centered');secondCentered.checked=controls.secondCentered.value==='true';
    secondCentered.onchange=()=>{controls.secondCentered.value=String(secondCentered.checked);controls.secondCentered.dispatchEvent(new Event('change'));};
    second.body.append(rowIn('Centered',secondCentered));
    win.body.append(second.element);
    // Skip instances: instance numbers (2…n in placement order; 1 is the original). Reapply features is a gap, present and named.
    const skip=win.subsection('Skip instances',{kind:'checkbox',open:Boolean(controls.skip.value.trim()),onToggle:(open)=>{if(!open){controls.skip.value='';controls.skip.dispatchEvent(new Event('change'));}}});
    controls.skip.closest('label')?.remove();controls.skip.setAttribute('form',form.id);(controls.skip as HTMLInputElement).placeholder='2, 4';skip.body.append(rowIn('Skipped instances',controls.skip));win.body.append(skip.element);
    const reapply=document.createElement('input');reapply.type='checkbox';reapply.setAttribute('aria-label','Reapply features');const reapplyRow=rowIn('Reapply features',reapply);planned(reapplyRow,reapplyGap);win.body.append(reapplyRow);
    // Merge scope: the part a feature pattern modifies.
    const scope=mountPartBox(context,controls.mergeScope,'Merge scope',choices,()=>'',{single:true});
    win.body.append(scope.element);
    controls.mergeScope.addEventListener('change',()=>{const id=JSON.parse(controls.mergeScope.value||'[]')[0];if(id){controls.target.value=id;controls.target.dispatchEvent(new Event('change'));}});
    // Curve pattern rows stay as they were, under the Curve tab; the vector direction stays under Aether options.
    const curve=document.createElement('div');win.body.append(curve);
    const pathBox=entityChips(win,'Path sketch',controls.pathSketch,form);curve.append(pathBox.element);
    for(const key of ['pathMode','pathSpacing','pathDistance','pathOrientation'])if(rows.get(controls[key]))curve.append(rows.get(controls[key])!);
    const more=win.subsection('Aether options',{kind:'disclosure',open:false});
    const vectorRows=['vectorX','vectorY','vectorZ'].map(key=>{const r=rows.get(controls[key])!;more.body.append(r);return r;});
    const useVector=document.createElement('input');useVector.type='checkbox';useVector.setAttribute('aria-label','Direction by vector');useVector.checked=controls.directionSource.value==='vector';
    useVector.onchange=()=>{controls.directionSource.value=useVector.checked?'vector':'axis';sync();controls.directionSource.dispatchEvent(new Event('change'));};
    more.body.prepend(rowIn('Direction by vector',useVector));
    win.body.append(more.element);
    const sync=()=>{
      const linear=controls.patternType.value==='linear',polar=controls.patternType.value==='polar',isPath=controls.patternType.value==='path',parts=controls.what.value==='parts',source=controls.directionSource.value;
      box.element.hidden=!parts;sourceRow.hidden=parts;
      // A feature pattern has Onshape's one result (its feature's own); the other tabs apply to parts.
      if(!parts)controls.result.value='new';
      [...results.children].forEach((tab,i)=>{tab.classList.toggle('active',i===resultValues.indexOf(controls.result.value));if(i>0)planned(tab as HTMLButtonElement,resultGap);if(parts&&i>0){tab.removeAttribute('disabled');tab.removeAttribute('aria-disabled');tab.removeAttribute('title');}});
      faces.element.hidden=isPath;const caption=faces.element.querySelector('.aui-feature-entities-caption');if(caption)caption.textContent=polar?'Axis face (cylindrical)':'Direction (plane, face or line)';
      scope.element.hidden=parts?controls.result.value==='new':false;
      directionRow.hidden=isPath;directionRow.querySelector('span')!.textContent=polar?'Axis of pattern':'Direction';
      spacingRow.hidden=!linear;angleRow.hidden=!polar;equalRow.hidden=!polar;
      second.element.hidden=!linear;
      curve.hidden=!isPath;
      for(const r of vectorRows)r.hidden=!linear||source!=='vector';
      edgePicker.setEnabled(!isPath);
      (controls.axis as HTMLSelectElement).disabled=source==='vector';
    };
    for(const key of ['directionSource','useSecond','what','pathMode'])controls[key].addEventListener('change',sync);
    sync();
  },
  validate(controls) {
    const parts=controls.what.value==='parts';
    if(parts&&!JSON.parse(controls.parts.value||'[]').length)return 'Select the parts to pattern.';
    if(!(Number(controls.count.value)>=2))return 'Enter an instance count of at least 2.';
    if(controls.patternType.value==='path'){if(!controls.pathSketch.value)return 'Choose the path sketch.';if(controls.pathMode.value==='spacing'?!(Number(controls.pathSpacing.value)>0):!(Number(controls.pathDistance.value)>0))return 'Enter a positive path spacing or distance.';}
    if(controls.patternType.value==='linear'&&!(Number(controls.spacing.value)>0))return 'Enter a positive distance.';
    if(controls.patternType.value==='polar'&&!(Number(controls.angle.value)>0))return 'Enter a positive angle.';
    if(controls.directionSource.value==='edge'&&!controls.edge.value)return 'Pick a straight edge for the pattern direction.';
    if(controls.directionSource.value==='face'&&!controls.directionFace.value)return 'Pick a plane, face or sketch line for the pattern direction.';
    if(controls.directionSource.value==='face'&&controls.patternType.value==='polar'){const ref=JSON.parse(controls.directionFace.value);if(ref.kind!=='face'||!['cylinder','cone'].includes(ref.surfaceType))return 'The axis of pattern needs a cylindrical or conical face (or an edge, line or axis).';}
    if(controls.skip.value.trim()&&controls.skip.value.split(/[\s,]+/).filter(Boolean).some(n=>!(Number.isInteger(Number(n))&&Number(n)>=2)))return 'Skipped instances are instance numbers from 2 up, such as 2, 4.';
    if(parts&&controls.result.value!=='new'&&!JSON.parse(controls.mergeScope.value||'[]').length)return 'Select the merge scope part.';
    if(controls.directionSource.value==='vector'&&Math.hypot(Number(controls.vectorX.value),Number(controls.vectorY.value),Number(controls.vectorZ.value))<1e-9)return 'Enter a nonzero direction.';
    if(controls.useSecond.value==='yes'&&(!(Number(controls.secondCount.value)>=2)||!(Number(controls.secondSpacing.value)>0)))return 'Enter a positive second distance and an instance count of at least 2.';
    if(!parts&&!JSON.parse(controls.mergeScope.value||'[]').length)return 'Select the merge scope part.';
    return parts?null:requireSelections(controls,[{key:'source',noun:'a feature to pattern'}]);
  },
  serialize(values) {
    const parts=values.what==='parts'?(JSON.parse(values.parts||'[]') as string[]):undefined;
    const partFields=parts?{bodyIds:parts,copyBodyIds:Object.fromEntries(parts.map((id,i)=>[id,`${values.copyPrefix}-${i+1}`]))}:{};
    const linear=values.patternType==='linear',source=values.directionSource,count=Number(values.count);
    const face=source==='face'&&values.directionFace?JSON.parse(values.directionFace) as {kind:string;centerMillimeters?:unknown}:undefined;
    if(face)delete face.centerMillimeters;
    const picked=source==='edge'&&values.edge?JSON.parse(values.edge):face;
    const vector=source==='vector'?{kind:'vector' as const,direction:[Number(values.vectorX),Number(values.vectorY),Number(values.vectorZ)] as [number,number,number]}:undefined;
    const result=parts&&values.result!=='new'?{resultOperation:values.result,targetBodyId:JSON.parse(values.mergeScope||'[]')[0]}:{};
    const skip=values.skip.trim()?{skipInstances:[...new Set(values.skip.split(/[\s,]+/).filter(Boolean).map(Number))].sort((a,b)=>a-b)}:{};
    const target=parts?result:{targetBodyId:JSON.parse(values.mergeScope||'[]')[0]};
    if(values.patternType==='path')return {sourceFeatureId:values.source,...partFields,...target,...skip,patternType:'path',axis:values.axis,count,reversed:false,pathFeatureId:values.pathSketch,...(values.pathMode==='distance'?{distanceMillimeters:Number(values.pathDistance)}:{spacingMillimeters:Number(values.pathSpacing)}),...(values.pathOrientation==='path'?{orientation:'path'}:{})};
    // Onshape's Equal spacing off: the angle is between instances; the document stores the total extent.
    const angle=values.equalSpacing==='true'?Number(values.angle):Math.min(360,Number(values.angle)*(count-1));
    return {sourceFeatureId:values.source,...partFields,...target,...skip,patternType:values.patternType,axis:values.axis,count,reversed:values.direction==='reverse',
      ...(values.centered==='true'?{alignment:'center'}:{}),
      ...(linear
        ?{spacingMillimeters:Number(values.spacing),...(vector?{direction:vector}:picked?{direction:picked}:{}),
          ...(values.useSecond==='yes'?{second:{axis:values.secondAxis,count:Number(values.secondCount),spacingMillimeters:Number(values.secondSpacing),...(values.secondDirection==='reverse'?{reversed:true}:{}),...(values.secondCentered==='true'?{alignment:'center'}:{})}}:{})}
        :{angleDegrees:angle,...(picked?{axisReference:picked}:{})})};
  },
};
