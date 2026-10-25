import { stdin, stdout } from 'node:process';
import { inspectSketch } from './sketch-edit';
import { prepareCommand, finalizeCandidate } from './commands';
import { assemblyJobFor } from '../assembly-job';
import { parsePartDocument, serializePartDocument } from '@aether/core/document';
import { beginSavedProgram, prepareSavedProgramStep, acceptSavedProgramStep, savedProgramDocs } from './saved-program';
import { exampleAssemblyRecipe } from '../assembly-recipe';
import { buildPhase, analyzePhase, exportPhase, assemblyPhase, engineDescription, drawingPhase } from './engine-node';
async function main() {
try {
  const chunks: Buffer[]=[]; let bytes=0;
  for await (const chunk of stdin) {
    bytes+=chunk.length; if(bytes>16*1024*1024)throw Error('CAD request exceeds the automation size limit.');
    chunks.push(Buffer.from(chunk));
  }
  const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
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
    // values. The solver must accept that pose rather than choose another one.
    projection.instances = projection.instances.map((instance: any) => ({...instance,rest_transform:instance.solved_world_transform}));
    stdout.write(JSON.stringify(assemblyJobFor(projection)));
  } else {
  const result = request.phase === 'build' ? await buildPhase(request.content, { rollback: request.rollback })
    : request.phase === 'drawing' || request.phase === 'drawing_docs' ? await drawingPhase(request)
    : request.phase === 'analyze' ? await analyzePhase(request.content, request.options)
    : request.phase === 'export' ? await exportPhase(request.content, request.options)
    : request.phase === 'assembly_solve' ? assemblyPhase(request.job)
    : request.phase === 'engine' ? engineDescription()
    : request.phase === 'assembly_example' ? exampleAssemblyRecipe('linear',request.part_id??undefined)
    : request.phase === 'compare' ? {changed:serializePartDocument(parsePartDocument(request.content))!==serializePartDocument(parsePartDocument(request.candidate))}
    : request.phase === 'program_begin' ? beginSavedProgram(request.content,request.program_json)
    : request.phase === 'program_step' ? prepareSavedProgramStep(request.content,request.step,request.references)
    : request.phase === 'program_accept' ? acceptSavedProgramStep(request)
    : request.command === 'cad.sketch.inspect' ? {result:inspectSketch(parsePartDocument(request.content),request.arguments)}
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

}
void main();
