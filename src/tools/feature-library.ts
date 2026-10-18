/** CAD-owned discovery taxonomy. A category does not imply engine/API support.
 * Existing tool definitions remain authoritative for labels, actions and gaps. */
import { cadRibbonWorkspaces } from './index';
import { tool, type CADToolDefinition, type CADToolGroupDefinition } from './shared';

export type CADFeatureDomainID = 'part' | 'assembly' | 'sketch' | 'curve' | 'solid' | 'drawing';
export const cadFeatureDomains = [
  { id: 'part', label: 'Part', description: 'Documents, feature history, parameters and construction geometry.', icon: 'part' },
  { id: 'assembly', label: 'Assembly', description: 'Reusable components, instances, mates and motion relations.', icon: 'assembly' },
  { id: 'sketch', label: 'Sketch', description: 'Sketch setup, constraints, dimensions and editing.', icon: 'sketch' },
  { id: 'curve', label: 'Curve', description: 'Draw and modify curves in an active sketch. Independent 3D curves remain planned.', icon: 'curve' },
  { id: 'solid', label: 'Solid', description: 'Create and modify exact bodies through editable Part features.', icon: 'extrude' },
  { id: 'drawing', label: 'Drawing', description: 'Technical views, annotations and drawing export.', icon: 'document' },
] as const;

const planned = (id: string, label: string, reason: string): CADToolDefinition =>
  tool(id, label, 'document', undefined, `Not implemented: ${reason}`);

/** Named gaps from the public ClassCAD feature reference, not substitute handlers.
 * Do not enable an entry until its canonical edit/rebuild/save path is verified. */
const additions: Record<CADFeatureDomainID, readonly CADToolGroupDefinition[]> = {
  part: [{ id: 'part-document', label: 'Document and history', tools: [
    tool('part-new', 'New Part', 'part', 'new-part'),
    tool('part-open', 'Open Part', 'open', 'open-part'),
    tool('part-save', 'Save Part', 'save', 'save-part'),
    tool('part-rebuild', 'Rebuild Part', 'check', 'rebuild-part'),
    tool('part-history', 'Feature history', 'list', 'show-history'),
    tool('part-parameters', 'Parameters and configurations', 'properties', 'show-parameters'),
  ] }, { id: 'part-construction-gaps', label: 'Additional construction', tools: [
    planned('part-work-axis', 'Work axis', 'persistent standalone datum axes need a document feature and native rebuild.'),
    planned('part-work-point', 'Work point', 'persistent standalone datum points need a document feature and native rebuild.'),
    planned('part-work-csys', 'Work coordinate system', 'persistent Part coordinate systems need a document feature and native rebuild.'),
  ] }],
  assembly: [{ id: 'assembly-structure-gaps', label: 'Templates and structure', tools: [
    tool('assembly-part-template', 'Part template', 'part', 'assembly-part-template'),
    planned('assembly-assembly-template', 'Assembly template', 'nested template authoring and reference validation are not connected.'),
    tool('assembly-from-json', 'Assembly from JSON', 'assembly', 'assembly-from-json'),
    tool('assembly-linear-array', 'Linear instance array', 'pattern', 'assembly-linear-array'),
    tool('assembly-circular-array', 'Circular instance array', 'pattern', 'assembly-circular-array'),
    planned('assembly-group', 'Rigid group', 'persistent rigid component groups need a solver-backed command.'),
    planned('assembly-linear-pattern', 'Linear component pattern', 'associative component instances and pattern parameters need a canonical command.'),
    planned('assembly-circular-pattern', 'Circular component pattern', 'associative component instances and pattern parameters need a canonical command.'),
  ] }],
  sketch: [{ id: 'sketch-group-gaps', label: 'Groups', tools: [
    planned('sketch-rigid-set', 'Rigid sketch group', 'persistent rigid sketch groups are not connected to the solver.'),
  ] }],
  curve: [{ id: 'curve-independent-gaps', label: 'Additional curves', tools: [
    planned('curve-advanced-polyline', 'Advanced polyline', 'relative/polar segments with associative tangent transitions need a canonical curve command.'),
    planned('curve-composite', 'Composite curve', 'associative 3D curve composition needs a document feature and native rebuild.'),
    planned('curve-3d', '3D curve', 'independent 3D curve documents and editing are not implemented.'),
  ] }],
  solid: [{ id: 'solid-additional-gaps', label: 'Additional solid operations', tools: [
    planned('solid-twist', 'Twist', 'exact deformation with editable parameters and downstream references is not implemented.'),
    planned('solid-slice-sheet', 'Slice by sheet', 'sheet tools and resulting exact body identities need a native command.'),
  ] }],
  drawing: [{ id: 'drawing-additional-gaps', label: 'Views and annotations', tools: [
    planned('drawing-base-view', 'Base view', 'the exact drawing authoring transport is not connected to this tray.'),
    planned('drawing-place-view', 'Place view', 'associative sheet placement needs a connected drawing command.'),
    planned('drawing-dimension', 'Dimension', 'associative drawing dimensions need a connected drawing command.'),
    planned('drawing-svg', 'Export drawing SVG', 'exact projected drawing output needs a connected export command.'),
  ] }],
};

function domainFor(workspace: string, group: string): CADFeatureDomainID | undefined {
  if (workspace.startsWith('assembly-')) return 'assembly';
  if (workspace === 'sketch') return ['sketch-create', 'sketch-modify'].includes(group) ? 'curve' : 'sketch';
  if (group === 'solid-reference' || group === 'home-insert' || group === 'manage-project') return 'part';
  if (group === 'output-drawing') return 'drawing';
  if (['solid', 'surface', 'mesh', 'sheet-metal', 'framing', 'plastic'].includes(workspace) && group !== 'home-selection') return 'solid';
  return undefined;
}

/** Expand variants once so tools hidden under a caret remain discoverable. */
export function expandFeatureTools(tools: readonly CADToolDefinition[]): CADToolDefinition[] {
  return tools.flatMap(definition => [definition, ...expandFeatureTools(definition.variants ?? [])]);
}

export function cadFeatureGroups(domain: CADFeatureDomainID): CADToolGroupDefinition[] {
  const groups: CADToolGroupDefinition[] = domain === 'part' ? [...additions.part] : [];
  for (const workspace of cadRibbonWorkspaces) {
    for (const group of workspace.groups) {
      if (domainFor(workspace.id, group.id) !== domain) continue;
      const tools = group.tools.filter(tool => tool.id !== 'solid-sketch');
      if (tools.length) groups.push({ ...group, label: workspace.id === 'solid' || workspace.id === 'sketch' || workspace.id.startsWith('assembly-') ? group.label : `${workspace.label} · ${group.label}`, tools });
    }
  }
  if (domain === 'sketch') groups.unshift({ id: 'sketch-start', label: 'Setup', tools: [
    cadRibbonWorkspaces.find(workspace => workspace.id === 'solid')!.groups[0].tools.find(tool => tool.id === 'solid-sketch')!,
  ] });
  if (domain !== 'part') groups.push(...additions[domain]);
  return groups;
}

export function cadFeatureToolById(id: string): CADToolDefinition | undefined {
  for (const domain of cadFeatureDomains) for (const group of cadFeatureGroups(domain.id)) {
    const found = expandFeatureTools(group.tools).find(tool => tool.id === id);
    if (found) return found;
  }
  return undefined;
}
