import { sketchRegions, type SolidFaceReference } from "@aether/core/document";
import {layoutRegion, regionControls, stampProfileSelections} from './regions';
import {faceIdentity, mountPickedReferences} from './picked-references';
import {requireSelections, layoutParameterRows, type FeatureEditor} from './shared';

/** Holes start at a circular sketch region (one, or every circle of the sketch)
 *  or at a point on a picked planar face (SolidCraft's `position` on a face),
 *  drilled into the part. */
export const holeEditor: FeatureEditor = {
  type: 'hole',
  controls(context) {
    const {field, reference, feature} = context;
    const source = reference('Center sketch', ['profile', 'sketch'], feature?.profileFeatureId);
    const placement = feature?.placement;
    return {
      placement: field('Placement', placement ? 'face' : 'sketch', ['sketch', 'face']),
      source, region: regionControls(context, source, 'Circular region', false, true),
      allCircles: field('Every circle of the sketch', feature?.allCircles ? 'yes' : 'no', ['no', 'yes']),
      face: field('Hole face', JSON.stringify(placement ? [placement.face] : [])),
      pointX: field('Point X (mm)', String(placement?.pointMillimeters[0] ?? 0)),
      pointY: field('Point Y (mm)', String(placement?.pointMillimeters[1] ?? 0)),
      pointZ: field('Point Z (mm)', String(placement?.pointMillimeters[2] ?? 0)),
      cutType: field('Hole type', feature?.cutType ?? 'plain', ['plain', 'counterbore', 'countersink']),
      diameter: field('Diameter (mm)', String(feature?.diameterMillimeters ?? 6)),
      depthType: field('Depth type', feature?.depthType ?? 'blind', ['blind', 'through-all']),
      depth: field('Depth (mm)', String(feature?.depthMillimeters ?? 10)),
      counterDiameter: field('Head diameter (mm)', String(feature?.counterDiameterMillimeters ?? 10)),
      counterDepth: field('Counterbore depth (mm)', String(feature?.counterDepthMillimeters ?? 2)),
      countersinkAngle: field('Countersink angle (degrees)', String(feature?.countersinkAngleDegrees ?? 90)),
      direction: field('Direction', feature?.reversed ? 'reverse' : 'normal', ['normal', 'reverse']),
      drillMode: field('Drill direction', feature?.direction ? 'custom' : 'square', ['square', 'custom']),
      drillX: field('Drill X', String(feature?.direction?.[0] ?? 0)), drillY: field('Drill Y', String(feature?.direction?.[1] ?? 0)), drillZ: field('Drill Z', String(feature?.direction?.[2] ?? -1)),
    };
  },
  layout(context, controls) {
    const rows = layoutParameterRows(context, input => {
      if (input === controls.face) return true;
      if (input !== controls.region) return false;
      layoutRegion(context, controls.source, controls.region);
      return true;
    });
    const faces = mountPickedReferences<SolidFaceReference & {centerMillimeters?: [number, number, number]}>(context, controls.face, {
      title: 'Hole face', kind: 'face', requestEvent: 'aether-offset-faces-request', replyEvent: 'aether-offset-faces', replyKey: 'faces', identity: faceIdentity,
      note: 'Pick the planar face to drill into; the point defaults to its centre.',
      onChange: picked => {
        if (picked.length > 1) { faces.update([picked[picked.length - 1]]); return; }
        if (picked.length) {
          controls.placement.value = 'face'; controls.placement.dispatchEvent(new Event('change'));
          const c = picked[0].centerMillimeters; if (c) { controls.pointX.value = String(c[0]); controls.pointY.value = String(c[1]); controls.pointZ.value = String(c[2]); }
        }
      },
    });
    const sync = () => {
      const face = controls.placement.value === 'face';
      const sourceRow = controls.source.closest<HTMLElement>('.aui-feature-row') ?? controls.source.parentElement; if (sourceRow) sourceRow.hidden = face;
      const regionRow = controls.region.closest<HTMLElement>('.aui-feature-row') ?? controls.region.parentElement; if (regionRow) regionRow.hidden = face || controls.allCircles.value === 'yes';
      rows.get(controls.allCircles)!.hidden = face;
      for (const key of ['pointX', 'pointY', 'pointZ']) rows.get(controls[key])!.hidden = !face;
      for (const key of ['drillX', 'drillY', 'drillZ']) rows.get(controls[key])!.hidden = controls.drillMode.value !== 'custom';
      rows.get(controls.direction)!.hidden = controls.drillMode.value === 'custom';
      rows.get(controls.depth)!.hidden = controls.depthType.value !== 'blind';
      rows.get(controls.counterDiameter)!.hidden = controls.cutType.value === 'plain';
      rows.get(controls.counterDepth)!.hidden = controls.cutType.value !== 'counterbore';
      rows.get(controls.countersinkAngle)!.hidden = controls.cutType.value !== 'countersink';
    };
    for (const key of ['placement', 'allCircles', 'cutType', 'depthType', 'drillMode']) controls[key].addEventListener('change', sync);
    sync();
  },
  validate(controls, context) {
    const missing = requireSelections(controls, [{key:'target', noun:'a target body'}]);
    if (missing) return missing;
    if (controls.drillMode.value === 'custom' && Math.hypot(Number(controls.drillX.value), Number(controls.drillY.value), Number(controls.drillZ.value)) < 1e-9) return 'Enter a nonzero drill direction.';
    if (controls.placement.value === 'face') {
      if (!JSON.parse(controls.face.value).length) return 'Pick the face to drill into.';
      if (![controls.pointX, controls.pointY, controls.pointZ].every(c => Number.isFinite(Number(c.value)))) return 'Enter a finite hole point.';
      return null;
    }
    if (!controls.source.value) return 'Choose a center sketch, or a face to drill into.';
    const sketch = context.doc.features.find(feature => feature.id === controls.source.value);
    if (controls.allCircles.value === 'yes') return sketch && sketchRegions(sketch, true, context.doc.features).some(r => r.circle) ? null : 'The sketch has no circles.';
    const region = sketch && sketchRegions(sketch, true, context.doc.features).find(region => String(region.contourIndex) === controls.region.value);
    if (!region?.circle) return 'Choose a circular sketch region for the hole center.';
    return null;
  },
  serialize(values, context) {
    const face = values.placement === 'face';
    const picked = face ? JSON.parse(values.face)[0] as SolidFaceReference & {centerMillimeters?: unknown} : undefined;
    if (picked) delete picked.centerMillimeters;
    return {
      ...(face
        ? { placement: { kind: 'face-point', face: picked, pointMillimeters: [Number(values.pointX), Number(values.pointY), Number(values.pointZ)] } }
        : values.allCircles === 'yes' ? { profileFeatureId: values.source, allCircles: true } : stampProfileSelections(context, [{featureId: values.source, contourIndex: Number(values.region)}], true)[0]),
      cutType: values.cutType, diameterMillimeters: Number(values.diameter),
      depthType: values.depthType, depthMillimeters: Number(values.depth),
      ...(values.cutType !== 'plain' ? {counterDiameterMillimeters: Number(values.counterDiameter)} : {}),
      ...(values.cutType === 'counterbore' ? {counterDepthMillimeters: Number(values.counterDepth)} : {}),
      ...(values.cutType === 'countersink' ? {countersinkAngleDegrees: Number(values.countersinkAngle)} : {}),
      reversed: values.direction === 'reverse',
      ...(values.drillMode === 'custom' ? { direction: [Number(values.drillX), Number(values.drillY), Number(values.drillZ)] } : {}),
    };
  },
};
