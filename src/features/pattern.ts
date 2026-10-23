import {patternSourceTypes,availableBodies} from '@aether/core/document';
import {requireSelections,layoutParameterRows,entityChips,type FeatureEditor} from './shared';
import {transformEdgePicker} from './transform-edge-picker';

/** Linear: along a principal axis, a vector, or a picked straight edge, with an
 *  optional second row. Polar: about a principal axis or a picked straight edge.
 *  Alignment says where the original sits in its row (SolidCraft's contract). */
export const patternEditor:FeatureEditor={
  type:'pattern',
  controls({field,reference,feature,doc}) {
    const end=feature?doc.features.findIndex(f=>f.id===feature.id):doc.rollbackIndex??doc.features.length;
    const choices=availableBodies({...doc,features:doc.features.slice(0,end),rollbackIndex:undefined});
    const partPick=field('Part',choices[0]?.id??'',choices.map(b=>b.id));Array.from(partPick.children).forEach((o,i)=>(o.textContent=choices[i].name));
    const linear=feature?.patternType==='linear'?feature:undefined,polar=feature?.patternType==='polar'?feature:undefined,path=feature?.patternType==='path'?feature:undefined;
    const dir=linear?.direction,second=linear?.second,axisRef=polar?.axisReference;
    const vec=(v:readonly number[]|undefined,i:number,fallback=0)=>String(v?.[i]??fallback);
    return {
      what:field('Pattern',feature?.bodyIds?'parts':'feature',['feature','parts']),
      parts:field('Parts to pattern',JSON.stringify(feature?.bodyIds??[])),partPick,
      copyPrefix:field('Copy ID prefix',feature?.copyBodyIds?String(Object.values(feature.copyBodyIds as Record<string,string>)[0]??'').replace(/-\d+$/,''):`${doc.documentId}:pattern-${crypto.randomUUID()}`),
      source:reference('Source feature',[...patternSourceTypes],feature?.sourceFeatureId),
      patternType:field('Pattern type',feature?.patternType ?? 'linear',['linear','polar','path']),
      pathSketch:reference('Path sketch',['sketch','profile','curve3d'],path?.pathFeatureId),
      pathMode:field('Path spacing by',path?.distanceMillimeters!==undefined?'distance':'spacing',['spacing','distance']),
      pathSpacing:field('Spacing along path (mm)',String(path?.spacingMillimeters ?? 10)),
      pathDistance:field('Overall distance (mm)',String(path?.distanceMillimeters ?? 30)),
      pathOrientation:field('Orientation',path?.orientation ?? 'identical',['identical','path']),
      directionSource:field('Direction source',dir?.kind==='vector'?'vector':dir?.kind==='solid-edge'?'edge':axisRef?.kind==='solid-edge'?'edge':'axis',['axis','vector','edge']),
      axis:field('Axis',feature?.axis ?? 'X',['X','Y','Z']),
      vectorX:field('Direction X',vec(dir?.kind==='vector'?dir.direction:undefined,0,1)),vectorY:field('Direction Y',vec(dir?.kind==='vector'?dir.direction:undefined,1)),vectorZ:field('Direction Z',vec(dir?.kind==='vector'?dir.direction:undefined,2)),
      edge:field('Direction edge',JSON.stringify(dir?.kind==='solid-edge'?dir:axisRef?.kind==='solid-edge'?axisRef:'')),
      count:field('Occurrences',String(feature?.count ?? 3)),
      spacing:field('Spacing (mm)',String(linear?.spacingMillimeters ?? 10)),
      angle:field('Angle (degrees)',String(polar?.angleDegrees ?? 360)),
      direction:field('Direction',feature?.reversed ? 'reverse' : 'normal',['normal','reverse']),
      alignment:field('Original at',feature?.alignment ?? 'right',['right','center','left']),
      useSecond:field('Second direction',second?'yes':'no',['no','yes']),
      secondAxis:field('Second axis',second?.axis ?? 'Y',['X','Y','Z']),
      secondCount:field('Second occurrences',String(second?.count ?? 2)),
      secondSpacing:field('Second spacing (mm)',String(second?.spacingMillimeters ?? 10)),
      secondDirection:field('Second direction sense',second?.reversed?'reverse':'normal',['normal','reverse']),
    };
  },
  layout(context,controls) {
    const rows=layoutParameterRows(context,control=>control===controls.edge||control===controls.pathSketch||control===controls.parts||control===controls.copyPrefix);
    entityChips(context.win,'Path sketch',controls.pathSketch,context.form);
    for(const key of ['parts','copyPrefix']){controls[key].closest('label')?.remove();controls[key].hidden=true;controls[key].setAttribute('form',context.form.id);context.form.append(controls[key]);}
    const box=context.win.entitiesBox('Parts to pattern');context.win.body.prepend(box.element);
    const names=new Map(Array.from(controls.partPick.children).map(o=>[(o as HTMLOptionElement).value,o.textContent??'']));
    const readParts=():string[]=>JSON.parse(controls.parts.value);
    const setParts=(ids:string[])=>{controls.parts.value=JSON.stringify(ids);renderParts();controls.parts.dispatchEvent(new Event('change'));};
    const renderParts=()=>box.render(readParts().map(id=>({label:names.get(id)??id,onRemove:()=>setParts(readParts().filter(o=>o!==id))})));
    const addPart=document.createElement('button');addPart.type='button';addPart.className='aui-button';addPart.textContent='Add part';addPart.onclick=()=>{const id=controls.partPick.value;if(id&&!readParts().includes(id))setParts([...readParts(),id]);};box.element.append(addPart);renderParts();
    const edgePicker=transformEdgePicker(context,controls.edge);
    const sync=()=>{
      const linear=controls.patternType.value==='linear',isPath=controls.patternType.value==='path',source=controls.directionSource.value,parts=controls.what.value==='parts';
      box.element.hidden=!parts;rows.get(controls.partPick)!.hidden=!parts;const sourceRow=controls.source.closest<HTMLElement>('.aui-feature-row')??controls.source.parentElement;if(sourceRow)sourceRow.hidden=parts;
      rows.get(controls.pathSpacing)!.hidden=!isPath||controls.pathMode.value!=='spacing';rows.get(controls.pathDistance)!.hidden=!isPath||controls.pathMode.value!=='distance';rows.get(controls.pathMode)!.hidden=!isPath;
      rows.get(controls.pathOrientation)!.hidden=!isPath;
      rows.get(controls.directionSource)!.hidden=isPath;rows.get(controls.direction)!.hidden=isPath;rows.get(controls.alignment)!.hidden=isPath;
      rows.get(controls.spacing)!.hidden=!linear;
      rows.get(controls.angle)!.hidden=linear||isPath;
      rows.get(controls.axis)!.hidden=source!=='axis'||isPath;
      for(const key of ['vectorX','vectorY','vectorZ'])rows.get(controls[key])!.hidden=!linear||source!=='vector';
      edgePicker.setEnabled(source==='edge');
      for(const key of ['useSecond'])rows.get(controls[key])!.hidden=!linear;
      for(const key of ['secondAxis','secondCount','secondSpacing','secondDirection'])rows.get(controls[key])!.hidden=!linear||controls.useSecond.value!=='yes';
    };
    controls.patternType.addEventListener('change',()=>{if(controls.patternType.value==='polar'&&controls.directionSource.value==='vector')controls.directionSource.value='axis';sync();});
    controls.directionSource.addEventListener('change',sync);controls.useSecond.addEventListener('change',sync);controls.what.addEventListener('change',sync);controls.pathMode.addEventListener('change',sync);sync();
    for(const option of controls.alignment.children)option.textContent=({right:'First',center:'Middle',left:'Last'} as Record<string,string>)[(option as HTMLOptionElement).value];
  },
  validate(controls) {
    const parts=controls.what.value==='parts';
    if(parts&&!JSON.parse(controls.parts.value).length)return 'Choose at least one part to pattern.';
    if(controls.patternType.value==='path'){if(!controls.pathSketch.value)return 'Choose the path sketch.';if(controls.pathMode.value==='spacing'?!(Number(controls.pathSpacing.value)>0):!(Number(controls.pathDistance.value)>0))return 'Enter a positive spacing or distance along the path.';return parts?null:requireSelections(controls,[{key:'source',noun:'a source feature'},{key:'target',noun:'a target body'}]);}
    if(controls.directionSource.value==='edge'&&!controls.edge.value)return 'Pick a straight edge for the pattern direction.';
    if(controls.directionSource.value==='vector'&&Math.hypot(Number(controls.vectorX.value),Number(controls.vectorY.value),Number(controls.vectorZ.value))<1e-9)return 'Enter a nonzero direction.';
    return parts?null:requireSelections(controls,[{key:'source',noun:'a source feature'},{key:'target',noun:'a target body'}]);
  },
  serialize(values) {
    const parts=values.what==='parts'?(JSON.parse(values.parts) as string[]):undefined;
    const partFields=parts?{bodyIds:parts,copyBodyIds:Object.fromEntries(parts.map((id,i)=>[id,`${values.copyPrefix}-${i+1}`]))}:{};
    const linear=values.patternType==='linear',source=values.directionSource;
    const picked=source==='edge'&&values.edge?JSON.parse(values.edge):undefined;
    const vector=source==='vector'?{kind:'vector' as const,direction:[Number(values.vectorX),Number(values.vectorY),Number(values.vectorZ)] as [number,number,number]}:undefined;
    if(values.patternType==='path')return {sourceFeatureId:values.source,...partFields,patternType:'path',axis:values.axis,count:Number(values.count),reversed:false,pathFeatureId:values.pathSketch,...(values.pathMode==='distance'?{distanceMillimeters:Number(values.pathDistance)}:{spacingMillimeters:Number(values.pathSpacing)}),...(values.pathOrientation==='path'?{orientation:'path'}:{})};
    return {sourceFeatureId:values.source,...partFields,patternType:values.patternType,axis:values.axis,count:Number(values.count),reversed:values.direction==='reverse',
      ...(values.alignment&&values.alignment!=='right'?{alignment:values.alignment}:{}),
      ...(linear
        ?{spacingMillimeters:Number(values.spacing),...(vector?{direction:vector}:picked?{direction:picked}:{}),
          ...(values.useSecond==='yes'?{second:{axis:values.secondAxis,count:Number(values.secondCount),spacingMillimeters:Number(values.secondSpacing),...(values.secondDirection==='reverse'?{reversed:true}:{})}}:{})}
        :{angleDegrees:Number(values.angle),...(picked?{axisReference:picked}:{})})};
  },
};
