import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createRectanglePartDocument, type PartDocument } from '@aether/core/document';
import { cadCommands, isCADCommandID, type CADCommandID } from '../src/cad-command-registry';
import { cadRibbonWorkspaces, type CADToolDefinition } from '../src/tools';
import { mountFeatureAuthoring } from '../src/feature-authoring';
import { mountSketch3DWorkspace } from '../src/sketch3d-workspace';
import { featureWindowStyle, setFeatureWindowStyle, type FeatureWindowStyle } from '../src/features/feature-window-style';

/** The live CAD feature windows, opened by the same commands the ribbon runs,
 *  on a sample box Part, every one in its own card so the whole set reads at a
 *  glance in either window design. Nothing here re-describes a window: what
 *  CAD shows is what this page shows. Apply is a no-op; the sample never changes. */
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

/** One card: the window modules anchor to `.cad-studio-viewport`, so the card's host
 *  carries that class only while its own command runs, and the window lands in it. */
function FeatureCard({ entry, style }: { entry: Entry; style: FeatureWindowStyle }) {
  const host = useRef<HTMLDivElement>(null);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const element = host.current!;
    for (const other of document.querySelectorAll('.cad-studio-viewport')) other.classList.remove('cad-studio-viewport');
    element.classList.add('cad-studio-viewport');
    cadCommands.execute(entry.command);
    element.classList.remove('cad-studio-viewport');
    // Exports and paste run straight away in the app; say so rather than show an empty card.
    const timer = setTimeout(() => setNotice(element.querySelector('.aui-feature-window, .cad-sketch3d-strip') ? '' : `${entry.label} runs without a feature window.`), 1500);
    return () => {
      clearTimeout(timer);
      element.querySelector<HTMLButtonElement>('[data-feature-action="discard"]')?.click();
      for (const button of element.querySelectorAll<HTMLButtonElement>('.cad-sketch3d-strip button')) if (button.textContent === 'Cancel') button.click();
      element.querySelectorAll('.aui-feature-window').forEach(win => win.remove());
    };
  }, [entry.command, style]);
  return <section className="cad-feature-card" aria-label={`${entry.label} editor`}>
    <header><h2>{entry.label}</h2></header>
    <div className="cad-feature-host" ref={host} data-style={style}>{notice && <p className="cad-live-notice" role="status">{notice}</p>}</div>
  </section>;
}

export function LiveFeatureEditors({ search }: { search: string }) {
  const [ready, setReady] = useState(false);
  const [style, setStyle] = useState<FeatureWindowStyle>(featureWindowStyle);
  const state = useSyncExternalStore(cadCommands.subscribe, cadCommands.snapshot);
  useEffect(() => {
    if (!mounted) {
      mountFeatureAuthoring(() => sample, async () => {});
      // The 3D sketch strip needs its viewport picks; here they return nothing.
      mountSketch3DWorkspace({ getDocument: () => sample, apply: async () => {}, pickPoint: () => null, showCurves: () => {}, selection: () => [] });
      mounted = true;
    }
    setReady(true);
  }, []);
  const list = useMemo(() => sections(state).map(section => ({ ...section,
    entries: section.entries.filter(entry => entry.label.toLowerCase().includes(search.trim().toLowerCase())) }))
    .filter(section => section.entries.length), [state, search]);
  const count = list.reduce((sum, section) => sum + section.entries.length, 0);
  const choose = (next: FeatureWindowStyle) => { setFeatureWindowStyle(next); setStyle(next); };
  return <div className="cad-live-editors">
    <nav className="cad-live-styles" aria-label="Feature window design">
      {(['compact', 'standard'] as const).map(option => <button key={option} type="button" aria-pressed={style === option} onClick={() => choose(option)}>
        {option === 'compact' ? 'Compact' : 'Standard'}</button>)}
      <span>{count} feature windows</span>
    </nav>
    {ready && list.map(section => <section key={section.id} className="cad-feature-section" aria-label={section.label}>
      <h2>{section.label}</h2>
      <div className="cad-feature-grid">{section.entries.map(entry => <FeatureCard key={entry.id} entry={entry} style={style} />)}</div>
    </section>)}
    {!count && <p role="status">No feature windows match “{search}”.</p>}
  </div>;
}
