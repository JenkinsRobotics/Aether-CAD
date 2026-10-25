/** Panel menus are projections of registered commands and current tree rows. */
import { useSyncExternalStore } from 'react';
import type { MenuItem, TreeNode } from '@aether/ui';
import { cadCommands, type CADCommandID, type CADCommandState } from '../../cad-command-registry';
import { cadWorkspace } from '../../cad-workspace-store';
import { cadPresentation } from '../../cad-presentation-store';
import { cadViewportContext } from '../../viewport/context-menu';

type CommandSpec = readonly [CADCommandID, string];
const solid: readonly CommandSpec[] = [
  ['feature-extrude','Extrude…'], ['feature-revolve','Revolve…'], ['feature-sweep','Sweep…'], ['feature-loft','Loft…'],
  ['feature-fillet','Fillet…'], ['feature-chamfer','Chamfer…'], ['feature-hole','Hole…'], ['feature-shell','Shell…'],
  ['feature-boolean','Boolean…'], ['feature-split','Split…'], ['feature-mirror','Mirror…'], ['feature-pattern','Pattern…'],
  ['feature-transform','Transform…'], ['feature-offset-face','Move face…'], ['feature-draft','Draft…'],
];
const reference: readonly CommandSpec[] = [
  ['feature-plane','Offset plane…'], ['construction-plane-angle','Plane at angle…'], ['construction-plane-mid','Midplane…'],
  ['construction-plane-three-point','Plane through three points…'], ['construction-axis-edge','Axis through edge…'],
  ['construction-axis-two-points','Axis through two points…'], ['construction-point-vertex','Point at vertex…'],
  ['construction-point-center','Center point…'],
];
const views: readonly CommandSpec[] = [
  ['view-isometric','Isometric'], ['view-top','Top'], ['view-bottom','Bottom'], ['view-front','Front'],
  ['view-back','Back'], ['view-right','Right'], ['view-left','Left'], ['fit-view','Frame all'],
];
const display: readonly CommandSpec[] = [
  ['display-shaded','Shaded'], ['display-shaded-edges','Shaded with edges'], ['display-wireframe','Wireframe'],
  ['display-hidden-line','Hidden line'], ['display-ghost','Ghost'], ['section-view','Section view…'],
];
export function registeredPanelCommands(states: Readonly<Record<CADCommandID, CADCommandState>>, specs: readonly CommandSpec[]): MenuItem[] {
  return specs.filter(([id]) => states[id]?.registered).map(([id, label]) => ({
    id: `command:${id}`, label, disabled: !states[id].enabled,
    ...(id.startsWith('display-') ? {kind:'radio' as const, checked:states[id].active} : {}),
  }));
}
function flatten(nodes: readonly TreeNode[]): TreeNode[] { return nodes.flatMap(node => [node, ...flatten(node.children ?? [])]); }

export function useCADPanelContext(nodes: readonly TreeNode[], scope: 'features' | 'parts' | 'assembly' = 'features') {
  const states = useSyncExternalStore(cadCommands.subscribe, cadCommands.snapshot, cadCommands.snapshot);
  const presentation = useSyncExternalStore(cadPresentation.subscribe, cadPresentation.snapshot, cadPresentation.snapshot);
  const rows = flatten(nodes), bodies = rows.filter(row => row.id.startsWith('feature/body/'));
  const blocked = presentation.loading || !presentation.partOpen;
  const actions = new Map<string, () => void>();
  const local = (id: string, label: string, run: () => void, disabled = false): MenuItem => {
    actions.set(id, run); return {id, label, disabled};
  };
  const commandGroup = (id: string, label: string, specs: readonly CommandSpec[]): MenuItem[] => {
    const children = registeredPanelCommands(states, specs); return children.length ? [{id, label, children}] : [];
  };
  const items: MenuItem[] = scope === 'assembly'
    ? registeredPanelCommands(states, [['assembly-insert-component','Insert component…'], ['assembly-insert-standard-part','Insert standard part…']])
    : [
      ...registeredPanelCommands(states, [['feature-profile','New sketch…'], ['feature-import-cad','Import CAD…']]),
      ...commandGroup('solid', 'Solid features', solid),
      ...commandGroup('reference', 'Reference geometry', reference),
    ];
  if (scope === 'features') {
    const referenceRows = rows.filter(row => row.id.startsWith('reference/') && row.actions?.some(action => action.id === 'toggle-visibility'));
    if (referenceRows.length) items.push({id:'reference-visibility',label:'Reference visibility',separatorBefore:true,children:referenceRows.map(row => {
      const action = row.actions!.find(action => action.id === 'toggle-visibility')!;
      return local(`visibility:${row.id}`, action.label, () => cadWorkspace.dispatch({type:'item-action',id:row.id,actionID:action.id}), Boolean(row.disabled));
    })});
    items.push(local('roll-end','Roll to end',() => {
      const count = cadWorkspace.snapshot().historyItems.filter(row => row.id.startsWith('history/feature/')).length;
      cadWorkspace.dispatch({type:'rollback-to',index:count});
    }, Boolean(blocked)));
  }
  if (scope === 'parts') {
    items.push({...local('show-parts','Show all parts',() => { void cadViewportContext.setVisibility(bodies.map(row => row.id.slice(13)),true); },Boolean(blocked || !bodies.some(row => row.dimmed))),separatorBefore:true});
    items.push(local('hide-parts','Hide all parts',() => { void cadViewportContext.setVisibility(bodies.map(row => row.id.slice(13)),false); },Boolean(blocked || !bodies.some(row => !row.dimmed))));
    items.push(local('exit-isolation','Exit isolation',() => cadViewportContext.isolate(null),!bodies.length));
  }
  items.push(...commandGroup('camera','Camera views',views),...commandGroup('display','Display style',display));
  return {items, run: (id:string) => {
    if (id.startsWith('command:')) { cadCommands.execute(id.slice(8) as CADCommandID); return; }
    const find = (entries: readonly MenuItem[]): MenuItem | undefined => entries.flatMap(entry => [entry,...(entry.children ?? [])]).find(entry => entry.id === id);
    if (!find(items)?.disabled) actions.get(id)?.();
  }};
}
