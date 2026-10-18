import { Button } from "@aether/ui";
import "./CADStatusNotice.css";

/** Errors must remain visible until dismissed or superseded by another action. */
export function CADStatusNotice({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return <div className="cad-status-notice" id="status-message" role="alert" aria-atomic="true">
    <span>{message}</span>
    <Button onClick={onDismiss}>Dismiss</Button>
  </div>;
}
