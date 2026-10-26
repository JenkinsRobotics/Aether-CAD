import { cadSnapping } from '../cad-snapping-store';
/** The tool popup and floating magnet share one preference and live state. */
export function mountSketchSnappingControls(parent: HTMLElement, change: {
  geometrySnap(value: boolean): void; gridSnap(value: boolean): void;
}) {
  const section = document.createElement('details'), summary = document.createElement('summary');
  summary.textContent = 'Snapping'; section.append(summary); parent.append(section);
  const fields = (['geometry','grid'] as const).map(kind => {
    const row = document.createElement('label'), input = document.createElement('input');
    const label = kind === 'geometry' ? 'Snap to geometry' : 'Snap to grid';
    input.type = 'checkbox'; input.setAttribute('aria-label',label);
    input.onchange = () => cadSnapping.set({[kind]:input.checked});
    row.append(input,label); section.append(row); return {kind,input};
  });
  const sync = () => {
    const state = cadSnapping.snapshot();
    fields.forEach(({kind,input}) => { input.checked=state[kind]; input.disabled=!state.enabled; });
    change.geometrySnap(state.enabled && state.geometry);
    change.gridSnap(state.enabled && state.grid);
  };
  sync();
  return cadSnapping.subscribe(sync);
}
