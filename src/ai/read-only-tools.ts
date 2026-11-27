import type { AgentInteraction } from '@aether/ui/AgentServices';

// Explicit product capabilities; unknown/new tools remain editing-only.
const readOnly = new Set([
  'aether_cad_docs', 'aether_cad_commands', 'aether_cad_describe',
  'aether_cad_inspect', 'aether_cad_sketch_inspect', 'aether_cad_model_query',
  'aether_cad_analyze', 'aether_cad_parameter_sweep',
  'aether_cad_parameters_inspect', 'aether_cad_material_library',
  'aether_cad_configurations_inspect', 'aether_cad_notes_inspect', 'aether_cad_standard_parts', 'aether_cad_export_script',
  'aether_cad_feature_types', 'aether_cad_feature_schema', 'aether_cad_feature_references',
  'aether_cad_verify', 'aether_cad_preview', 'aether_cad_topology', 'aether_cad_assembly_inspect',
  'aether_cad_assembly_mass', 'aether_cad_assembly_ik', 'aether_cad_assembly_sweep', 'aether_cad_assembly_find_limits', 'aether_cad_assembly_urdf',
  'aether_cad_drawing_inspect', 'aether_cad_drawing_export', 'aether_cad_drawing_audit', 'aether_cad_drawing_hit_test',
  'aether_review_read',
]);

export function cadReadOnlyInteraction(interaction: AgentInteraction): AgentInteraction {
  return {...interaction, readOnlyTools: interaction.tools.filter(tool => readOnly.has(tool.name)).map(tool => tool.name)};
}
