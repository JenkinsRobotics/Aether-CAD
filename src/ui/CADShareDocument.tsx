import { useState } from "react";
import { Button, Dialog, FieldRow, TextField } from "@aether/ui";
import { documentLink } from "../app/document-link";
import "./CADPopups.css";

/** Uses the actual saved-document address; local files never imply hosted edits. */
export function CADShareDocument({ onClose }: { onClose: () => void }) {
  const link = documentLink(location.href);
  const [message, setMessage] = useState("");
  return (
    <Dialog open title="Share document" onClose={onClose} actions={<Button primary onClick={onClose}>Done</Button>}>
      <div className="cad-dialog-form">
        {link ? (
          <div className="cad-dialog-section">
            <h4 className="cad-dialog-section-title">Document link</h4>
            <p className="cad-dialog-lead">Recipients need existing access to this document.</p>
            <FieldRow label="URL" htmlFor="share-document-link">
              <TextField id="share-document-link" aria-label="Document link" value={link} readOnly onFocus={(event) => event.currentTarget.select()} />
            </FieldRow>
            <div>
              <Button onClick={async () => {
                try { await navigator.clipboard.writeText(link); setMessage("Link copied"); }
                catch { setMessage("Select and copy the link above."); }
              }}>
                Copy link
              </Button>
            </div>
          </div>
        ) : (
          <p className="cad-dialog-lead">Save this local document to Aether Studio to create a shareable document link.</p>
        )}
        {message && <p className="cad-dialog-status" role="status">{message}</p>}
      </div>
    </Dialog>
  );
}
