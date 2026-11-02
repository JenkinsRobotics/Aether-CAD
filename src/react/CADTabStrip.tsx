import { DocumentTabTray, type DocumentTabControls } from '@aether/ui';
import './CADTabStrip.css';

/** CAD's bottom tray: the shared Aether UI tray, keeping CAD's hooks for styling and tests. */
export function CADTabStrip(props: DocumentTabControls & {placement:'bottom'|'header'; docked?: boolean}) {
  const { docked, ...rest } = props;
  // Docked workspaces use the docked (edge-to-edge) tray; floating ones the studio card (Jonathan, 2026-11-02).
  return <DocumentTabTray {...rest} variant={docked ? 'standard' : 'studio'} className={`cad-document-tray${docked ? ' cad-document-tray--docked' : ''}`} />;
}
