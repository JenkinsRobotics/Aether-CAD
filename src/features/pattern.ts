import {patternSourceTypes} from '@aether/core/document';
import {requireSelections,layoutParameterRows,type FeatureEditor} from './shared';

export const patternEditor:FeatureEditor={
  type:'pattern',
  controls({field,reference,feature}) {
    return {
      source:reference('Source feature',[...patternSourceTypes],feature?.sourceFeatureId),
      patternType:field('Pattern type',feature?.patternType ?? 'linear',['linear','polar']),
      axis:field('Axis',feature?.axis ?? 'X',['X','Y','Z']),
      count:field('Occurrences',String(feature?.count ?? 3)),
      spacing:field('Spacing (mm)',String(feature?.spacingMillimeters ?? 10)),
      angle:field('Angle (degrees)',String(feature?.angleDegrees ?? 360)),
      direction:field('Direction',feature?.reversed ? 'reverse' : 'normal',['normal','reverse']),
    };
  },
  layout(context,controls) {
    const rows=layoutParameterRows(context);
    const sync=()=>{
      rows.get(controls.spacing)!.hidden=controls.patternType.value!=='linear';
      rows.get(controls.angle)!.hidden=controls.patternType.value!=='polar';
    };
    controls.patternType.addEventListener('change',sync);sync();
  },
  validate(controls) {
    return requireSelections(controls,[{key:'source',noun:'a source feature'},{key:'target',noun:'a target body'}]);
  },
  serialize(values) {
    return {sourceFeatureId:values.source,patternType:values.patternType,axis:values.axis,count:Number(values.count),reversed:values.direction==='reverse',
      ...(values.patternType==='linear'?{spacingMillimeters:Number(values.spacing)}:{angleDegrees:Number(values.angle)})};
  },
};
