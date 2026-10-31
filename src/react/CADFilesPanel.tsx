import type { DragEventHandler, ReactNode } from 'react';
import { AetherIcon, FilesPanel, type DocumentConnection } from '@aether/ui';
import { CADDriveBrowser } from './CADDriveBrowser';
import './CADFilesPanel.css';

/** Drive owns saved files; the other tab is a projection of one CAD document. The
 *  shared panel draws the frame; the design contents list supplies the header's "+". */
export function CADFilesPanel({ documentID, connection, children, error, onDesignDragStart }: { documentID: string | null; connection: DocumentConnection; children: ReactNode; error?: string; onDesignDragStart?: DragEventHandler<HTMLDivElement> }) {
  return <FilesPanel error={error} local={{ label: 'This design', icon: <AetherIcon name="cube" />, content: children, onDragStart: onDesignDragStart }}
    drive={<CADDriveBrowser documentID={documentID} connection={connection}/>}/>;
}
