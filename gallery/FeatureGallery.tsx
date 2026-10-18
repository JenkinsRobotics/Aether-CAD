import { useEffect, useRef, useState } from 'react';
import { TransformGizmoDemo } from './TransformGizmoDemo';
import { buildSketchDemo, buildExtrudeDemo, buildRevolveDemo, buildSweepDemo, buildLoftDemo, buildThickenDemo, buildEncloseDemo, buildPlaneDemo, buildMateDemo } from './features';
import './gallery.css';

export const featureEditors = [
  { id: 'sketch', label: 'Sketch', build: buildSketchDemo },
  { id: 'extrude', label: 'Extrude', build: buildExtrudeDemo },
  { id: 'revolve', label: 'Revolve', build: buildRevolveDemo },
  { id: 'sweep', label: 'Sweep', build: buildSweepDemo },
  { id: 'loft', label: 'Loft', build: buildLoftDemo },
  { id: 'thicken', label: 'Thicken', build: buildThickenDemo },
  { id: 'enclose', label: 'Enclose', build: buildEncloseDemo },
  { id: 'plane', label: 'Plane', build: buildPlaneDemo },
  { id: 'mate', label: 'Mate', build: buildMateDemo },
] as const;
function FeaturePreview({ feature }: { feature: typeof featureEditors[number] }) {
  const host = useRef<HTMLDivElement>(null);
  const [reset, setReset] = useState(0);
  useEffect(() => {
    const el = host.current!;
    feature.build(el);
    const panel = el.querySelector<HTMLElement>('.aui-feature-window');
    if (panel) { panel.style.position = 'relative'; panel.style.top = '0'; panel.style.right = 'auto'; }
    return () => el.replaceChildren();
  }, [feature, reset]);
  return <section className="cad-feature-card" aria-label={`${feature.label} editor`}>
    <header><h2>{feature.label}</h2><button type="button" onClick={() => setReset(value => value + 1)} aria-label={`Reset ${feature.label} demo`}>Reset</button></header>
    <div className="cad-feature-preview" ref={host} data-aether-feature-host="true" />
  </section>;
}
export function FeatureGallery({ embedded = false }: { embedded?: boolean }) {
  const [tab, setTab] = useState('features');
  const [search, setSearch] = useState('');
  const shown = featureEditors.filter(feature => feature.label.toLowerCase().includes(search.trim().toLowerCase()));
  return <main className="cad-reference-gallery">
    <header className="cad-reference-heading">
      <div><h1>CAD feature collection</h1><p>Original interactive feature windows. Demo changes do not edit a document.</p></div>
      {!embedded && <a href="/ui/#tab=apps">Back to Aether UI ↗</a>}
    </header>
    <nav className="cad-reference-toolbar" aria-label="CAD demo categories">
      <a href="./test-window.html">Native CAD test window ↗</a>
      <button type="button" aria-pressed={tab === 'features'} onClick={() => setTab('features')}>Feature editors · 9</button>
      <button type="button" aria-pressed={tab === 'viewport'} onClick={() => setTab('viewport')}>Viewport tools</button>
      {tab === 'features' && <input type="search" aria-label="Search CAD feature demos" placeholder="Find a feature…" value={search} onChange={event => setSearch(event.target.value)} />}
    </nav>
    {tab === 'features' ? <>
      <div className="cad-feature-grid">{shown.map(feature => <FeaturePreview key={feature.id} feature={feature} />)}</div>
      {!shown.length && <p role="status">No feature editors match “{search}”.</p>}
    </> : <section aria-label="CAD viewport tools"><h2>Transform gizmo</h2><TransformGizmoDemo /></section>}
  </main>;
}
