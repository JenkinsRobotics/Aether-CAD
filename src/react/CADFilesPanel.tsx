import { useState, type ReactNode } from 'react';
import { AetherIcon, Tabs, type DocumentConnection } from '@aether/ui';
import { CADDriveBrowser } from './CADDriveBrowser';
import './CADFilesPanel.css';

/** Drive owns saved files; the other tab is a projection of one CAD document. */
export function CADFilesPanel({ documentID, connection, children }: { documentID: string | null; connection: DocumentConnection; children: ReactNode }) {
  const [scope, setScope] = useState('design');
  return <section className="cad-files-panel" aria-label="Files navigation">
    <Tabs activeID={scope} onSelect={setScope} tabs={[
      { id: 'design', label: 'This design', icon: <AetherIcon name="cube" /> },
      { id: 'drive', label: 'Drive', icon: <AetherIcon name="folder" /> },
    ]}/>
    <div className="cad-files-panel-content" role="tabpanel" aria-label={scope === 'design' ? 'This design' : 'Drive'}>
      {scope === 'design' ? children : <CADDriveBrowser documentID={documentID} connection={connection}/>}
    </div>
  </section>;
}
