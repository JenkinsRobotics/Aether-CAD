import { useState, type DragEventHandler, type ReactNode } from 'react';
import { AetherIcon, SegmentedControl, SidePanelHeader, PanelNotifications, PanelNotice, type DocumentConnection } from '@aether/ui';
import { CADDriveBrowser } from './CADDriveBrowser';
import './CADFilesPanel.css';

/** Drive owns saved files; the other tab is a projection of one CAD document. */
export function CADFilesPanel({ documentID, connection, children, error, onDesignDragStart }: { documentID: string | null; connection: DocumentConnection; children: ReactNode; error?: string; onDesignDragStart?: DragEventHandler<HTMLDivElement> }) {
  const [scope, setScope] = useState('design');
  return <PanelNotifications><section className="cad-files-panel" aria-label="Files navigation">
    <div className="cad-files-panel-heading"><SidePanelHeader title="Files" icon="folder"/></div>
    <PanelNotice message={error}/>
    <SegmentedControl variant="panel" className="cad-files-panel-scopes" ariaLabel="Files view" value={scope} onChange={setScope} options={[
      { id: 'design', label: 'This design', icon: <AetherIcon name="cube" /> },
      { id: 'drive', label: 'Drive', icon: <AetherIcon name="folder" /> },
    ]}/>
    <div onDragStart={scope === "design" ? onDesignDragStart : undefined} className="cad-files-panel-content" role="region" aria-label={scope === 'design' ? 'This design' : 'Drive'}>
      {scope === 'design' ? children : <CADDriveBrowser documentID={documentID} connection={connection}/>}
    </div>
  </section></PanelNotifications>;
}
