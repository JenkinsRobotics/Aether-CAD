import { AetherIcon, Button, FieldRow, IconButton, Popover, SelectField, type PanelPlacement } from "@aether/ui";
import "./CADPopups.css";

/** Presentation controls only; the CAD shell owns the actual layout state. */
export function CADWorkspaceLayoutPopover({
  anchor,
  onClose,
  toolbarMode,
  onToolbarMode,
  panels,
  onPlacement,
  onReset,
}: {
  anchor: HTMLElement | null;
  onClose: () => void;
  toolbarMode: "traditional" | "floating";
  onToolbarMode: (mode: "traditional" | "floating") => void;
  panels: readonly { id: string; label: string; placement: PanelPlacement }[];
  onPlacement: (id: string, placement: PanelPlacement) => void;
  onReset: () => void;
}) {
  return (
    <Popover open={!!anchor} anchor={anchor} onClose={onClose} ariaLabel="Workspace layout" placement="bottom-end">
      <div className="cad-layout-popover">
        <div className="cad-layout-popover-header">
          <strong>Workspace layout</strong>
          <IconButton size="small" label="Close workspace layout" onClick={onClose}>
            <AetherIcon name="close" />
          </IconButton>
        </div>
        <FieldRow label="Commands">
          <SelectField
            aria-label="Commands presentation"
            value={toolbarMode}
            options={[
              { value: "traditional", label: "Docked (top)" },
              { value: "floating", label: "Floating (bottom)" },
            ]}
            onChange={(event) => onToolbarMode(event.target.value as "traditional" | "floating")}
          />
        </FieldRow>
        {panels.map((panel) => (
          <FieldRow key={panel.id} label={panel.label}>
            <SelectField
              aria-label={`${panel.label} placement`}
              value={panel.placement}
              options={[
                { value: "docked", label: panel.id === "inspector" ? "Dock right" : "Dock left" },
                { value: "floating", label: "Float" },
                { value: "hidden", label: "Hidden" },
              ]}
              onChange={(event) => onPlacement(panel.id, event.target.value as PanelPlacement)}
            />
          </FieldRow>
        ))}
        <Button onClick={onReset}>Reset panel placements</Button>
      </div>
    </Popover>
  );
}
