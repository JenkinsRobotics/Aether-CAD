import {availableBodies} from '@aether/core/document';
import {layoutParameterRows, type FeatureEditor} from './shared';

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
    controls.tools.closest('label')?.remove();
    controls.tools.hidden = true;
    controls.tools.setAttribute('form',form.id);
    form.append(controls.tools);
    layoutParameterRows(context);
    const box = win.entitiesBox('Tool bodies');
    const list = document.createElement('div');
    box.element.append(list);
    const selected = (): string[] => JSON.parse(controls.tools.value);
    const render = () => {
      list.replaceChildren();
      for (const body of bodies.filter(b => b.id !== controls.target.value)) {
        const label = document.createElement('label');
        label.className = 'aui-feature-entity';
        const input = document.createElement('input');
        input.type = 'checkbox'; input.checked = selected().includes(body.id);
        input.setAttribute('aria-label',`Use ${body.name} as tool`);
        input.onchange = () => {
          controls.tools.value = JSON.stringify(input.checked
            ? [...selected(),body.id] : selected().filter(id => id !== body.id));
          controls.tools.dispatchEvent(new Event('change'));
        };
        label.append(input,document.createTextNode(body.name));
        list.append(label);
      }
    };
    controls.target.addEventListener('change', () => {
      controls.tools.value = JSON.stringify(selected().filter(id => id !== controls.target.value));
      render(); controls.tools.dispatchEvent(new Event('change'));
    });
    render();
  },
  validate(controls) {
    if (!controls.target.value) return 'Choose a target body.';
    const tools: string[] = JSON.parse(controls.tools.value);
    if (!tools.length) return 'Choose at least one tool body.';
    if (tools.includes(controls.target.value)) return 'The target cannot also be a tool.';
    return null;
  },
  serialize(values) {
    return {operation:values.operation,toolBodyIds:JSON.parse(values.tools),keepTools:values.keep==='yes'};
  },
};
