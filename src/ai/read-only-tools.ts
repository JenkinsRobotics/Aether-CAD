import type { AgentInteraction } from '@aether/ui/AgentServices';

// Explicit product capabilities; unknown/new tools remain editing-only.
const readOnly = new Set([
  'aether_cad_docs', 'aether_cad_inspect', 'aether_cad_sketch_inspect',
  'aether_cad_feature_types', 'aether_cad_feature_schema', 'aether_cad_feature_references',
  'aether_cad_verify', 'aether_cad_preview', 'aether_cad_topology', 'aether_cad_assembly_inspect',
  'aether_cad_drawing_inspect', 'aether_cad_drawing_export', 'aether_review_read',
]);

export function cadReadOnlyInteraction(interaction: AgentInteraction): AgentInteraction {
  return {...interaction, readOnlyTools: interaction.tools.filter(tool => readOnly.has(tool.name)).map(tool => tool.name)};
}
