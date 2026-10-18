/** The start centre shown when no document is open. */
import { type CADCommandID, cadCommands } from "../../cad-command-registry";
import { type CADPresentationSnapshot, cadPresentation } from "../../cad-presentation-store";
import { CadIcon } from "../CadIcon";
import { AppIcon, Button, Dialog, EmptyState, FieldRow, SelectField, TextField } from "@aether/ui";
import { useState } from "react";

export function StartCenter({ presentation }: { presentation: CADPresentationSnapshot }) {
  const [partName, setPartName] = useState("Part 1");
  const [workspaceType, setWorkspaceType] = useState<"part" | "assembly">("part");
  const closeDialog = () => cadPresentation.dispatch({ type: "show-start-dialog", dialog: null });
  const enterWorkspaceAndExecute = (command: CADCommandID) => {
    cadPresentation.dispatch({ type: "show-start-screen", screen: "workspace" });
    cadCommands.execute(command);
  };
  const recovery = presentation.startScreen === "recovery";
  return (
    <>
    {presentation.startScreen !== "workspace" && <section className="cad-start-center" aria-label={recovery ? "Recovery" : "Aether CAD Home"}>
      <header className="cad-start-header">
        <div><span className="cad-start-mark"><AppIcon app="cad" size={34} /></span><div><strong>{recovery ? "Recovery" : "Aether CAD"}</strong><small>{recovery ? "Safe document restoration" : "Mechanical design workspace"}</small></div></div>
        <Button onClick={() => cadPresentation.dispatch({ type: "show-start-screen", screen: "workspace" })}>Return to workspace</Button>
      </header>
      {recovery ? (
        <EmptyState
          title="No recovery revisions"
          description="No autosave or damaged-cache revisions are available in this local workspace. Open a saved Part to continue safely."
          icon="↺"
          primaryAction={<Button primary onClick={() => enterWorkspaceAndExecute("open-part")}>Open saved Part</Button>}
          secondaryAction={<Button onClick={() => cadPresentation.dispatch({ type: "show-start-screen", screen: "home" })}>Back to Home</Button>}
        />
      ) : (
        <div className="cad-home-content">
          <section className="cad-home-hero">
            <small>START</small>
            <h1>Design a Part or bring in exact geometry.</h1>
            <p>Start with an editable sketch-and-extrude workspace, reopen a native Part, or import CAD solids or mesh references.</p>
            <div className="cad-home-actions">
              <Button primary onClick={() => cadPresentation.dispatch({ type: "show-start-dialog", dialog: "new-workspace" })}>New workspace</Button>
              <Button onClick={() => enterWorkspaceAndExecute("open-part")}>Open Part</Button>
              <Button onClick={() => cadPresentation.dispatch({ type: "open-assembly-workspace" })}>Open Assembly</Button>
              <Button onClick={() => cadPresentation.dispatch({ type: "show-start-dialog", dialog: "import" })}>Import CAD</Button>
              <Button onClick={() => { location.href = "./index.html?demo=harness"; }}>Open harness demo</Button>
            </div>
          </section>
          <section className="cad-home-section" aria-label="Workspace types">
            <header><div><strong>Workspace types</strong><small>Choose a canonical starting context</small></div></header>
            <div className="cad-template-grid">
              <button type="button" onClick={() => { setWorkspaceType("part"); cadPresentation.dispatch({ type: "show-start-dialog", dialog: "new-workspace" }); }}><CadIcon name="model" /><b>Part</b><span>Sketch and exact solid features</span></button>
              <button type="button" onClick={() => { setWorkspaceType("assembly"); setPartName("Assembly 1"); cadPresentation.dispatch({ type: "show-start-dialog", dialog: "new-workspace" }); }}><CadIcon name="assembly" /><b>Assembly</b><span>Persistent mates, solve, and BOM</span></button>
              <button type="button" disabled title="Available when exact drawing projections land"><CadIcon name="items" /><b>Drawing</b><span>Exact projections required</span></button>
            </div>
          </section>
          <section className="cad-home-section cad-home-recent" aria-label="Recent workspaces">
            <header><div><strong>Recent workspaces</strong><small>Local recent history</small></div></header>
            <EmptyState compact title="No recent workspaces" description="Open a native .acpart or .acad workspace and it will be available during this session." icon="◇" />
          </section>
          <Button className="cad-recovery-link" onClick={() => cadPresentation.dispatch({ type: "show-start-screen", screen: "recovery" })}>Open Recovery</Button>
        </div>
      )}
    </section>}
      <Dialog
        open={presentation.startDialog === "new-workspace"}
        title={`New ${workspaceType === "assembly" ? "Assembly" : "Part"} workspace`}
        onClose={closeDialog}
        actions={<><Button onClick={closeDialog}>Cancel</Button><Button primary disabled={!partName.trim()} onClick={() => cadPresentation.dispatch({ type: workspaceType === "assembly" ? "create-assembly-workspace" : "create-part-workspace", name: partName.trim() })}>Create {workspaceType === "assembly" ? "Assembly" : "Part"}</Button></>}
      >
        <div className="cad-start-form">
          <FieldRow label="Workspace name" htmlFor="new-part-name"><TextField id="new-part-name" value={partName} onChange={(event) => setPartName(event.target.value)} /></FieldRow>
          <FieldRow label="Type" htmlFor="new-workspace-type"><SelectField id="new-workspace-type" value={workspaceType} options={[{ value: "part", label: "Part" }, { value: "assembly", label: "Assembly" }, { value: "drawing", label: "Drawing — unavailable", disabled: true }]} onChange={(event) => setWorkspaceType(event.target.value as "part" | "assembly")} /></FieldRow>
          <FieldRow label="Template" htmlFor="new-part-template"><SelectField id="new-part-template" value={workspaceType === "assembly" ? "empty-assembly" : "empty-part"} options={workspaceType === "assembly" ? [{ value: "empty-assembly", label: "Empty Assembly" }] : [{ value: "empty-part", label: "Empty Part — add sketches and features" }]} disabled /></FieldRow>
          <FieldRow label="Units" htmlFor="new-part-units"><SelectField id="new-part-units" value="millimeters" options={[{ value: "millimeters", label: "Millimeters (mm)" }]} disabled /></FieldRow>
          <p className="cad-form-note">{workspaceType === "assembly" ? "The native .acad workspace keeps Core-owned instances, connectors, mates, DOF, relations, solve state, and derived BOM." : "Start with an empty Part. Add sketch profiles, revolve or extrude them, then edit the feature tree and bodies. Geometry is rebuilt by Aether Core through OCCT."}</p>
        </div>
      </Dialog>

    </>
  );
}

// The Assembly authoring dialogs live in ./dialogs, one per file.
