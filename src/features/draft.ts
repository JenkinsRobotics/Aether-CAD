import {requireSelections,type FeatureEditor} from './shared';

export const draftEditor: FeatureEditor = {
  type:'draft',
  controls({field,feature}) {
    return {
      facePlane:field('Face plane',feature?.facePlane.plane ?? 'XZ',['XY','XZ','YZ']),
      faceOffset:field('Face plane offset (mm)',String(feature?.facePlane.offsetMillimeters ?? 0)),
      neutralPlane:field('Neutral plane',feature?.neutralPlane.plane ?? 'XY',['XY','XZ','YZ']),
      neutralOffset:field('Neutral plane offset (mm)',String(feature?.neutralPlane.offsetMillimeters ?? 0)),
      angle:field('Draft angle (degrees)',String(feature?.angleDegrees ?? 5)),
      direction:field('Direction',feature?.reversed ? 'reverse' : 'normal',['normal','reverse']),
    };
  },
  validate(controls) {
    return requireSelections(controls,[{key:'target',noun:'a target body'}]);
  },
  serialize(values) {
    return {
      facePlane:{plane:values.facePlane,offsetMillimeters:Number(values.faceOffset)},
      neutralPlane:{plane:values.neutralPlane,offsetMillimeters:Number(values.neutralOffset)},
      angleDegrees:Number(values.angle),reversed:values.direction==='reverse',
    };
  },
};
