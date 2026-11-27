import { Button, Dialog } from "@aether/ui";
import { queueCADImport } from "../modeling/cad-import-service";
import "./CADPopups.css";

/** Catalog-assisted import works without storing supplier credentials in the browser. */
export function CADMcMasterDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} title="Insert from McMaster-Carr" onClose={onClose} actions={<Button onClick={onClose}>Close</Button>}>
      <div className="cad-dialog-form">
        <p className="cad-dialog-lead">Find a component in the McMaster-Carr catalog, download its 3-D STEP file, then choose it here to add it to your Part.</p>
        <div className="cad-dialog-section">
          <h4 className="cad-dialog-section-title">Steps</h4>
          <ol className="cad-dialog-steps">
            <li><a href="https://www.mcmaster.com/" target="_blank" rel="noopener noreferrer">Open McMaster-Carr catalog</a></li>
            <li>Open the part’s CAD downloads and select 3-D STEP.</li>
            <li>Choose the downloaded file below, review it, and select Import.</li>
          </ol>
          <div className="cad-file-field">
            <input
              aria-label="Downloaded STEP file"
              type="file"
              accept=".step,.stp"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) { onClose(); queueCADImport([file]); }
              }}
            />
          </div>
        </div>
        <p className="cad-form-note">This workflow uses a file you download. Automatic catalog downloads are not connected; McMaster-Carr’s API requires an approved account and client certificate.</p>
      </div>
    </Dialog>
  );
}
