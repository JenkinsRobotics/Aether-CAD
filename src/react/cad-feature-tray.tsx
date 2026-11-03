import { ToolIcon, type CommandPaletteCommand } from '@aether/ui';
import { cadFeatureDomains, cadFeatureGroups, expandFeatureTools } from '../tools/feature-library';
import { cadToolAvailability, type CADToolContext } from '../tools/availability';

/** Command search lists every feature by domain (there is no catch-all Features tab: a tool is
 *  listed once, on its own ribbon tab); aliases sharing an action remain keywords. */
export function cadFeaturePalette(context: CADToolContext, existing: readonly CommandPaletteCommand[]): CommandPaletteCommand[] {
  const result = new Map<string, CommandPaletteCommand>();
  for (const domain of cadFeatureDomains) for (const group of cadFeatureGroups(domain.id)) {
    for (const definition of expandFeatureTools(group.tools)) {
      const id = definition.action ?? `unavailable:${definition.id}`;
      const previous = result.get(id);
      const keywords = [domain.label, group.label, definition.label, definition.id];
      if (previous) { previous.keywords = [...(previous.keywords ?? []), ...keywords]; continue; }
      const state = cadToolAvailability(definition, context);
      result.set(id, { id, label: definition.label, category: domain.label, description: `${group.label} · ${domain.description}`,
        keywords, icon: <ToolIcon name={definition.icon}/>, disabled: state.disabled, disabledReason: state.reason });
    }
  }
  for (const command of existing) {
    const canonical = result.get(command.id);
    result.set(command.id, canonical ? { ...canonical, shortcut: command.shortcut, recent: command.recent,
      keywords: [...(canonical.keywords ?? []), command.label, ...(command.keywords ?? [])] } : command);
  }
  return [...result.values()];
}
