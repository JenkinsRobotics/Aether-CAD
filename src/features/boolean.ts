/** Boolean, as Onshape's (help: booleanparts.htm): Union / Subtract / Intersect tabs, a Tools box
 *  filled by picking parts, Keep tools, and for Subtract the Targets box and the Offset options.
 *  Union and Intersect combine the tools into the first tool's part; Subtract removes the tools
 *  from the target. Offset (Offset all, Faces to offset, Offset distance, flip, Reapply fillet)
 *  is present and disabled: this kernel has no offset subtract yet (ledger: Boolean). */
import {availableBodies} from '@aether/core/document';
import {mountPartBox} from './part-box';
import {checkRow, iconButton, layoutParameterRows, operationTabs, planned, rowIn, type FeatureEditor} from './shared';

const offsetGap = 'Not available in this kernel: an offset subtract (gap between the tool faces and the remaining part) is a recorded gap.';

export const booleanEditor: FeatureEditor = {
  type: 'boolean',
  controls({field, feature}) {
    const tools = feature ? (feature.operation === 'cut' ? feature.toolBodyIds : [feature.targetBodyId, ...feature.toolBodyIds]) : [];
    return {
      operation: field('Operation', feature?.operation ?? 'union', ['union', 'cut', 'intersection']),
      tools: field('Tool body IDs', JSON.stringify(tools)),
      targets: field('Target body IDs', JSON.stringify(feature?.operation === 'cut' ? [feature.targetBodyId] : [])),
      keep: field('Keep tools', feature?.keepTools ? 'yes' : 'no', ['no', 'yes']),
    };
  },
  layout(context, controls) {
    const {doc, feature, form, win} = context;
    const end = feature ? doc.features.findIndex(f => f.id === feature.id) : doc.rollbackIndex ?? doc.features.length;
    const bodies = availableBodies({...doc, features:doc.features.slice(0,end), rollbackIndex:undefined});
    operationTabs(win, form, controls.operation, ['union', 'cut', 'intersection'], ['Union', 'Subtract', 'Intersect']);
    const tools = mountPartBox(context, controls.tools, 'Tools', bodies, () => JSON.parse(controls.targets.value || '[]')[0] ?? '');
    win.body.append(tools.element);
    layoutParameterRows(context, (input) => input === controls.keep || input === controls.targets);
    checkRow(context, controls.keep, 'Keep tools');
    const targets = mountPartBox(context, controls.targets, 'Targets', bodies, () => '', {single: true});
    win.body.append(targets.element);
    controls.targets.addEventListener('change', () => { const target = JSON.parse(controls.targets.value || '[]')[0]; if (target) tools.update(tools.read().filter(id => id !== target)); });
    // Subtract's Offset options.
    const offset = win.subsection('Offset', {kind: 'checkbox', open: false});
    const text = (label: string) => { const input = document.createElement('input'); input.type = 'text'; input.setAttribute('aria-label', label); return input; };
    const check = (label: string) => { const input = document.createElement('input'); input.type = 'checkbox'; input.setAttribute('aria-label', label); return input; };
    const faces = win.entitiesBox('Faces to offset'); faces.render([]);
    offset.body.append(rowIn('Offset all', check('Offset all')), faces.element, rowIn('Offset distance', text('Offset distance'), iconButton('flip-horizontal', 'Opposite direction')), rowIn('Reapply fillet', check('Reapply fillet')));
    planned(offset.element, offsetGap);
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
      return null;
    }
    if (tools.length < 2) return 'Select two or more parts to combine.';
    return null;
  },
  serialize(values) {
    const tools: string[] = JSON.parse(values.tools || '[]');
    const subtract = values.operation === 'cut';
    return {operation: values.operation, targetBodyId: subtract ? JSON.parse(values.targets || '[]')[0] : tools[0], toolBodyIds: subtract ? tools : tools.slice(1), keepTools: values.keep === 'yes'};
  },
};
