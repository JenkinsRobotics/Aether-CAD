/** Color, render-material library and finish share the same part target. */
import { ObjectAppearanceControls } from './object-appearance';
import { useSyncExternalStore } from 'react';
import { cadPresentation } from '../../cad-presentation-store';
import '../CADInspector.css';
export function PartAppearancePanel() {
  const presentation = useSyncExternalStore(cadPresentation.subscribe, cadPresentation.snapshot, cadPresentation.snapshot);
  return <section className="cad-property-sheet" data-panel="visualization" aria-label="Material properties">
    <ObjectAppearanceControls initialTarget="selection" selectionRequest={presentation.activePanel === 'visualization' ? presentation.propertyPanelRequest : undefined}/>
  </section>;
}
