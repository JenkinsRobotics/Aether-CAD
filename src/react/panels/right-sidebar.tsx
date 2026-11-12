/** The five standard object tabs, composed from the same shared panel controls. */
import { useEffect, useState, type ReactNode } from 'react';
import { SegmentedControl } from '@aether/ui';
import '../CADInspector.css';

// Object tab (StandardAppShell id) → the CAD panel requests it answers.
export const rightSidebarGroups = {
  inspector: ['inspect', 'performance'],
  properties: ['inspector', 'parameters'],
  appearance: ['visualization'],
  transform: ['mates'],
  effects: ['rendering', 'view'],
} as const;

export function rightSidebarGroup(id: string): string {
  if (id === 'material') id = 'visualization';
  return Object.entries(rightSidebarGroups).find(([, children]) => children.some(child => child === id))?.[0] ?? id;
}

export function RightSidebarPanel({ label, tabs, request }: {
  label: string;
  tabs: {id: string; label: string; content: ReactNode}[];
  request: {id: string; sequence: number};
}) {
  const [active, setActive] = useState(tabs[0].id);
  useEffect(() => {
    if (tabs.some(tab => tab.id === request.id)) setActive(request.id);
  }, [request.id, request.sequence]);
  return <section className="cad-sidebar-panel" aria-label={label}>
    {tabs.length > 1 && <div className="cad-sidebar-tabs">
      <SegmentedControl variant="panel" ariaLabel={`${label} tabs`} value={active}
        options={tabs.map(({id,label})=>({id,label}))} onChange={setActive}/>
    </div>}
    {tabs.map(tab => <div key={tab.id} hidden={active !== tab.id} className="cad-sidebar-content" aria-label={tab.label}>
      {tab.content}
    </div>)}
  </section>;
}
