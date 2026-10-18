import { isCADCommandID, type CADCommandID, type CADCommandState } from '../cad-command-registry';
import type { CADToolDefinition } from './shared';

export interface CADToolContext {
  commands: Readonly<Record<CADCommandID, CADCommandState>>;
  partOpen: boolean;
  assemblyReady: boolean;
}

/** Ribbon, feature tray and search must apply the same guards. */
export function cadToolAvailability(definition: CADToolDefinition, context: CADToolContext): { disabled: boolean; reason?: string } {
  if (!definition.action) return { disabled: true, reason: definition.unavailableReason ?? 'Not implemented.' };
  if (isCADCommandID(definition.action)) {
    const state = context.commands[definition.action];
    if (!state?.registered) return { disabled: true, reason: 'Command is not connected to the current CAD session.' };
    if (!state.enabled) return { disabled: true, reason: definition.id === 'insert-svg' || definition.id === 'insert-dxf'
      ? 'Open a sketch to insert editable vector geometry on its plane.' : 'Command requires an applicable selection or open document.' };
    return { disabled: false };
  }
  if (definition.action === 'save-assembly' && !context.assemblyReady)
    return { disabled: true, reason: 'Create or open a persistent Assembly before saving it.' };
  if (definition.action === 'show-export' && !context.partOpen)
    return { disabled: true, reason: 'Create or open a Part before opening model export.' };
  return { disabled: false };
}
