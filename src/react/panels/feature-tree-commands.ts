/** Shared menu presentation adapted to CAD's existing validated command boundary. */
import { featureTreeActions, type FeatureTreeItem, type FeatureTreeRequest, type TreeNode } from "@aether/ui";
import type { CADWorkspaceAction } from "../../cad-workspace-store";

export function cadFeatureItem(node: TreeNode): FeatureTreeItem {
  const body = node.id.startsWith("feature/body/") || node.id.startsWith("part/");
  const kind = body ? "part" : node.id.startsWith("folder/") ? "folder" : node.id.startsWith("feature/") ? "feature" : "reference";
  const visibility = node.actions?.find(action => ["body-visibility", "toggle-visibility"].includes(action.id));
  return { id: node.id, label: node.label, kind,
    type: kind === "folder" ? "folder" : body ? "part" : kind === "feature" ? node.id.split("/")[1] : node.id.endsWith("origin") ? "point" : "plane",
    hidden: visibility ? /^Show\b/.test(visibility.label) : false,
    suppressed: node.badge === "Suppressed" || node.actions?.some(action => action.id === "suppress-feature" && /^Unsuppress\b/.test(action.label)),
    children: node.children?.map(cadFeatureItem),
  };
}
export function cadFeatureActions(node: TreeNode, nodes: readonly TreeNode[], selectedIDs: ReadonlySet<string>, rollbackIndex: number, partOpen: boolean, historyIDs?: readonly string[], historyNodes: readonly TreeNode[] = []) {
  const visible = nodes.flatMap(function flatten(row): TreeNode[] { return [row, ...(row.children ?? []).flatMap(flatten)]; });
  const all = [...new Map([...historyNodes, ...visible].map(row => [row.id, row])).values()];
  const item = cadFeatureItem(node);
  const selected = selectedIDs.has(node.id) ? all.filter(row => selectedIDs.has(row.id)).map(cadFeatureItem) : [item];
  let features = nodes.map(cadFeatureItem).flatMap(function history(row): FeatureTreeItem[] {
    return row.kind === "feature" || row.kind === "folder" ? [row] : (row.children ?? []).flatMap(history);
  });
  if (historyIDs) {
    const flat = all.map(cadFeatureItem);
    // Folder presentation may group non-adjacent rows; rollback follows document history.
    features = [...historyIDs.flatMap(id => flat.filter(row => row.kind === "feature" && row.id.split("/").slice(2).join("/") === id)), ...flat.filter(row => row.kind === "folder").map(row => ({...row, children:[]}))];
  }
  const supported = (request: FeatureTreeRequest): boolean | string => {
    const rows = request.ids.map(id => all.find(row => row.id === id));
    if (rows.some(row => !row || row.disabled)) return "This item is unavailable.";
    if (!partOpen && request.command !== "visibility") return "Open a part document first.";
    if (request.command === "new-folder") return selected.every(row => row.kind === "feature") || "Only feature rows can be grouped here.";
    if (request.ids.length !== 1 && request.command !== "rollback") return "Choose one item for this CAD command.";
    const has = (action: string) => !!rows[0]?.actions?.some(entry => entry.id === action);
    switch (request.command) {
      case "rename": return item.kind === "part" ? has("body-rename") : item.kind === "feature" || item.kind === "folder";
      case "edit": return has("edit-feature");
      case "suppress": return has("suppress-feature");
      case "visibility": return has("body-visibility") || has("toggle-visibility") || "Visibility is not available for this entity yet.";
      case "rollback": return item.kind === "feature";
      case "move": return item.kind === "feature";
      case "add-to-folder": return item.kind === "feature" && request.targetID !== item.id;
      case "delete": return item.kind === "feature" || item.kind === "folder";
      case "appearance": return node.id.startsWith("feature/body/");
      default: return false;
    }
  };
  const available = ["rename", "edit", "visibility", "suppress", "rollback", "move", "new-folder", "add-to-folder", "delete", "appearance"] as const;
  return featureTreeActions(item, { selected, features, rollbackIndex,
    available, canCommand: supported })
    .filter(action => (available as readonly string[]).includes(action.request.command))
    // A placement is edited in History; it has no row to group or reorder in Features.
    .filter(action => visible.some(row => row.id === node.id) || !["move", "new-folder", "add-to-folder"].includes(action.request.command))
    .filter(action => action.request.command !== 'visibility' || node.actions?.some(entry => ['body-visibility', 'toggle-visibility'].includes(entry.id)));
}
/** No evaluator or new document mutation: dispatch the same commands as existing CAD controls. */
export function cadTreeCommand(request: FeatureTreeRequest, node: TreeNode): CADWorkspaceAction | null {
  const item = cadFeatureItem(node), id = node.id;
  if (request.command === "rollback" && request.index !== undefined) return { type: "rollback-to", index: request.index };
  if (request.command === "new-folder") return { type: "create-folder", memberIDs: request.ids };
  if ((request.command === "move" || request.command === "add-to-folder") && request.targetID) return { type: "move-item", id, targetID: request.targetID, position: request.command === "add-to-folder" ? "inside" : request.position ?? "before" };
  const actionID = request.command === "rename" ? item.kind === "folder" ? "folder-rename" : item.kind === "part" ? "body-rename" : "rename-feature"
    : request.command === "edit" ? "edit-feature" : request.command === "suppress" ? "suppress-feature"
    : request.command === "visibility" ? node.actions?.find(action => ["body-visibility", "toggle-visibility"].includes(action.id))?.id
    : request.command === "delete" ? item.kind === "folder" ? "folder-delete" : "delete-feature" : undefined;
  return actionID ? { type: "item-action", id, actionID } : null;
}
export function cadHistoryCount(nodes: readonly TreeNode[]): number {
  return nodes.reduce((count, node) => count + (node.id.startsWith('source-feature/') || (node.id.startsWith('feature/') && !node.id.startsWith('feature/body/')) ? 1 : 0) + cadHistoryCount(node.children ?? []), 0);
}
