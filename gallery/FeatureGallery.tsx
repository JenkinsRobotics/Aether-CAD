import { useState } from 'react';
import { TransformGizmoDemo } from './TransformGizmoDemo';
import { LiveFeatureEditors } from './LiveFeatureEditors';
import './gallery.css';

export function FeatureGallery({ embedded = false }: { embedded?: boolean }) {
  const [tab, setTab] = useState('features');
  const [search, setSearch] = useState('');
  return <main className="cad-reference-gallery">
    <header className="cad-reference-heading">
      <div><h1>CAD feature windows</h1><p>The live Aether CAD windows, opened by the ribbon's own commands on a sample Part. Apply does not change anything.</p></div>
      {!embedded && <a href="/ui/#tab=apps">Back to Aether UI ↗</a>}
    </header>
    <nav className="cad-reference-toolbar" aria-label="CAD demo categories">
      <a href="./test-window.html">Native CAD test window ↗</a>
      <button type="button" aria-pressed={tab === 'features'} onClick={() => setTab('features')}>Feature windows</button>
      <button type="button" aria-pressed={tab === 'viewport'} onClick={() => setTab('viewport')}>Viewport tools</button>
      {tab === 'features' && <input type="search" aria-label="Search CAD feature demos" placeholder="Find a feature…" value={search} onChange={event => setSearch(event.target.value)} />}
    </nav>
    {tab === 'features' ? <>
      <LiveFeatureEditors search={search} />
    </> : <section aria-label="CAD viewport tools"><h2>Transform gizmo</h2><TransformGizmoDemo /></section>}
  </main>;
}
