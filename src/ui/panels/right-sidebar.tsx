/** Reorganized 5-pillar right sidebar:
 *  - Properties (Selection · Appearance · Physical Material)
 *  - Design     (Parameters · Configurations)
 *  - Inspect    (Analysis · Surface Shaders)
 *  - Assembly   (Structure · Mates · BOM)
 *  - View       (Camera · Environment · Performance) */
import { useEffect, useState, type ReactNode } from "react";
import { SegmentedControl } from "@aether/ui";
import "../CADInspector.css";

export const rightSidebarGroups = {
  inspector: ["inspector", "visualization", "physical-material"],
  design: ["parameters", "configurations"],
  inspect: ["inspect", "surface-analysis"],
  mates: ["mates"],
  view: ["view", "rendering", "performance"],
} as const;

export function rightSidebarGroup(id: string): string {
  if (id === "material") id = "visualization";
  return Object.entries(rightSidebarGroups).find(([, children]) => children.some((child) => child === id))?.[0] ?? id;
}

export function RightSidebarPanel({ label, tabs, request }: {
  label: string;
  tabs: { id: string; label: string; content: ReactNode }[];
  request: { id: string; sequence: number };
}) {
  const [active, setActive] = useState(tabs[0].id);
  useEffect(() => {
    if (tabs.some((tab) => tab.id === request.id)) setActive(request.id);
  }, [request.id, request.sequence]);

  if (tabs.length === 1) {
    return (
      <section className="cad-sidebar-panel" aria-label={label}>
        <div className="cad-sidebar-content" aria-label={tabs[0].label}>
          {tabs[0].content}
        </div>
      </section>
    );
  }

  return (
    <section className="cad-sidebar-panel" aria-label={label}>
      <div className="cad-sidebar-tabs">
        <SegmentedControl
          variant="panel"
          ariaLabel={`${label} tabs`}
          value={active}
          options={tabs.map(({ id, label: tabLabel }) => ({ id, label: tabLabel }))}
          onChange={setActive}
        />
      </div>
      {tabs.map((tab) => (
        <div key={tab.id} hidden={active !== tab.id} className="cad-sidebar-content" aria-label={tab.label}>
          {tab.content}
        </div>
      ))}
    </section>
  );
}
