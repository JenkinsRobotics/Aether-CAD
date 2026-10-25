import type {AgentInteraction} from '@aether/ui/AgentServices';

/** Keep the assistant's instructions aligned with the executable workspace. */
export function cadAgentContextText(name:string, workspace:string, interaction:AgentInteraction) {
  const names=new Set(interaction.tools.map(tool=>tool.name));
  if(names.has('aether_cad_drawing_edit')) return [
    `The user is editing ${JSON.stringify(name)} in Aether CAD's Drawing workspace.`,
    'Use aether_cad_docs to discover exact drawing schemas. Inspect the drawing before editing; use its sheet/view/annotation IDs and expected_revision. Never invent existing IDs.',
    'Drawing coordinates and paper sizes are millimeters. Scale is paper/model; overall dimensions measure the source geometry, not page pixels. Projected views inherit the front parent view scale.',
    'Use drawing_refresh to read the saved source Part through its original file/branch link. Drawing edits never edit that source Part. Edits use normal drawing undo and autosave; export returns text and does not publish a file.',
    'Only provided drawing tools execute here. Sections, assembly drawings/BOM, edge-attached/angular/radial dimensions and PDF are not implemented. Report failures accurately and inspect the unchanged state before retrying.',
  ].join('\n');
  const assembly=names.has('aether_cad_assembly_compose');
  return [
    `The user is editing ${JSON.stringify(name)} in Aether CAD's ${workspace} workspace.`,
    'Use the available CAD tools to carry out requested modeling work. Inspect the current document and discover exact schemas before editing; never invent a tool or an entity ID.',
    assembly
      ? 'Use assembly_inspect to obtain current reusable Part IDs and a working recipe, then assembly_compose to build and solve it. Recipes append to this Assembly as one edit. Explain unsupported mate or feature requests accurately.'
      : 'Use aether_cad_docs for executable examples. Prefer aether_cad_run_program for a multi-step Part operation so the whole change is one undo step. Build with the native engine, then aether_cad_verify for exact measurements and aether_cad_preview for visible proof. Compare measurements to the requested dimensions; revise if they do not match.',
    'For a sketch with multiple closed regions, inspect it and choose profile_point_mm strictly inside the intended region in local millimeters; use all_regions only when the request calls for every region. Boundary points are refused. Sketch creation accepts a principal plane or an explicit frame with perpendicular unit x/y axes, offset_mm and optional flip.',
    'For an existing-sketch edit, inspect the Part then call sketch_inspect with the original sketch ID. Use sketch_translate or sketch_dimension; do not replace the body or append a duplicate sketch. For centering a rectangle, calculate the midpoint of its local bounds and translate by the negative midpoint, preserving its dimensions and existing extrusion. Verify the rebuilt bounds, center and volume; check that the feature count and IDs are unchanged.',
    'The tools change the open document and use normal undo and autosave. If a tool fails, inspect the returned error and current state before trying a corrected operation. Do not claim success, saving, or verification without its evidence.',
    'Only the tools supplied for this turn are executable. Do not claim full feature, arbitrary-script, drawing, export, or offline support from another CAD product.',
  ].join('\n');
}
