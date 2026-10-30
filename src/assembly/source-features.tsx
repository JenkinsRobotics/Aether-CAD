import { AetherIcon, FeatureTypeIcon, type ListBoxItem, type TreeNode } from '@aether/ui';
import { parsePartDocument, rollbackPosition } from '@aether/core/document';
import type { AssemblyProjectionV1 } from '../cad-assembly-bridge';
import { isPartPlacementAction } from '../part-history';

/** Navigation references, never features inserted into the assembly document. */
export function sourceFeatureTarget(id: string): { partID: string; featureID?: string } | null {
  const [kind, part, feature] = id.replace(/^history\//, '').split('/');
  if (!part || !['source-part', 'source-feature'].includes(kind)) return null;
  try {
    return { partID: decodeURIComponent(part), ...(feature ? { featureID: decodeURIComponent(feature) } : {}) };
  } catch { return null; }
}

export function assemblySourceFeatures(projection: AssemblyProjectionV1, collapsed: ReadonlySet<string>) {
  const used = new Set(projection.instances.filter(i => i.definition_kind === 'part').map(i => i.definition_id));
  const nodes: TreeNode[] = [], history: ListBoxItem[] = [], expanded = new Set<string>();
  const documentIDs = new Set<string>();
  for (const part of projection.part_definitions) {
    if (!used.has(part.id) || !part.feature_document) continue;
    const document = parsePartDocument(JSON.stringify(part.feature_document));
    documentIDs.add(document.documentId);
    const partID = encodeURIComponent(part.id), id = `source-part/${partID}`;
    if (!collapsed.has(id)) expanded.add(id);
    const children: TreeNode[] = [];
    document.features.forEach((feature, index) => {
      const featureID = `source-feature/${partID}/${encodeURIComponent(feature.id)}`;
      const state = feature.suppressed ? 'Suppressed' : index >= rollbackPosition(document) ? 'Rolled back' : undefined;
      const icon = <FeatureTypeIcon type={feature.type} />;
      if (!isPartPlacementAction(feature)) children.push({
        id: featureID, label: feature.name, icon, badge: state,
        category: ['profile', 'sketch'].includes(feature.type) ? 'sketch' : feature.type === 'plane' ? 'plane' : undefined,
        searchText: `${part.name} ${feature.type}`,
        actions: [{ id: 'open-source-part', label: 'Open source Part', icon: <AetherIcon name="open-external" /> }],
      });
      history.push({ id: `history/${featureID}`, label: feature.name, icon,
        group: part.name, description: state ?? part.name });
    });
    nodes.push({ id, label: part.name, icon: <FeatureTypeIcon type="part" />,
      badge: String(children.length), children, actions: [{ id: 'open-source-part', label: 'Open source Part', icon: <AetherIcon name="open-external" /> }] });
  }
  return { nodes, history, expanded, documentIDs };
}
