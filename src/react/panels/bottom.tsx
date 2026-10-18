/** The bottom tray: feature history, docked or in the sidebar. */
import { type CADPresentationSnapshot, cadPresentation } from "../../cad-presentation-store";
import { cadWorkspace } from "../../cad-workspace-store";
import { CADHistoryTimeline } from "../CADHistoryTimeline";
import { BottomPanel, ListBox, Tabs } from "@aether/ui";
import { useSyncExternalStore } from "react";
import { CADPanelPlacementMenu } from "./shared";

export function WorkbenchBottomPanel({ presentation, sidebar = false }: { presentation: CADPresentationSnapshot; sidebar?: boolean }) {
  const workspace = useSyncExternalStore(
    cadWorkspace.subscribe,
    cadWorkspace.snapshot,
    cadWorkspace.snapshot,
  );
  const historyList = <div id="history-list" className="history-list"><ListBox ariaLabel="Feature history" items={workspace.historyItems} selectedIDs={new Set()} onSelect={(ids) => { const id = ids[0]; if (id) cadWorkspace.dispatch({ type: "activate-history", id }); }} onActivate={(id) => cadWorkspace.dispatch({ type: "activate-history", id })} emptyState="Create or import geometry to build history." /></div>;
  const historyTimeline = <div id="history-list" className="cad-history-timeline-wrap"><CADHistoryTimeline items={workspace.historyItems} rollbackIndex={workspace.rollbackIndex} /></div>;
  const problems = <div className="problems-list"><ListBox ariaLabel="Rebuild problems" items={workspace.problemItems} selectedIDs={new Set()} selectionMode="none" emptyState="No rebuild problems." /></div>;
  if (sidebar) return <section className="cad-sidebar-history" aria-label="Feature history sidebar">
    <Tabs tabs={[{id: "history", label: "History"}, {id: "problems", label: "Problems"}]} activeID={presentation.bottomPanelActiveID} onSelect={id => cadPresentation.dispatch({type: "select-bottom-panel", id: id as "history" | "problems"})} />
    {presentation.bottomPanelActiveID === "history" ? historyList : problems}
  </section>;
  return (
    <div className={`cad-bottom-workbench${sidebar ? " cad-sidebar-history" : ""}`}>
      {!sidebar && <CADPanelPlacementMenu panel="bottom" label="History and Problems" placement={presentation.panelPlacements.bottom} />}
      <BottomPanel
        ariaLabel="Rebuild workbench"
        activeID={presentation.bottomPanelActiveID}
        collapsed={sidebar ? false : presentation.bottomPanelCollapsed}
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
