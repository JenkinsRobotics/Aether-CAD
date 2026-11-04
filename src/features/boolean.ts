/** Boolean, as Onshape's (help: booleanparts.htm): Union / Subtract / Intersect tabs, a Tools box
 *  filled by picking parts, Keep tools, and for Subtract the Targets box and the Offset options.
 *  Union and Intersect combine the tools into the first tool's part; Subtract removes the tools
 *  from the target. Offset all with its distance and flip grows the tools before the cut; Faces
 *  to offset and Reapply fillet are present and disabled with the gap named (ledger: Boolean). */
import {availableBodies} from '@aether/core/document';
import {mountPartBox} from './part-box';
import {checkRow, iconButton, layoutParameterRows, operationTabs, planned, rowIn, unitSuffix, type FeatureEditor} from './shared';

const facesGap = 'Not available in this kernel: offsetting only some of a tool\'s faces is a recorded gap (Offset all grows the whole tool; Move faces on the tool part offsets chosen faces).';
const reapplyGap = 'Not available in this kernel: re-filleting the offset tool\'s edges is a recorded gap.';

export const booleanEditor: FeatureEditor = {
  type: 'boolean',
  controls({field, feature}) {
    const tools = feature ? (feature.operation === 'cut' ? feature.toolBodyIds : [feature.targetBodyId, ...feature.toolBodyIds]) : [];
    return {
      operation: field('Operation', feature?.operation ?? 'union', ['union', 'cut', 'intersection']),
      tools: field('Tool body IDs', JSON.stringify(tools)),
      targets: field('Target body IDs', JSON.stringify(feature?.operation === 'cut' ? [feature.targetBodyId] : [])),
      keep: field('Keep tools', feature?.keepTools ? 'yes' : 'no', ['no', 'yes']),
      offsetOn: field('Offset', feature?.offsetMillimeters ? 'yes' : 'no', ['no', 'yes']),
      offset: field('Offset distance (mm)', String(Math.abs(feature?.offsetMillimeters ?? 1))),
      offsetFlip: field('Offset opposite direction', (feature?.offsetMillimeters ?? 0) < 0 ? 'yes' : 'no', ['no', 'yes']),
    };
  },
  layout(context, controls) {
    const {doc, feature, form, win} = context;
    const end = feature ? doc.features.findIndex(f => f.id === feature.id) : doc.rollbackIndex ?? doc.features.length;
    const bodies = availableBodies({...doc, features:doc.features.slice(0,end), rollbackIndex:undefined});
    operationTabs(win, form, controls.operation, ['union', 'cut', 'intersection'], ['Union', 'Subtract', 'Intersect']);
    const tools = mountPartBox(context, controls.tools, 'Tools', bodies, () => JSON.parse(controls.targets.value || '[]')[0] ?? '');
    win.body.append(tools.element);
    layoutParameterRows(context, (input) => [controls.keep, controls.targets, controls.offsetOn, controls.offset, controls.offsetFlip].includes(input));
    for (const key of ['offsetOn', 'offsetFlip']) { controls[key].closest('label')?.remove(); controls[key].hidden = true; controls[key].setAttribute('form', form.id); form.append(controls[key]); }
    checkRow(context, controls.keep, 'Keep tools');
    const targets = mountPartBox(context, controls.targets, 'Targets', bodies, () => '', {single: true});
    win.body.append(targets.element);
    controls.targets.addEventListener('change', () => { const target = JSON.parse(controls.targets.value || '[]')[0]; if (target) tools.update(tools.read().filter(id => id !== target)); });
    // Subtract's Offset options: Offset all grows every tool by the distance (flip shrinks).
    const offset = win.subsection('Offset', {kind: 'checkbox', open: controls.offsetOn.value === 'yes', onToggle: (open) => { controls.offsetOn.value = open ? 'yes' : 'no'; controls.offsetOn.dispatchEvent(new Event('change')); }});
    const check = (label: string, checked = false) => { const input = document.createElement('input'); input.type = 'checkbox'; input.checked = checked; input.setAttribute('aria-label', label); return input; };
    const faces = win.entitiesBox('Faces to offset'); faces.render([]);
    controls.offset.closest('label')?.remove(); controls.offset.setAttribute('form', form.id);
    const flip = iconButton('flip-horizontal', 'Opposite direction');
    const paintFlip = () => flip.setAttribute('aria-pressed', String(controls.offsetFlip.value === 'yes'));
    flip.onclick = () => { controls.offsetFlip.value = controls.offsetFlip.value === 'yes' ? 'no' : 'yes'; paintFlip(); controls.offsetFlip.dispatchEvent(new Event('change')); };
    paintFlip();
    offset.body.append(planned(rowIn('Offset all', check('Offset all', true)), 'Always on here: ' + facesGap), planned(faces.element, facesGap), rowIn('Offset distance', controls.offset, unitSuffix(context.lengthUnitLabel), flip), planned(rowIn('Reapply fillet', check('Reapply fillet')), reapplyGap));
    win.body.append(offset.element);
    const sync = () => { const subtract = controls.operation.value === 'cut'; targets.element.hidden = !subtract; offset.element.hidden = !subtract; };
    controls.operation.addEventListener('change', sync); sync();
  },
  validate(controls) {
    const tools: string[] = JSON.parse(controls.tools.value || '[]');
    if (controls.operation.value === 'cut') {
      const target = JSON.parse(controls.targets.value || '[]')[0];
      if (!target) return 'Select the target part.';
      if (!tools.length) return 'Select the tool parts.';
      if (tools.includes(target)) return 'The target cannot also be a tool.';
      if (controls.offsetOn.value === 'yes' && !(Number(controls.offset.value) > 0)) return 'Enter a positive offset distance.';
      return null;
    }
    if (tools.length < 2) return 'Select two or more parts to combine.';
    return null;
  },
  serialize(values) {
    const tools: string[] = JSON.parse(values.tools || '[]');
    const subtract = values.operation === 'cut';
    return {operation: values.operation, targetBodyId: subtract ? JSON.parse(values.targets || '[]')[0] : tools[0], toolBodyIds: subtract ? tools : tools.slice(1), keepTools: values.keep === 'yes',
      ...(subtract && values.offsetOn === 'yes' ? {offsetMillimeters: Number(values.offset) * (values.offsetFlip === 'yes' ? -1 : 1)} : {})};
  },
};
