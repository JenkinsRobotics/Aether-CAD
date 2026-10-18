import { Children, cloneElement, isValidElement, type ReactNode } from "react";
/** CAD's existing tree commands presented through the shared authoring-tree standard. */
import { AetherIcon, ToolIcon, FeatureTypeIcon, type TreeNode } from "@aether/ui";

function categoryFor(id: string) {
  if (id.startsWith('reference/') || id.startsWith('feature/plane/')) return 'plane';
  if (/^feature\/(profile|sketch)\//.test(id)) return 'sketch';
  if (id.startsWith('feature/body/') || id.startsWith('part/')) return 'body';
  return undefined;
}

function svgStatusArtwork(icon: ReactNode, type?: string): ReactNode {
  if (!isValidElement<{ className?: string; children?: ReactNode }>(icon)) return icon;
  if (icon.type === ToolIcon) {
    const name = (icon.props as { name?: string }).name;
    return <FeatureTypeIcon type={type ?? name ?? "part"} />;
  }
  if (icon.props.className?.includes("cad-tree-icon-badge")) return cloneElement(icon, {},
    <AetherIcon name={icon.props.className.includes("under-constrained") ? "status-incomplete" : "status-error"} />);
  return icon.props.children ? cloneElement(icon, {}, Children.map(icon.props.children, child => svgStatusArtwork(child, type))) : icon;
}

export function itemTreePresentation(nodes: readonly TreeNode[]): TreeNode[] {
  return nodes.map((node) => ({ ...node,
    className: [node.className, "aui-feature-tree-item", node.badge === "Suppressed" ? "aui-feature-tree-item--suppressed" : "", node.badge === "Rolled back" ? "aui-feature-tree-item--rolled-back" : "", node.id === "rollback-bar" ? "aui-feature-tree-rollback" : ""].filter(Boolean).join(" "),
    label: node.id === "reference-folder" ? "Default geometry" : node.label,
    draggable: node.id === "rollback-bar" || node.id.startsWith("folder/") || (node.id.startsWith("feature/") && !node.id.startsWith("feature/body/")),
    dropMode: node.id.startsWith("folder/") ? "hierarchy" : "reorder",
    searchText: node.id.startsWith("feature/") ? node.id.split("/")[1] : node.searchText,
    category: node.category ?? categoryFor(node.id),
    badge: ["Suppressed", "Rolled back", "Under-defined", "Error", "—", "Editing", "No plane", "Fastened", "Free"].includes(node.badge ?? "") ? undefined : node.badge,
    status: [...(node.status ?? []),
      ...(node.badge === "Rolled back" ? [{ id: "rollback", label: "Rolled back", icon: <AetherIcon name="history" /> }] : []),
      ...(node.badge === "—" ? [{ id: "unavailable", label: "Unavailable", icon: <AetherIcon name="status-incomplete" /> }] : []),
      ...(node.badge === "Error" ? [{ id: "error", label: "Feature error", icon: <AetherIcon name="status-error" /> }] : []),
      ...(node.badge === "Editing" ? [{ id: "editing", label: "Editing sketch", icon: <AetherIcon name="sketch-nodes" /> }] : []),
      ...(node.badge === "No plane" ? [{ id: "no-plane", label: "No sketch plane", icon: <AetherIcon name="status-error" /> }] : []),
      ...(node.badge === "Fastened" ? [{ id: "fastened", label: "Fastened", icon: <AetherIcon name="fastened" /> }] : []),
      ...(node.badge === "Free" ? [{ id: "free", label: "Free to move", icon: <AetherIcon name="mouse" /> }] : []),
    ],
    icon: node.id.startsWith("document/") || node.id === "reference-folder" ? <AetherIcon name="collection-folder" /> : node.icon === "◇" ? <AetherIcon name="cube" /> : svgStatusArtwork(node.icon, node.id.startsWith("feature/") ? node.id.split("/")[1] : undefined) ?? (node.id.startsWith("feature/body/") ? <AetherIcon name="cube" /> : undefined),
    actions: node.actions?.map((action) => ({ ...action,
      state: action.id === "body-visibility" || action.id === "toggle-visibility",
      pinned: action.pinned || (action.id === "suppress-feature" && node.badge === "Suppressed"),
      icon: action.id === "suppress-feature" ? <AetherIcon name="pause" />
        : action.id.startsWith("rollback") ? <AetherIcon name="history" />
        : action.id.includes("rename") ? <AetherIcon name="notes" />
        : action.id.includes("delete") ? <AetherIcon name="delete" />
        : action.id === "edit-feature" ? <AetherIcon name="settings" /> : action.icon,
    })),
    children: node.children && itemTreePresentation(node.children),
  }));
}

/** Reorder sibling features without silently changing their folder membership. */
export function adjacentFeature(nodes: readonly TreeNode[], id: string, direction: -1 | 1): TreeNode | undefined {
  const features = nodes.filter((node) => node.id.startsWith("feature/") && !node.id.startsWith("feature/body/"));
  const index = features.findIndex((node) => node.id === id);
  if (index >= 0) return features[index + direction];
  for (const node of nodes) {
    const found = node.children && adjacentFeature(node.children, id, direction);
    if (found) return found;
  }
}
