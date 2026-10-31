import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createRectanglePartDocument, type PartDocument } from '@aether/core/document';
import { ToolIcon } from '@aether/ui';
import { cadCommands, isCADCommandID, type CADCommandID } from '../src/cad-command-registry';
import { cadRibbonWorkspaces, type CADToolDefinition } from '../src/tools';
import { mountFeatureAuthoring } from '../src/feature-authoring';

/** The live CAD feature windows, opened by the same commands the ribbon runs,
 *  on a sample box Part. Nothing here re-describes a window: what CAD shows is
 *  what this page shows. Apply is a no-op; the sample document never changes. */
const sample: PartDocument = createRectanglePartDocument('Sample part', { widthMillimeters: 40, heightMillimeters: 30, depthMillimeters: 20 });
let mounted = false;

type Entry = { id: string; label: string; icon: CADToolDefinition['icon']; command: CADCommandID };
type Section = { id: string; label: string; entries: Entry[] };

function sections(registered: Readonly<Record<CADCommandID, { registered: boolean }>>): Section[] {
  const seen = new Set<string>();
  return cadRibbonWorkspaces.map(workspace => {
    const entries: Entry[] = [];
    const add = (tool: CADToolDefinition) => {
      if (tool.action && isCADCommandID(tool.action) && registered[tool.action]?.registered && !seen.has(tool.action)) {
        seen.add(tool.action);
        entries.push({ id: tool.id, label: tool.label, icon: tool.icon, command: tool.action });
      }
      tool.variants?.forEach(add);
    };
    workspace.groups.forEach(group => group.tools.forEach(add));
    return { id: workspace.id, label: workspace.label, entries };
  }).filter(section => section.entries.length);
}

function closeWindows() {
  for (const win of document.querySelectorAll<HTMLElement>('.aui-feature-window'))
    win.querySelector<HTMLButtonElement>('[data-feature-action="discard"]')?.click();
  document.querySelectorAll('.aui-feature-window').forEach(win => win.remove());
}

export function LiveFeatureEditors({ search }: { search: string }) {
  const stage = useRef<HTMLDivElement>(null);
  const pending = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState<string>();
  const state = useSyncExternalStore(cadCommands.subscribe, cadCommands.snapshot);
  useEffect(() => {
    // feature-authoring anchors its windows to the CAD viewport element.
    if (!mounted) { mountFeatureAuthoring(() => sample, async () => {}); mounted = true; }
    setReady(true);
    return closeWindows;
  }, []);
  const list = useMemo(() => sections(state).map(section => ({ ...section,
    entries: section.entries.filter(entry => entry.label.toLowerCase().includes(search.trim().toLowerCase())) }))
    .filter(section => section.entries.length), [state, search]);
  const [notice, setNotice] = useState('');
  const show = (entry: Entry) => {
    closeWindows(); setOpen(entry.id); setNotice(''); clearTimeout(pending.current);
    cadCommands.execute(entry.command);
    // Exports and paste run straight away in the app; say so rather than show an empty stage.
    pending.current = setTimeout(() => { if (!stage.current?.querySelector('.aui-feature-window')) setNotice(`${entry.label} runs without a feature window.`); }, 1500);
  };
  useEffect(() => { if (ready && !open) { const first = list.flatMap(section => section.entries).find(entry => entry.command === 'feature-extrude'); if (first) setTimeout(() => show(first)); } }, [ready]); // after the commit: the window renders its header synchronously // eslint-disable-line react-hooks/exhaustive-deps
  const count = list.reduce((sum, section) => sum + section.entries.length, 0);
  return <div className="cad-live-editors">
    <nav className="cad-live-list" aria-label={`CAD feature windows · ${count}`}>
      {list.map(section => <section key={section.id} aria-label={section.label}>
        <h2>{section.label}</h2>
        {section.entries.map(entry => <button key={entry.id} type="button" aria-pressed={open === entry.id} onClick={() => show(entry)}>
          <ToolIcon name={entry.icon} />{entry.label}</button>)}
      </section>)}
      {!count && <p role="status">No feature windows match “{search}”.</p>}
    </nav>
    {/* The class is the one feature-authoring looks for, so windows open here exactly as in the app. */}
    <div className="cad-studio-viewport cad-live-stage" ref={stage} aria-label="Feature window">
      {notice && <p className="cad-live-notice" role="status">{notice}</p>}
    </div>
  </div>;
}
