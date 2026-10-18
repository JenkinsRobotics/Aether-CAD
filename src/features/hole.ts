import {sketchRegions} from '../freecad-translate';
import {layoutRegion, regionControls, selectedRegion} from './regions';
import {requireSelections, layoutParameterRows, type FeatureEditor} from './shared';

export const holeEditor: FeatureEditor = {
  type: 'hole',
  controls(context) {
    const {field, reference, feature} = context;
    const source = reference('Center sketch', ['profile', 'sketch'], feature?.profileFeatureId);
    return {
      source, region: regionControls(context, source, 'Circular region'),
      cutType: field('Hole type', feature?.cutType ?? 'plain', ['plain', 'counterbore', 'countersink']),
      diameter: field('Diameter (mm)', String(feature?.diameterMillimeters ?? 6)),
      depthType: field('Depth type', feature?.depthType ?? 'blind', ['blind', 'through-all']),
      depth: field('Depth (mm)', String(feature?.depthMillimeters ?? 10)),
      counterDiameter: field('Head diameter (mm)', String(feature?.counterDiameterMillimeters ?? 10)),
      counterDepth: field('Counterbore depth (mm)', String(feature?.counterDepthMillimeters ?? 2)),
      countersinkAngle: field('Countersink angle (degrees)', String(feature?.countersinkAngleDegrees ?? 90)),
      direction: field('Direction', feature?.reversed ? 'reverse' : 'normal', ['normal', 'reverse']),
    };
  },
  layout(context, controls) {
    const rows = layoutParameterRows(context, input => {
      if (input !== controls.region) return false;
      layoutRegion(context, controls.source, controls.region);
      return true;
    });
    const sync = () => {
      rows.get(controls.depth)!.hidden = controls.depthType.value !== 'blind';
      rows.get(controls.counterDiameter)!.hidden = controls.cutType.value === 'plain';
      rows.get(controls.counterDepth)!.hidden = controls.cutType.value !== 'counterbore';
      rows.get(controls.countersinkAngle)!.hidden = controls.cutType.value !== 'countersink';
    };
    controls.cutType.addEventListener('change', sync);
    controls.depthType.addEventListener('change', sync);
    sync();
  },
  validate(controls, context) {
    const missing = requireSelections(controls, [{key:'source', noun:'a center sketch'}, {key:'target', noun:'a target body'}]);
    if (missing) return missing;
    const sketch = context.doc.features.find(feature => feature.id === controls.source.value);
    const region = sketch && sketchRegions(sketch, false, context.doc.features).find(region => String(region.contourIndex) === controls.region.value);
    if (!region || region.feature.kind !== 'sketch-circle') return 'Choose a circular sketch region for the hole center.';
    return null;
  },
  serialize(values, context) {
    return {
      profileFeatureId: values.source, ...selectedRegion(values, context),
      cutType: values.cutType, diameterMillimeters: Number(values.diameter),
      depthType: values.depthType, depthMillimeters: Number(values.depth),
      ...(values.cutType !== 'plain' ? {counterDiameterMillimeters: Number(values.counterDiameter)} : {}),
      ...(values.cutType === 'counterbore' ? {counterDepthMillimeters: Number(values.counterDepth)} : {}),
      ...(values.cutType === 'countersink' ? {countersinkAngleDegrees: Number(values.countersinkAngle)} : {}),
      reversed: values.direction === 'reverse',
    };
  },
};
