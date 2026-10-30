import { useSyncExternalStore } from 'react';
import { AetherIcon, FeatureTypeIcon, HistoryPanel, featureTreeMenuItems, type HistoryEntry } from '@aether/ui';
import { cadWorkspace } from '../../cad-workspace-store';
import { cadPresentation } from '../../cad-presentation-store';
import { cadFeatureActions, cadTreeCommand } from './feature-tree-commands';

/** Complete saved operations, including placement actions omitted from Features. */
export function CADHistoryPanel() {
  const workspace = useSyncExternalStore(cadWorkspace.subscribe, cadWorkspace.snapshot, cadWorkspace.snapshot);
  const presentation = useSyncExternalStore(cadPresentation.subscribe, cadPresentation.snapshot, cadPresentation.snapshot);
  const nodes = workspace.historyNodes;
  const features = workspace.historyItems.filter(row => row.id.startsWith('history/feature/'));
  const featureIDs = features.map(row => row.id.slice('history/feature/'.length));
  const nodeFor = (id: string) => id.startsWith('history/feature/')
    ? nodes.find(node => node.id.startsWith('feature/') && node.id.split('/').slice(2).join('/') === id.slice('history/feature/'.length)) : undefined;
  const actionsFor = (id: string) => {
    const node = nodeFor(id);
    return node ? cadFeatureActions(node, workspace.itemNodes, new Set([node.id]), workspace.rollbackIndex, presentation.partOpen, featureIDs, nodes) : [];
  };
  const entries: HistoryEntry[] = workspace.historyItems.map(row => ({
    id: row.id, label: row.label, icon: nodeFor(row.id) ? <FeatureTypeIcon type={nodeFor(row.id)!.id.split("/")[1]}/> : row.icon, description: row.description, category: row.group,
    inactive: row.description === 'Suppressed' || row.description === 'Rolled back',
    current: row.id === features[workspace.rollbackIndex - 1]?.id,
    actions: nodeFor(row.id) ? featureTreeMenuItems(actionsFor(row.id))
      : [{ id: 'inspect', label: row.id.startsWith('history/source-') ? 'Open source Part' : row.id.startsWith('history/mate/') ? 'Inspect mate' : 'Show imported parts', icon: <AetherIcon name="info"/> }],
  }));
  return <HistoryPanel embedded entries={entries} emptyMessage="Create or import geometry to build history."
    rollbackIndex={presentation.partOpen ? workspace.rollbackIndex : undefined}
    rollbackEntryIDs={features.map(row => row.id)} rollbackDisabled={!!presentation.loading}
    onRollback={index => cadWorkspace.dispatch({ type: 'rollback-to', index })} onCommand={(id, commandID) => {
    if (commandID === 'inspect') { cadWorkspace.dispatch({ type: 'activate-history', id }); return; }
    const node = nodeFor(id);
    const action = actionsFor(id).find(action => action.item.id === commandID);
    if (!node || !action || action.item.disabled) return;
    const command = cadTreeCommand(action.request, node);
    if (command) cadWorkspace.dispatch(command);
  }}/>;
}
