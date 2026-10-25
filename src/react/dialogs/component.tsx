/** Choose real geometry; insertion and drag/drop share one validated command. */
import { useEffect, useRef, useState } from 'react';
import { AetherIcon, Button, Checkbox, CoordinateFields, Dialog, Tabs, TextField } from '@aether/ui';
import { type CADPresentationSnapshot, cadPresentation } from '../../cad-presentation-store';
import { CADQuantityField } from '../CADQuantityField';
import { currentInsertCandidates, insertAssemblySource, assemblyInsertionAvailable } from '../../assembly/insertion-session';
import { listInsertFiles, savedInsertCandidates, type SavedInsertFile } from '../../assembly/insertion-sources';
import type { InsertCandidate } from '../../assembly/insertion';
import './component.css';

export function AssemblyComponentDialog({ presentation }: { presentation: CADPresentationSnapshot }) {
  return presentation.startDialog === 'insert-component' ? <AssemblyInsertPicker/> : null;
}
function AssemblyInsertPicker() {
  const [scope, setScope] = useState('design');
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<InsertCandidate[]>(currentInsertCandidates);
  const [files, setFiles] = useState<SavedInsertFile[]>([]);
  const [file, setFile] = useState<SavedInsertFile | null>(null);
  const [selected, setSelected] = useState<InsertCandidate | null>(null);
  const [positionM, setPosition] = useState<[number, number, number]>([0, 0, 0]);
  const [grounded, setGrounded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const serial = useRef(0);
  const abort = useRef(new AbortController());
  const close = () => { abort.current.abort(); cadPresentation.dispatch({ type: 'show-start-dialog', dialog: null }); };
  useEffect(() => () => { abort.current.abort(); serial.current++; }, []);
  useEffect(() => {
    let live = true; setPreview(null);
    if (selected?.document) void import('../../preview-document').then(({ previewDocument }) =>
      previewDocument(JSON.stringify(selected.document))).then(image => { if (live) setPreview(image); }).catch(() => {});
    return () => { live = false; };
  }, [selected]);
  const changeScope = async (next: string) => {
    if (busy) return;
    if (next === 'standard') { cadPresentation.dispatch({ type: 'show-start-dialog', dialog: 'insert-standard-part' }); return; }
    const request = ++serial.current;
    setScope(next); setFile(null); setSelected(null); setQuery(''); setError(''); setLoading(false);
    setCandidates(next === 'design' ? currentInsertCandidates() : []);
    if (next !== 'saved') return;
    setLoading(true);
    try { const result = await listInsertFiles(); if (request === serial.current) setFiles(result); }
    catch (error) { if (request === serial.current) setError(String(error)); }
    finally { if (request === serial.current) setLoading(false); }
  };
  const chooseFile = async (next: SavedInsertFile) => {
    const request = ++serial.current;
    setFile(next); setSelected(null); setQuery(''); setError(''); setLoading(true); setCandidates([]);
    try { const result = await savedInsertCandidates(next.id, next.revision); if (request === serial.current) setCandidates(result); }
    catch (error) { if (request === serial.current) setError(String(error)); }
    finally { if (request === serial.current) setLoading(false); }
  };
  const insert = async () => {
    if (!selected?.source || busy) return;
    setBusy(true); setError('');
    try { await insertAssemblySource(selected.source, { positionM, grounded }, abort.current.signal); close(); }
    catch (error) { if (!abort.current.signal.aborted) setError(error instanceof Error ? error.message : String(error)); }
    finally { if (!abort.current.signal.aborted) setBusy(false); }
  };
  const showingFiles = scope === 'saved' && !file;
  const match = (name: string) => name.toLowerCase().includes(query.toLowerCase());
  const shownCandidates = candidates.filter(item => match(item.name));
  const shownFiles = files.filter(item => match(item.name));
  return <Dialog open title="Insert parts" onClose={close} actions={<>
    <Button onClick={close}>{busy ? 'Cancel insertion' : 'Cancel'}</Button>
    <Button primary disabled={!selected?.source || !!selected.unavailable || busy || loading || !assemblyInsertionAvailable()}
      onClick={() => void insert()}>{busy ? 'Inserting…' : 'Insert Part'}</Button>
  </>}>
    <div className="cad-assembly-insert">
      <Tabs activeID={scope} onSelect={next => void changeScope(next)} tabs={[
        { id: 'design', label: 'This design' }, { id: 'saved', label: 'Other designs' }, { id: 'standard', label: 'Standard parts' },
      ]}/>
      {file && <div className="cad-insert-source-path"><Button disabled={busy} onClick={() => void changeScope('saved')}><AetherIcon name="chevron-left"/> Designs</Button><span title={file.name}>{file.name} · Revision {file.revision}</span></div>}
      <TextField aria-label={showingFiles ? 'Search designs' : 'Search parts'} placeholder={showingFiles ? 'Search designs…' : 'Search parts…'}
        value={query} onChange={event => setQuery(event.target.value)}/>
      <div className="cad-insert-sources" aria-label="Insertion sources">
        {loading ? <p role="status">Loading saved designs…</p> : showingFiles ? shownFiles.map(item =>
          <Button key={item.id} disabled={busy} onClick={() => void chooseFile(item)}><AetherIcon name="folder"/><span>{item.name}</span><small>Revision {item.revision}</small></Button>)
          : shownCandidates.map(item => <Button key={item.id} disabled={busy || !!item.unavailable} title={item.unavailable ?? item.name}
            aria-pressed={selected?.id === item.id} onClick={() => setSelected(item)}>
            <AetherIcon name={item.kind === 'part' ? 'cube' : 'layers'}/><span>{item.name}<small>{item.unavailable ?? 'Part Studio'}</small></span>
          </Button>)}
        {!loading && !(showingFiles ? shownFiles : shownCandidates).length && <p>{showingFiles ? 'No saved Part or Hybrid designs found.' : 'No Parts found. Create a Part with a solid in this design, or choose Other designs.'}</p>}
      </div>
      {selected && <div className="cad-insert-preview">{preview ? <img src={preview} alt={`Preview of ${selected.name}`}/> : <AetherIcon name="cube"/>}<span>{selected.name}</span></div>}
      <CoordinateFields label="Position" fields={(['X', 'Y', 'Z'] as const).map((axis, index) => ({ axis, control:
        <CADQuantityField family="length" id={`assembly-position-${axis.toLowerCase()}`} aria-label={`Position ${axis}`} value={positionM[index]} step={0.001}
          scrubLabel={`Position ${axis}`} onValueChange={value => { if (value !== null) setPosition(current => current.map((v, i) => i === index ? value : v) as [number, number, number]); }}/>,
      }))}/>
      <Checkbox checked={grounded} onChange={event => setGrounded(event.target.checked)} label="Ground component"/>
      <p className="cad-form-note">{scope === 'design' ? 'Instances share this design’s Part. Drag a Part from Files into the viewport to insert it at the origin.' : 'Inserts an independent copy of the selected saved revision. The source design is unchanged.'}</p>
      {error && <p role="alert">{error}</p>}
    </div>
  </Dialog>;
}
