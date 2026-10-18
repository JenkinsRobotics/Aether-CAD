import {resolveExtrusionScopes} from '../modeling/extrusion-scope-resolution';
/** Saved CAD commands reuse the editor document contracts and native translator. */
import { parsePartDocument, serializePartDocument, setFeatureSuppressed, moveFeature, availableBodies, rollbackPosition, validatePartDocument, type PartDocument } from '@aether/core/document';
import { translateDocument } from '../freecad-translate';
import { resolveBodyOutputs } from '../modeling/body-outputs';
import { resolveSketchFrames } from '../modeling/sketch-support';
import type { SketchFrame } from '@aether/core/sketch';

export interface Arguments { feature_id?: string; angle_deg?: number; second_angle_deg?: number; symmetric?: boolean; reversed?: boolean; depth_mm?: number; end_offset_mm?: number; action?: 'suppress' | 'unsuppress'; direction?: number }
const writes = new Set(['cad.revolve.setextent', 'cad.extrude.setoffset', 'cad.extrude.setdepth', 'cad.feature.suppress', 'cad.feature.move']);
const supported = new Set(['cad.revolve.preview', 'cad.part.inspect', 'cad.part.evaluate', 'cad.part.verify', 'cad.part.topology', 'cad.extrude.preview', 'cad.extrude.previewoffset', ...writes]);
function describe(doc: PartDocument) {
  return { name: doc.name, document_id: doc.documentId, units: doc.units, rollback_index: rollbackPosition(doc),
    bodies: availableBodies(doc), features: doc.features.map(f => ({ id: f.id, name: f.name, type: f.type, suppressed: f.suppressed,
      ...(f.type === 'revolve' ? {angle_deg:f.angleDegrees, second_angle_deg:f.secondAngleDegrees ?? 0, symmetric:f.symmetric ?? false, reversed:f.reversed ?? false, axis:f.axis, operation:f.operation} : {}),
      ...(f.type === 'extrude' ? { depth_mm: f.distanceMillimeters, end_offset_mm: f.endOffsetMillimeters ?? 0, operation: f.operation, end_type: f.endType ?? 'blind', target_body_id: f.targetBodyId, end_part_id: f.endPartId, end_point_reference: f.endPointReference, scope_mode:f.scopeMode,scope_resolution:f.scopeResolution,starting_reference:f.startingReference, starting_offset_mm:f.startingOffsetMillimeters??0 } : {}) })) };
}
export function prepareCommand(command: string, content: string, args: Arguments) {
  if (!supported.has(command)) throw Error('Unknown CAD command.');
  const doc = parsePartDocument(content);
  if (doc.features.length > 512) throw Error('CAD automation supports at most 512 features.');
  if (command === 'cad.part.inspect') return { result: describe(doc) };
  let next = structuredClone(doc);
  if (!['cad.part.evaluate', 'cad.part.verify', 'cad.part.topology'].includes(command)) {
    if (rollbackPosition(doc) !== doc.features.length) throw Error('Move the rollback bar to the end before editing this saved part.');
    const index = doc.features.findIndex(f => f.id === args.feature_id);
    if (index < 0) throw Error('Feature not found. Inspect the part first.');
    const feature = doc.features[index];
    if (command.startsWith('cad.revolve.')) {
      if (feature.type !== 'revolve' || feature.suppressed) throw Error('Select an unsuppressed Revolve feature.');
      if (typeof args.angle_deg !== 'number' || !Number.isFinite(args.angle_deg) || typeof args.second_angle_deg !== 'number' || !Number.isFinite(args.second_angle_deg) || typeof args.symmetric !== 'boolean' || typeof args.reversed !== 'boolean')
        throw Error('Specify the angle, opposite angle, symmetric and reverse settings.');
      if (feature.angleDegrees !== args.angle_deg || (feature.secondAngleDegrees ?? 0) !== args.second_angle_deg || (feature.symmetric ?? false) !== args.symmetric || (feature.reversed ?? false) !== args.reversed) {
        const updated = {...feature, angleDegrees:args.angle_deg};
        delete updated.secondAngleDegrees; delete updated.symmetric; delete updated.reversed;
        if (args.second_angle_deg) updated.secondAngleDegrees = args.second_angle_deg;
        if (args.symmetric) updated.symmetric = true;
        if (args.reversed) updated.reversed = true;
        next.features[index] = updated;
      }
    } else if (command.startsWith('cad.extrude.')) {
      if (feature.type !== 'extrude') throw Error('Select an Extrude feature.');
      if (feature.suppressed) throw Error('Unsuppress this extrusion before changing its depth.');
      if (command.endsWith('offset')) {
        if (!['up-to-next','up-to-face','up-to-part','up-to-vertex'].includes(feature.endType??'')) throw Error('End offset requires a supported stopping limit.');
        if (typeof args.end_offset_mm !== 'number' || !Number.isFinite(args.end_offset_mm) || Math.abs(args.end_offset_mm) > 1e6) throw Error('End offset must be finite and within 1000000 mm.');
        if ((feature.endOffsetMillimeters ?? 0) !== args.end_offset_mm) {
          const updated = { ...feature };
          if (args.end_offset_mm === 0) delete updated.endOffsetMillimeters;
          else updated.endOffsetMillimeters = args.end_offset_mm;
          next.features[index] = updated;
        }
      } else {
      if (!['blind', 'symmetric'].includes(feature.endType ?? 'blind')) throw Error('This end condition is not controlled by a depth.');
      if (typeof args.depth_mm !== 'number' || !Number.isFinite(args.depth_mm) || args.depth_mm <= 0 || args.depth_mm > 1e6) throw Error('Depth must be greater than zero and at most 1000000 mm.');
      next.features[index] = { ...feature, distanceMillimeters: args.depth_mm };
      }
    } else if (command === 'cad.feature.suppress') {
      if (!['suppress', 'unsuppress'].includes(args.action ?? '')) throw Error('Choose suppress or unsuppress.');
      next = setFeatureSuppressed(doc, feature.id, args.action === 'suppress');
    } else {
      if (args.direction !== -1 && args.direction !== 1) throw Error('Move one history position up or down.');
      next = moveFeature(doc, feature.id, args.direction);
    }
  }
  validatePartDocument(next);
  const translation = translateDocument(next);
  if (!translation.complete) throw Error('The native engine cannot evaluate the complete part: ' + translation.untranslated.map(f => `${f.name}: ${f.reason}`).join('; ').slice(0, 1500));
  const candidate = serializePartDocument(next);
  return { result: { ...describe(next), preview: command.startsWith('cad.extrude.preview') || command === 'cad.revolve.preview', pixel_preview: false },
    features: translation.features,
    candidate, changed: writes.has(command) && candidate !== serializePartDocument(doc) };
}
export function finalizeCandidate(content: string, outputs: Record<string,string[]>, frames: Record<string, SketchFrame> = {},scopes:Record<string,import("@aether/core/document").ExtrusionScopeResolution>={}) {
  return serializePartDocument(resolveExtrusionScopes(resolveSketchFrames(resolveBodyOutputs(parsePartDocument(content), outputs), frames),scopes));
}
