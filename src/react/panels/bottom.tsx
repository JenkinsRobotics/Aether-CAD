/** The bottom editors: feature history and rebuild problems. */
import { type CADPresentationSnapshot, cadPresentation } from "../../cad-presentation-store";
import { cadWorkspace } from "../../cad-workspace-store";
import { CADHistoryTimeline } from "../CADHistoryTimeline";
import { BottomPanel, ListBox } from "@aether/ui";
import { useSyncExternalStore } from "react";

export function WorkbenchBottomPanel({ presentation }: { presentation: CADPresentationSnapshot }) {
  const workspace = useSyncExternalStore(
    cadWorkspace.subscribe,
    cadWorkspace.snapshot,
    cadWorkspace.snapshot,
  );
  const historyTimeline = <div id="history-list" className="cad-history-timeline-wrap"><CADHistoryTimeline items={workspace.historyItems} rollbackIndex={workspace.rollbackIndex} /></div>;
  const problems = <div className="problems-list"><ListBox ariaLabel="Rebuild problems" items={workspace.problemItems} selectedIDs={new Set()} selectionMode="none" emptyState="No rebuild problems." /></div>;
  return (
    <div className="cad-bottom-workbench">
      <BottomPanel
        ariaLabel="Rebuild workbench"
        activeID={presentation.bottomPanelActiveID}
        collapsed={presentation.bottomPanelCollapsed}
        onSelect={(id) => cadPresentation.dispatch({ type: "select-bottom-panel", id: id as "history" | "problems" })}
        onCollapsedChange={(collapsed) => cadPresentation.dispatch({ type: "set-bottom-panel-collapsed", collapsed })}
        tabs={[
          { id: "history", label: "History", badge: workspace.historyItems.length, icon: "↺", content: historyTimeline },
          { id: "problems", label: "Problems", badge: workspace.problemItems.length || undefined, icon: "!", content: problems },
        ]}
      />
    </div>
  );
}
