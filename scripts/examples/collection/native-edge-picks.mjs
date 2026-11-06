import assert from 'node:assert/strict';

/** Bind recipe locations to native viewport picks at authoring time. */
export async function bindNativeEdgePicks(steps, inspect) {
  const bound = structuredClone(steps), bodies = new Map();
  for (const step of bound) for (const [index, pick] of (step.arguments.feature_json?.edges ?? []).entries()) {
    if (pick.kind !== 'curved-edge') continue;
    assert.equal(typeof pick.bodyId, 'string', 'Resolve earlier program references before native picking');
    if (!bodies.has(pick.bodyId)) {
      const candidates = [];
      let offset = 0;
      do {
        const page = await inspect(pick.bodyId, offset);
        candidates.push(...page.faces.flatMap(face => face.candidates));
        offset = page.next_offset;
      } while (offset !== null && offset !== undefined);
      bodies.set(pick.bodyId, candidates);
    }
    const candidates = bodies.get(pick.bodyId).filter(candidate => candidate.kind === 'edge-midpoint'
      && Math.hypot(...candidate.origin.map((value, axis) => value - pick.midpointMillimeters[axis])) < 1e-3
      && Math.abs((candidate.measurements?.lengthMillimeters ?? 0) - pick.lengthMillimeters) < 1e-3);
    assert.ok(candidates.length, 'Recipe must select an existing native edge: ' + pick.label);
    const anchored = candidates.map(candidate => ({ ...candidate, edgeAnchor: candidate.edgeAnchor ?? candidate.reference?.anchor })).filter(candidate => candidate.edgeAnchor);
    if (!anchored.length) continue; // Curved edges retain the engine's strict geometric reference.
    const key = candidate => JSON.stringify([candidate.edgeAnchor.start.positionMillimeters, candidate.edgeAnchor.end.positionMillimeters].map(p => p.map(x => +x.toFixed(7))).sort());
    assert.equal(new Set(anchored.map(key)).size, 1, 'Native straight-edge pick is ambiguous: ' + pick.label);
    step.arguments.feature_json.edges[index] = { kind: 'solid-edge', sourceFeatureId: pick.sourceFeatureId,
      bodyId: pick.bodyId, label: pick.label, anchor: anchored[0].edgeAnchor,
      ...(pick.radiusMillimeters === undefined ? {} : { radiusMillimeters: pick.radiusMillimeters }) };
  }
  return bound;
}

export function resolveRecipeReferences(value, references, current = new Set()) {
  if (Array.isArray(value)) return value.map(v => resolveRecipeReferences(v, references, current));
  if (!value || typeof value !== 'object') return value;
  if ('$ref' in value) {
    const [step, field] = value.$ref.split('.');
    if (current.has(step)) return value;
    assert.ok(references[step]?.[field] !== undefined, 'Missing recipe reference: ' + value.$ref);
    return references[step][field];
  }
  return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, resolveRecipeReferences(v, references, current)]));
}

export async function authorWithNativePicks(steps, invoke) {
  const references = {};
  for (const step of steps) {
    const bound = await bindNativeEdgePicks([resolveRecipeReferences(step, references)],
      (body_id, offset) => invoke('aether_cad_topology', { body_id, offset, limit: 5 }));
    const result = await invoke('aether_cad_run_program', { program_json: JSON.stringify({ version: 1, steps: bound }) });
    Object.assign(references, result.steps);
  }
  return references;
}
