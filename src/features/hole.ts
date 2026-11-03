import {
  HOLE_THREAD_STANDARDS, HOLE_THREAD_STANDARD_LABELS, capScrewCounterboreFor, countersunkScrewFor, sketchRegions,
  standardHoleDiameter, threadClasses, threadDesignations, threadSpecification,
  type HoleClearanceFit, type HoleThread, type HoleThreadStandard, type SolidFaceReference,
} from "@aether/core/document";
import {layoutRegion, regionControls, stampProfileSelections} from './regions';
import {faceIdentity, mountPickedReferences} from './picked-references';
import {requireSelections, layoutParameterRows, type Control, type FeatureEditor} from './shared';

/** Holes start at a circular sketch region (one, or every circle of the sketch)
 *  or at a point on a picked planar face (SolidCraft's `position` on a face),
 *  drilled into the part. A standard thread (FreeCAD's Hole profiles) sets the
 *  diameter: the tap drill for a tapped hole, the fit for a clearance hole. */
const CUSTOM = 'custom';
const standardLabel = (standard: HoleThreadStandard) => HOLE_THREAD_STANDARD_LABELS[standard];
const standardFor = (label: string) => HOLE_THREAD_STANDARDS.find(standard => standardLabel(standard) === label);

/** Sets a length field from a canonical millimetre value, in the document's display unit. */
function setLength(control: Control, millimeters: number): void {
  const factor = Number(control.dataset.canonicalFactor ?? 1);
  const shown = millimeters / factor;
  control.value = String(Number(shown.toFixed(4)));
}

export const holeEditor: FeatureEditor = {
  type: 'hole',
  controls(context) {
    const {field, reference, feature} = context;
    const source = reference('Center sketch', ['profile', 'sketch'], feature?.profileFeatureId);
    const placement = feature?.placement;
    const thread: HoleThread | undefined = feature?.thread;
    return {
      placement: field('Placement', placement ? 'face' : 'sketch', ['sketch', 'face']),
      source, region: regionControls(context, source, 'Circular region', false, true),
      allCircles: field('Every circle of the sketch', feature?.allCircles ? 'yes' : 'no', ['no', 'yes']),
      face: field('Hole face', JSON.stringify(placement ? [placement.face] : [])),
      pointX: field('Point X (mm)', String(placement?.pointMillimeters[0] ?? 0)),
      pointY: field('Point Y (mm)', String(placement?.pointMillimeters[1] ?? 0)),
      pointZ: field('Point Z (mm)', String(placement?.pointMillimeters[2] ?? 0)),
      profile: field('Thread profile', thread ? standardLabel(thread.standard) : CUSTOM, [CUSTOM, ...HOLE_THREAD_STANDARDS.map(standardLabel)]),
      size: field('Size', thread?.designation ?? 'M6', thread ? threadDesignations(thread.standard) : threadDesignations('iso-metric-coarse')),
      threaded: field('Thread', thread ? (thread.tapped ? 'tapped' : 'clearance') : 'tapped', ['tapped', 'clearance']),
      fit: field('Clearance fit', thread?.fit ?? 'normal', ['close', 'normal', 'loose']),
      threadClass: field('Thread class', thread?.threadClass ?? '', ['', ...threadClasses(thread?.standard ?? 'iso-metric-coarse')]),
      threadModel: field('Thread geometry', thread?.modeled ? 'modelled' : 'cosmetic', ['cosmetic', 'modelled']),
      threadHand: field('Thread hand', thread?.leftHand ? 'left' : 'right', ['right', 'left']),
      threadDepthType: field('Thread depth', thread?.depthMillimeters !== undefined ? 'dimension' : 'whole hole', ['whole hole', 'dimension']),
      threadDepth: field('Thread length (mm)', String(thread?.depthMillimeters ?? 8)),
      cutType: field('Hole type', feature?.cutType ?? 'plain', ['plain', 'counterbore', 'countersink', 'counterdrill']),
      head: field('Head from standard', 'manual', ['manual', 'ISO 4762 cap screw counterbore', 'ISO 10642 countersunk screw']),
      diameter: field('Diameter (mm)', String(feature?.diameterMillimeters ?? 6)),
      depthType: field('Depth type', feature?.depthType ?? 'blind', ['blind', 'through-all']),
      depth: field('Depth (mm)', String(feature?.depthMillimeters ?? 10)),
      drillPoint: field('Drill point', feature?.drillPoint ?? 'flat', ['flat', 'angled']),
      drillPointAngle: field('Drill point angle (degrees)', String(feature?.drillPointAngleDegrees ?? 118)),
      taper: field('Taper (degrees)', String(feature?.taperAngleDegrees ?? 0)),
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
    const hide = (control: Control, hidden: boolean) => { const row = rows.get(control); if (row) row.hidden = hidden; };
    const standard = () => standardFor(controls.profile.value);
    const spec = () => { const s = standard(); return s ? threadSpecification(s, controls.size.value) : undefined; };
    // The size list follows the chosen standard; the previous size is kept when the new standard has it.
    const refillSizes = () => {
      const s = standard(); if (!s || !(controls.size instanceof window.HTMLSelectElement)) return;
      const wanted = controls.size.value;
      controls.size.replaceChildren(...threadDesignations(s).map(designation => Object.assign(document.createElement('option'), {value: designation, textContent: designation})));
      controls.size.value = threadDesignations(s).includes(wanted) ? wanted : threadDesignations(s)[Math.min(4, threadDesignations(s).length - 1)];
      if (controls.threadClass instanceof window.HTMLSelectElement) { const cls = controls.threadClass.value; controls.threadClass.replaceChildren(...['', ...threadClasses(s)].map(value => Object.assign(document.createElement('option'), {value, textContent: value || 'default'}))); controls.threadClass.value = threadClasses(s).includes(cls) ? cls : ''; }
    };
    // A standard drives the diameter: tap drill when tapped, the fit when clearance.
    const applyDiameter = () => {
      const s = spec(); const input = controls.diameter as HTMLInputElement;
      input.readOnly = Boolean(s);
      if (s) setLength(controls.diameter, standardHoleDiameter(s, controls.threaded.value === 'tapped', controls.fit.value as HoleClearanceFit, controls.threadClass.value || undefined));
    };
    const applyHead = () => {
      const s = spec(); if (!s || controls.head.value === 'manual') return;
      const recess = controls.head.value.startsWith('ISO 4762') ? capScrewCounterboreFor(s) : countersunkScrewFor(s);
      if (!recess) return;
      controls.cutType.value = recess.depthMillimeters !== undefined ? 'counterbore' : 'countersink';
      setLength(controls.counterDiameter, recess.diameterMillimeters);
      if (recess.depthMillimeters !== undefined) setLength(controls.counterDepth, recess.depthMillimeters);
      if (recess.angleDegrees !== undefined) controls.countersinkAngle.value = String(recess.angleDegrees / Number(controls.countersinkAngle.dataset.canonicalFactor ?? 1));
    };
    const sync = () => {
      const face = controls.placement.value === 'face';
      const sourceRow = controls.source.closest<HTMLElement>('.aui-feature-row') ?? controls.source.parentElement; if (sourceRow) sourceRow.hidden = face;
      // The circular region is picked in the viewport; its list row stays hidden (Jonathan, 2026-11-02).
      const regionRow = controls.region.closest<HTMLElement>('.aui-feature-row') ?? controls.region.parentElement; if (regionRow) regionRow.hidden = true;
      hide(controls.allCircles, face);
      for (const key of ['pointX', 'pointY', 'pointZ']) hide(controls[key], !face);
      for (const key of ['drillX', 'drillY', 'drillZ']) hide(controls[key], controls.drillMode.value !== 'custom');
      hide(controls.direction, controls.drillMode.value === 'custom');
      const threaded = Boolean(standard()), tapped = threaded && controls.threaded.value === 'tapped';
      hide(controls.size, !threaded); hide(controls.threaded, !threaded);
      hide(controls.fit, !threaded || tapped);
      hide(controls.threadClass, !tapped || !threadClasses(standard()!).length);
      hide(controls.threadModel, !tapped); hide(controls.threadHand, !tapped || controls.threadModel.value !== 'modelled');
      hide(controls.threadDepthType, !tapped); hide(controls.threadDepth, !tapped || controls.threadDepthType.value !== 'dimension');
      hide(controls.head, !threaded || !standard()?.startsWith('iso-metric'));
      hide(controls.depth, controls.depthType.value !== 'blind');
      hide(controls.drillPoint, controls.depthType.value !== 'blind');
      hide(controls.drillPointAngle, controls.depthType.value !== 'blind' || controls.drillPoint.value !== 'angled');
      hide(controls.taper, tapped && controls.threadModel.value === 'modelled');
      const counterbored = controls.cutType.value === 'counterbore' || controls.cutType.value === 'counterdrill';
      const countersunk = controls.cutType.value === 'countersink' || controls.cutType.value === 'counterdrill';
      hide(controls.counterDiameter, controls.cutType.value === 'plain');
      hide(controls.counterDepth, !counterbored);
      hide(controls.countersinkAngle, !countersunk);
    };
    controls.profile.addEventListener('change', () => { refillSizes(); applyDiameter(); applyHead(); sync(); });
    for (const key of ['size', 'threaded', 'fit', 'threadClass']) controls[key].addEventListener('change', () => { applyDiameter(); applyHead(); });
    controls.head.addEventListener('change', () => { applyHead(); sync(); });
    for (const key of ['placement', 'allCircles', 'cutType', 'depthType', 'drillMode', 'threaded', 'threadModel', 'threadDepthType', 'drillPoint']) controls[key].addEventListener('change', sync);
    applyDiameter();
    sync();
  },
  validate(controls, context) {
    const missing = requireSelections(controls, [{key:'target', noun:'a target body'}]);
    if (missing) return missing;
    if (controls.drillMode.value === 'custom' && Math.hypot(Number(controls.drillX.value), Number(controls.drillY.value), Number(controls.drillZ.value)) < 1e-9) return 'Enter a nonzero drill direction.';
    const standard = standardFor(controls.profile.value);
    if (standard && !threadSpecification(standard, controls.size.value)) return `Choose a ${HOLE_THREAD_STANDARD_LABELS[standard]} size.`;
    if (standard && controls.threaded.value === 'tapped' && controls.threadDepthType.value === 'dimension' && !(Number(controls.threadDepth.value) > 0)) return 'Thread length must be positive.';
    if (controls.depthType.value === 'blind' && controls.drillPoint.value === 'angled' && !(Number(controls.drillPointAngle.value) > 0 && Number(controls.drillPointAngle.value) < 180)) return 'Drill point angle must be between 0 and 180 degrees.';
    if (!(Number(controls.taper.value) >= 0 && Number(controls.taper.value) < 45)) return 'Taper must be between 0 and 45 degrees.';
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
    const standard = standardFor(values.profile);
    const tapped = values.threaded === 'tapped';
    const thread: HoleThread | undefined = standard ? {
      standard, designation: values.size, tapped,
      ...(tapped ? {} : {fit: values.fit as HoleClearanceFit}),
      ...(tapped && values.threadClass ? {threadClass: values.threadClass} : {}),
      ...(tapped && values.threadModel === 'modelled' ? {modeled: true, ...(values.threadHand === 'left' ? {leftHand: true} : {})} : {}),
      ...(tapped && values.threadDepthType === 'dimension' ? {depthMillimeters: Number(values.threadDepth)} : {}),
    } : undefined;
    const counterbored = values.cutType === 'counterbore' || values.cutType === 'counterdrill';
    const countersunk = values.cutType === 'countersink' || values.cutType === 'counterdrill';
    return {
      ...(face
        ? { placement: { kind: 'face-point', face: picked, pointMillimeters: [Number(values.pointX), Number(values.pointY), Number(values.pointZ)] } }
        : values.allCircles === 'yes' ? { profileFeatureId: values.source, allCircles: true } : stampProfileSelections(context, [{featureId: values.source, contourIndex: Number(values.region)}], true)[0]),
      cutType: values.cutType, diameterMillimeters: Number(values.diameter),
      depthType: values.depthType, depthMillimeters: Number(values.depth),
      ...(values.cutType !== 'plain' ? {counterDiameterMillimeters: Number(values.counterDiameter)} : {}),
      ...(counterbored ? {counterDepthMillimeters: Number(values.counterDepth)} : {}),
      ...(countersunk ? {countersinkAngleDegrees: Number(values.countersinkAngle)} : {}),
      ...(thread ? {thread} : {}),
      ...(values.depthType === 'blind' && values.drillPoint === 'angled' ? {drillPoint: 'angled', drillPointAngleDegrees: Number(values.drillPointAngle)} : {}),
      ...(Number(values.taper) > 0 && !(thread?.modeled) ? {taperAngleDegrees: Number(values.taper)} : {}),
      reversed: values.direction === 'reverse',
      ...(values.drillMode === 'custom' ? { direction: [Number(values.drillX), Number(values.drillY), Number(values.drillZ)] } : {}),
    };
  },
};
