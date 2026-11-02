import { AetherIcon, IconButton } from "@aether/ui";

/** The header's undo/redo. Camera, display, grid, framing and selection filters are
 * viewport controls and live with the viewport, not in the app header (Jonathan, 2026-11-01). */
export function CADToolbarControls({ history, onHistory }: {
  history: readonly { id: string; label: string; disabled?: boolean }[];
  onHistory: (id: string) => void;
}) {
  return <div role="group" aria-label="History">
    {history.map((item, index) => <IconButton key={item.id} label={item.label} appearance="glyph" disabled={item.disabled} onClick={() => onHistory(item.id)}><AetherIcon name={index ? "redo" : "undo"}/></IconButton>)}
  </div>;
}
