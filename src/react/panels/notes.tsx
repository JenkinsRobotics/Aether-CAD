/** Comments, document notes and action items — the three planned panels. */
import { AetherIcon, Button, IconButton } from "@aether/ui";
import { MockNote } from "./shared";

export function CommentsPanel() {
  return (
    <section className="cad-mock-panel" aria-label="Comments">
      <div className="cad-mock-toolbar"><Button disabled title="Planned — not functional yet">All ▾</Button><Button disabled title="Planned — not functional yet">Unresolved ▾</Button></div>
      <textarea className="cad-mock-input" placeholder="Add comment" rows={3} disabled />
      <div className="cad-mock-toolbar"><Button primary disabled>Add</Button><Button disabled>Cancel</Button></div>
      <MockNote />
    </section>
  );
}

export function DocumentNotesPanel() {
  return (
    <section className="cad-mock-panel" aria-label="Document notes">
      <div className="cad-mock-toolbar"><IconButton label="Edit notes" disabled><AetherIcon name="notes" /></IconButton></div>
      <div className="cad-mock-empty"><AetherIcon name="notes" /><p>Instructions, description, or notes for this document</p></div>
      <MockNote />
    </section>
  );
}

export function ActionItemsPanel() {
  return (
    <section className="cad-mock-panel" aria-label="Action items">
      <input className="cad-mock-input" type="search" placeholder="Search in Action items" aria-label="Search in Action items" disabled />
      <div className="cad-mock-toolbar"><Button disabled title="Planned — not functional yet">Type ▾</Button><Button disabled title="Planned — not functional yet">Status ▾</Button><Button disabled title="Planned — not functional yet">Assignee ▾</Button></div>
      <div className="cad-mock-empty"><AetherIcon name="tasks" /><p>No action items found for the current filter.</p></div>
      <MockNote />
    </section>
  );
}
