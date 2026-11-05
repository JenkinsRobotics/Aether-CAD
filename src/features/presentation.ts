import { cadRibbonWorkspaces } from '../tools';

/** Editor headers use the same names and artwork as the commands that open them. */
export function featurePresentation(type: string): { label: string; icon: string } {
  const tool = cadRibbonWorkspaces.flatMap(workspace => workspace.groups)
    .flatMap(group => group.tools).flatMap(tool => [tool, ...(tool.variants ?? [])]).find(tool => tool.action === `feature-${type}`);
  const labels: Record<string,string> = { 'offset-face': 'Move faces', 'face-extrude': 'Push/Pull', 'boundary-fill': 'Enclose' };
  const icons: Record<string,string> = { 'import-cad': 'import', profile: 'sketch' };
  return {
    label: labels[type] ?? tool?.label ?? type.split('-').map(word => word[0].toUpperCase()+word.slice(1)).join(' '),
    icon: icons[type] ?? tool?.icon ?? type,
  };
}
