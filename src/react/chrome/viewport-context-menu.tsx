import { useSyncExternalStore } from 'react';
import { AetherIcon, Button, Dialog, FieldRow, Menu, Slider, type MenuItem } from '@aether/ui';
import { cadViewportContext } from '../../viewport/context-menu';
import { cadAppearance } from '../../cad-appearance-store';
import { resolveAppearance } from '../../viewport/appearance-themes';

const icons: Record<string, string> = {
  'show-all': 'visible', select: 'node-select', fit: 'fit', isometric: 'cube', edit: 'pencil',
  dimensions: 'ruler', dependencies: 'branch', hide: 'hidden', isolate: 'cube', 'exit-isolate': 'cube',
  transparent: 'cube-transparent', section: 'intersection', copy: 'copy', drawing: 'notes',
  export: 'export', 'select-other': 'node-select', comment: 'notes', 'fit-selection': 'fit',
  'delete-part': 'delete', 'delete-feature': 'delete', material: 'cube-filled', appearance: 'palette',
  'face-appearance': 'palette', 'surface-analysis': 'ruler', filter: 'filter',
};
const withIcons = (items: readonly MenuItem[]): MenuItem[] => items.map(item => ({ ...item,
  icon: icons[item.id.split(':')[0]] ? <AetherIcon name={icons[item.id.split(':')[0]]} /> : undefined,
  children: item.children && withIcons(item.children),
}));

export function ViewportContextMenu() {
  const { menu, detail } = useSyncExternalStore(cadViewportContext.subscribe, cadViewportContext.snapshot, cadViewportContext.snapshot);
  const appearance = useSyncExternalStore(cadAppearance.subscribe, cadAppearance.snapshot, cadAppearance.snapshot);
  const base = resolveAppearance(appearance);
  const color = detail?.kind === 'appearance' ? detail.value.color ?? `#${base.bodyColor.toString(16).padStart(6, '0')}` : '';
  return <>
    <Menu open={!!menu} anchor={menu?.anchor ?? null} items={withIcons(menu?.items ?? [])}
      applicationCommands={false} ariaLabel="Viewport options" onSelect={cadViewportContext.select} onClose={cadViewportContext.closeMenu} />
    <Dialog open={!!detail} title={detail?.kind === 'dependencies' ? `Dependencies of ${detail.name}` : `Appearance — ${detail?.name ?? ''}`}
      onClose={cadViewportContext.closeDetail} actions={<Button onClick={cadViewportContext.closeDetail}>Done</Button>}>
      {detail?.kind === 'dependencies' && <>
        <h3>Direct references</h3>
        {detail.parents.length ? <ul>{detail.parents.map((name, i) => <li key={i}>{name}</li>)}</ul> : <p>No earlier feature references.</p>}
        <h3>Dependent features</h3>
        {detail.children.length ? <ul>{detail.children.map((name, i) => <li key={i}>{name}</li>)}</ul> : <p>No later features depend on this feature.</p>}
        <p>The menu uses the latest feature affecting the part. Individual faces do not yet carry feature provenance.</p>
      </>}
      {detail?.kind === 'appearance' && <>
        <p>Changes affect only {detail.name} in this session. Saved part materials and per-face colors are not available yet.</p>
        <FieldRow label="Color" htmlFor="context-part-color"><input id="context-part-color" type="color" value={color}
          onChange={e => cadViewportContext.changeAppearance({ ...detail.value, color: e.target.value })} /></FieldRow>
        <FieldRow label="Opacity"><Slider ariaLabel="Part opacity" min={0} max={100} step={1} unit="%" value={Math.round((detail.value.opacity ?? base.bodyOpacity) * 100)}
          onChange={value => cadViewportContext.changeAppearance({ ...detail.value, opacity: value / 100 })} /></FieldRow>
        <FieldRow label="Roughness"><Slider ariaLabel="Part roughness" min={0} max={100} step={1} unit="%" value={Math.round((detail.value.roughness ?? base.finish.roughness) * 100)}
          onChange={value => cadViewportContext.changeAppearance({ ...detail.value, roughness: value / 100 })} /></FieldRow>
        <FieldRow label="Metallic"><Slider ariaLabel="Part metallic" min={0} max={100} step={1} unit="%" value={Math.round((detail.value.metalness ?? base.finish.metalness) * 100)}
          onChange={value => cadViewportContext.changeAppearance({ ...detail.value, metalness: value / 100 })} /></FieldRow>
        <Button onClick={() => cadViewportContext.changeAppearance({})}>Reset to viewport appearance</Button>
      </>}
    </Dialog>
  </>;
}
