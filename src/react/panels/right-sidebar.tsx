/** Four sidebar destinations, composed from the same shared panel controls. */
import { useEffect, useState, type ReactNode } from 'react';
import { SegmentedControl } from '@aether/ui';
import '../CADInspector.css';

export const rightSidebarGroups = {
  inspector: ['inspector', 'visualization'],
  inspect: ['inspect', 'performance'],
  mates: ['mates', 'parameters'],
  view: ['view', 'rendering'],
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
    <div className="cad-sidebar-tabs">
      <SegmentedControl variant="panel" ariaLabel={`${label} tabs`} value={active}
        options={tabs.map(({id,label})=>({id,label}))} onChange={setActive}/>
    </div>
    {tabs.map(tab => <div key={tab.id} hidden={active !== tab.id} className="cad-sidebar-content" aria-label={tab.label}>
      {tab.content}
    </div>)}
  </section>;
}
