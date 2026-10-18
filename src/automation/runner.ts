import { readFileSync } from 'node:fs';
import { stdin, stdout } from 'node:process';
import { prepareCommand, finalizeCandidate } from './commands';
import { assemblyJobFor } from '../assembly-job';
import { parsePartDocument, serializePartDocument } from '@aether/core/document';
import { beginSavedProgram, prepareSavedProgramStep, acceptSavedProgramStep, savedProgramDocs } from './saved-program';
import { exampleAssemblyRecipe } from '../assembly-recipe';
try {
  const request = JSON.parse(readFileSync(stdin.fd, 'utf8'));
  if (request.phase === 'assembly') {
    const projection = request.projection;
    for (const part of projection.part_definitions) if (part.feature_document) {
      part.feature_document = parsePartDocument(JSON.stringify(part.feature_document));
      if (part.feature_document.features.length > 512) throw Error('A Part supports up to 512 features.');
    }
    const used = new Set(projection.instances.filter((i: {suppressed:boolean}) => !i.suppressed).map((i: {definition_id:string}) => i.definition_id));
    for (const id of request.template_ids ?? []) used.add(id);
    projection.part_definitions = projection.part_definitions.filter((p: {id:string}) => used.has(p.id));
    // Qualify the saved tree solver's pose, including its explicit free-DOF
    // values. FreeCAD must accept that pose rather than choose another one.
    projection.instances = projection.instances.map((instance: any) => ({...instance,rest_transform:instance.solved_world_transform}));
    stdout.write(JSON.stringify(assemblyJobFor(projection)));
  } else {
  const result = request.phase === 'assembly_example' ? exampleAssemblyRecipe('linear',request.part_id??undefined)
    : request.phase === 'compare' ? {changed:serializePartDocument(parsePartDocument(request.content))!==serializePartDocument(parsePartDocument(request.candidate))}
    : request.phase === 'program_begin' ? beginSavedProgram(request.content,request.program_json)
    : request.phase === 'program_step' ? prepareSavedProgramStep(request.content,request.step,request.references)
    : request.phase === 'program_accept' ? acceptSavedProgramStep(request)
    : request.command === 'cad.part.docs' ? {result:savedProgramDocs(request.arguments)}
    : request.phase === 'finalize'
    ? { content: finalizeCandidate(request.content, request.body_outputs, request.sketch_frames,request.scope_resolutions) }
    : prepareCommand(request.command, request.content, request.arguments);
  const encoded = JSON.stringify(result);
  if (Buffer.byteLength(encoded) > 8 * 1024 * 1024) throw Error('CAD result exceeds the automation size limit.');
  stdout.write(encoded);
  }
} catch (error) {
  stdout.write(JSON.stringify({ error: error instanceof Error ? error.message : 'CAD command failed.' }));
}
