/** Boolean, as Onshape's: Union / Subtract / Intersect tabs, a Tools box filled by picking
 *  parts, and Keep tools. The target is the shared Target body box. */
import {availableBodies} from '@aether/core/document';
import {mountPartBox} from './part-box';
import {checkRow, layoutParameterRows, operationTabs, type FeatureEditor} from './shared';

export const booleanEditor: FeatureEditor = {
  type: 'boolean',
  controls({field, feature}) {
    return {
      operation: field('Operation', feature?.operation ?? 'union', ['union', 'cut', 'intersection']),
      tools: field('Tool body IDs', JSON.stringify(feature?.toolBodyIds ?? [])),
      keep: field('Keep tools', feature?.keepTools ? 'yes' : 'no', ['no', 'yes']),
    };
  },
  layout(context, controls) {
    const {doc, feature, form, win} = context;
    const end = feature ? doc.features.findIndex(f => f.id === feature.id) : doc.rollbackIndex ?? doc.features.length;
    const bodies = availableBodies({...doc, features:doc.features.slice(0,end), rollbackIndex:undefined});
    operationTabs(win, form, controls.operation, ['union', 'cut', 'intersection'], ['Union', 'Subtract', 'Intersect']);
    const tools = mountPartBox(context, controls.tools, 'Tools', bodies, () => controls.target.value);
    controls.target.addEventListener('change', () => tools.update(tools.read().filter(id => id !== controls.target.value)));
    layoutParameterRows(context, (input) => input === controls.keep);
    checkRow(context, controls.keep, 'Keep tools');
  },
  validate(controls) {
    if (!controls.target.value) return 'Choose a target body.';
    const tools: string[] = JSON.parse(controls.tools.value);
    if (!tools.length) return 'Select the tool parts.';
    if (tools.includes(controls.target.value)) return 'The target cannot also be a tool.';
    return null;
  },
  serialize(values) {
    return {operation:values.operation,toolBodyIds:JSON.parse(values.tools),keepTools:values.keep==='yes'};
  },
};
