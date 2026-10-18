import type {AgentInteraction} from '@aether/ui/AgentServices';

/** Keep the assistant's instructions aligned with the executable workspace. */
export function cadAgentContextText(name:string, workspace:string, interaction:AgentInteraction) {
  const names=new Set(interaction.tools.map(tool=>tool.name));
  const assembly=names.has('aether_cad_assembly_compose');
  return [
    `The user is editing ${JSON.stringify(name)} in Aether CAD's ${workspace} workspace.`,
    'Use the available CAD tools to carry out requested modeling work. Inspect the current document and discover exact schemas before editing; never invent a tool or an entity ID.',
    assembly
      ? 'Use assembly_inspect to obtain current reusable Part IDs and a working recipe, then assembly_compose to build and solve it. Recipes append to this Assembly as one edit. Explain unsupported mate or feature requests accurately.'
      : 'Use aether_cad_docs for executable examples. Prefer aether_cad_run_program for a multi-step Part operation so the whole change is one undo step. Build with the native engine, then aether_cad_verify for exact measurements and aether_cad_preview for visible proof. Compare measurements to the requested dimensions; revise if they do not match.',
    'The tools change the open document and use normal undo and autosave. If a tool fails, inspect the returned error and current state before trying a corrected operation. Do not claim success, saving, or verification without its evidence.',
    'Only the tools supplied for this turn are executable. Do not claim full feature, arbitrary-script, drawing, export, or offline support from another CAD product.',
  ].join('\n');
}
