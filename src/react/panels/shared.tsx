import {displayQuantity, unitChoice} from "@aether/core/units";
import {documentUnits, subscribeDocumentUnits} from "../../document-preferences";
/** Pieces more than one panel needs: the placement menu every panel
 *  header carries, the tree helpers, and the read-only property grid. */
import { type CADPanelID, type CADPanelPlacement, cadPresentation } from "../../cad-presentation-store";
import { type CADInspectorSection, cadWorkspace } from "../../cad-workspace-store";
import { Button, PanelPlacementMenu, PropertyGrid, type TreeNode } from "@aether/ui";
import { useSyncExternalStore } from "react";
import { cadCommands, type CADCommandID } from "../../cad-command-registry";
import type { ReactNode } from "react";

export function CADPanelPlacementMenu({ panel, label, placement }: { panel: CADPanelID; label: string; placement: CADPanelPlacement }) {
  return <PanelPlacementMenu
    className="cad-panel-placement-menu"
    label={label}
    placement={placement}
    onChange={(nextPlacement) => cadPresentation.dispatch({
      type: "set-panel-placement",
      panel,
      placement: nextPlacement,
    })}
  />;
}

export function countTreeMatches(nodes: readonly TreeNode[], filter: string): number {
  const query = filter.trim().toLocaleLowerCase();
  let count = 0;
  const visit = (items: readonly TreeNode[]) => items.forEach((item) => {
    if (!query || `${item.label} ${item.badge ?? ""}`.toLocaleLowerCase().includes(query)) count += 1;
    if (item.children) visit(item.children);
  });
  visit(nodes);
  return count;
}

/* ponytail: static mockups — greyed-out until each workflow gets real host backing. */

export function MockNote() { return <p className="cad-mock-note">Planned — not functional yet.</p>; }

export function findTreeNode(nodes: readonly TreeNode[], id: string): TreeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const child = node.children ? findTreeNode(node.children, id) : null;
    if (child) return child;
  }
  return null;
}
export function ReadOnlyPropertyGrid({
  ariaLabel,
  emptyState,
}: {
  ariaLabel: string;
  emptyState: string;
}) {
  const workspace = useSyncExternalStore(
    cadWorkspace.subscribe,
    cadWorkspace.snapshot,
    cadWorkspace.snapshot,
  );
  return (
    <ReadOnlyPropertySections sections={workspace.inspectorSections} ariaLabel={ariaLabel} emptyState={emptyState} />
  );
}

export function ReadOnlyPropertySections({
  sections,
  ariaLabel,
  emptyState,
}: {
  sections: readonly CADInspectorSection[];
  ariaLabel: string;
  emptyState: string;
}) {
  const units = useSyncExternalStore(subscribeDocumentUnits, documentUnits, documentUnits);
  return <PropertyGrid
      ariaLabel={ariaLabel}
      sections={sections.map((section) => ({
        ...section,
        properties: section.properties.map((property) => ({
          ...property,
          editor: <output>{property.quantity ? `${displayQuantity(property.quantity.si,units,property.quantity.family)} ${unitChoice(units,property.quantity.family).unit}` : property.displayUnit ? unitChoice(units,property.displayUnit).unit : property.value}</output>,
          readOnly: true,
        })),
      }))}
      emptyState={emptyState}
    />;
}

export const unavailableInspectionTools = [
  {
    id: "curvature",
    label: "Curvature",
    description: "Surface continuity and curvature evaluation are not exposed by the Core bridge yet.",
  },
] as const;

/** A command as a primary button. Two panels drive commands this way, so it
 *  sits here rather than in the shell it was lifted out of. */
export function CommandButton({
  command,
  id,
  className,
  children,
  disabled = false,
}: {
  disabled?: boolean;
  command: CADCommandID;
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  const commands = useSyncExternalStore(
    cadCommands.subscribe,
    cadCommands.snapshot,
    cadCommands.snapshot,
  );
  const state = commands[command];
  return (
    <Button
      id={id}
      className={className}
      primary
      active={state.active}
      disabled={disabled || !state.enabled || !state.registered}
      onClick={() => cadCommands.execute(command)}
    >
      {children}
    </Button>
  );
}
