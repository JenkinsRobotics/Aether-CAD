import { DocumentTabTray, type DocumentTabControls } from '@aether/ui';
import './CADTabStrip.css';

/** CAD's bottom tray: the shared Aether UI tray, keeping CAD's hooks for styling and tests. */
export function CADTabStrip(props: DocumentTabControls & {placement:'bottom'|'header'}) {
  return <DocumentTabTray {...props} className="cad-document-tray" />;
}
