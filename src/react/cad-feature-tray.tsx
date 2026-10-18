import { ToolIcon, type CommandPaletteCommand, type MenuItem, type WorkspaceRibbonTab } from '@aether/ui';
import { cadFeatureDomains, cadFeatureGroups, expandFeatureTools } from '../tools/feature-library';
import { cadToolAvailability, type CADToolContext } from '../tools/availability';
import type { CADToolDefinition } from '../tools/shared';

export function cadFeatureTray(context: CADToolContext): WorkspaceRibbonTab {
  const itemFor=(definition:CADToolDefinition):MenuItem=>{
    const state=cadToolAvailability(definition,context);
    const item:MenuItem={id:`feature:${definition.id}`,label:definition.label,icon:<ToolIcon name={definition.icon}/>,disabled:state.disabled,disabledReason:state.reason};
    if(!definition.variants?.length)return item;
    return {id:`feature-family:${definition.id}`,label:definition.label,icon:item.icon,
      children:[item,...definition.variants.map(itemFor)]};
  };
  return { id: 'feature-library', label: 'Features', groups: cadFeatureDomains.map(domain => {
    const groups = cadFeatureGroups(domain.id);
    const items: MenuItem[] = groups.map(group => ({id:`feature-group:${group.id}`,label:group.label,
      children:group.tools.map(itemFor)}));
    const first = groups.flatMap(group => expandFeatureTools(group.tools)).find(tool => tool.action);
    const state = first && cadToolAvailability(first, context);
    return { id: `feature-${domain.id}`, label: domain.label, menuItems: items,
      tools: first ? [{ id: `feature:${first.id}`, label: first.label, icon: <ToolIcon name={domain.icon}/>, disabled: state?.disabled, disabledReason: state?.reason }] : [] };
  }) };
}

/** Search is a projection of the tray; aliases sharing an action remain keywords. */
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
