import { useEffect, useRef, useState } from 'react';
import { AetherIcon, Button, FileIcon, IconButton, Menu, MenuButton, NewFileDialog, SelectField, type DocumentConnection, type MenuItem } from '@aether/ui';
import { driveRequest, editorURL, fileIcon, fileType, type DriveContext, type DriveFile } from '@aether/session/library/drive-api';
import { createNativeFile } from '@aether/session/library/create-native-file';
import { navigateDocument } from '../document-navigation';

type Place = { organization: string; workspace: string | null; parent: string | null; view: 'personal' | 'workspace' | 'shared' };
type Listing = { files: DriveFile[]; path: { id: string; name: string }[]; next?: string | null };
const createItems: MenuItem[] = [
  { id: 'project', label: 'New Hybrid design…' }, { id: 'part', label: 'New Part design…' },
  { id: 'assembly', label: 'New Assembly design…' }, { id: 'folder', label: 'New folder…', separatorBefore: true },
];
export function CADDriveBrowser({ documentID, connection }: { documentID: string | null; connection: DocumentConnection }) {
  const [context, setContext] = useState<DriveContext | null>(null);
  const [place, setPlace] = useState<Place | null>(null);
  const [listing, setListing] = useState<Listing>({ files: [], path: [] });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [creating, setCreating] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; file?: DriveFile } | null>(null);
  const serial = useRef(0);
  useEffect(() => {
    let live = true; setBusy(true); setError('');
    void (async () => {
      const next = await driveRequest<DriveContext>('context');
      const current = documentID ? await driveRequest<DriveFile>('details', { id: documentID }) : null;
      if (!live) return;
      setContext(next);
      setPlace(current ? { organization: current.organization, workspace: current.workspace, parent: current.parent,
        view: current.workspace ? 'workspace' : current.owner_id === next.user.id ? 'personal' : 'shared' }
        : { organization: next.organizations[0]?.id ?? 'all', workspace: null, parent: null, view: 'personal' });
    })().catch(error => { if (live) { setError(String(error)); setBusy(false); } });
    return () => { live = false; serial.current++; };
  }, [documentID, refresh]);
  const load = async (more = false) => {
    if (!place) return;
    const request = ++serial.current; setBusy(true); setError('');
    try {
      const result = await driveRequest<Listing>('list', { ...place, paged: true, limit: 100, ...(more ? { after: listing.next } : {}) });
      if (request === serial.current) setListing(previous => ({ ...result, files: more ? [...previous.files, ...result.files] : result.files }));
    } catch (error) { if (request === serial.current) setError(String(error)); }
    finally { if (request === serial.current) setBusy(false); }
  };
  useEffect(() => { setListing({ files: [], path: [] }); void load(); return () => { serial.current++; }; }, [place]);
  const run = async (operation: () => Promise<void>) => {
    setError(''); try { await operation(); } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
  };
  const open = (file: DriveFile) => void run(async () => {
    if (file.kind === 'folder') { setPlace({ organization: file.organization, workspace: file.workspace, parent: file.id,
      view: file.workspace ? 'workspace' : file.owner_id === context?.user.id ? 'personal' : 'shared' }); return; }
    await connection.flush();
    if (file.app === 'cad') await navigateDocument(editorURL(file));
    else location.assign(`/drive/?file=${encodeURIComponent(file.id)}`);
  });
  const action = (id: string) => {
    const file = menu?.file; setMenu(null);
    if (createItems.some(item => item.id === id)) setCreating(id);
    else if (id === 'refresh') void load();
    else if (id === 'open' && file) open(file);
    else if (id === 'drive') void run(async () => { await connection.flush(); location.assign(`/drive/${file ? '?file=' + encodeURIComponent(file.id) : ''}`); });
    else if (id === 'download' && file) {
      const link = document.createElement('a'); link.href = `/api/drive/download?id=${encodeURIComponent(file.id)}`; link.download = file.name; link.click();
    }
  };
  const items: MenuItem[] = menu?.file ? [
    { id: 'open', label: menu.file.kind === 'folder' ? 'Open folder' : menu.file.app === 'cad' ? 'Open design' : 'Open in Drive' },
    { id: 'drive', label: 'Details and sharing in Drive…' }, { id: 'download', label: 'Download', separatorBefore: true },
  ] : [...createItems, { id: 'refresh', label: 'Refresh', separatorBefore: true }, { id: 'drive', label: 'Open Aether Drive' }];
  const rootName = place?.workspace ? context?.workspaces.find(w => w.id === place.workspace)?.name ?? 'Workspace' : place?.view === 'shared' ? 'Shared files' : 'My files';
  return <section className="aui-tab-browser cad-drive-browser" aria-label="Drive files" onContextMenu={event => {
    if ((event.target as Element).closest('input,select,textarea,[role="menu"]')) return;
    event.preventDefault(); event.stopPropagation(); setMenu({ x: event.clientX, y: event.clientY });
  }}>
    <header className="aui-tab-browser-head"><h2>Drive</h2>
      <MenuButton label="Create in Drive" items={createItems} onSelect={setCreating} disabled={!place || busy}><AetherIcon name="plus"/></MenuButton>
      <IconButton label="Refresh Drive" onClick={() => place ? void load() : setRefresh(v => v + 1)}><AetherIcon name="refresh"/></IconButton>
      <IconButton label="Open Aether Drive" onClick={() => action('drive')}><AetherIcon name="open-external"/></IconButton>
    </header>
    {context && place && <SelectField aria-label="Drive location" value={place.workspace ?? `personal:${place.organization}`} onChange={event => {
      const ws = context.workspaces.find(w => w.id === event.target.value);
      setPlace(ws ? { organization: ws.organization, workspace: ws.id, parent: null, view: 'workspace' }
        : { organization: event.target.value.slice('personal:'.length), workspace: null, parent: null, view: 'personal' });
    }} options={[
      ...context.organizations.map(org => ({ value: `personal:${org.id}`, label: context.organizations.length > 1 ? `My files · ${org.name}` : 'My files' })),
      ...context.workspaces.map(ws => ({ value: ws.id, label: ws.name })),
    ]}/>}
    <nav className="aui-tab-browser-path" aria-label="Drive path">
      <button aria-label={`Back to ${rootName}`} disabled={!place?.parent} onClick={() => setPlace(p => p && ({ ...p, parent: null }))}><AetherIcon name="home"/></button>
      <span>{rootName}</span>{listing.path.map(folder => <span key={folder.id}><AetherIcon name="chevron-right"/><button onClick={() => setPlace(p => p && ({ ...p, parent: folder.id }))}>{folder.name}</button></span>)}
    </nav>
    {error && <p role="alert">{error}</p>}
    <ul className="aui-tab-browser-items">{[...listing.files].sort((a, b) => Number(b.kind === 'folder') - Number(a.kind === 'folder') || a.name.localeCompare(b.name)).map(file => <li key={file.id} data-drive-id={file.id} data-current={file.id === documentID || undefined}
      onContextMenu={event => { event.preventDefault(); event.stopPropagation(); setMenu({ file, x: event.clientX, y: event.clientY }); }}>
      <button className="aui-tab-browser-row" title={file.name} aria-current={file.id === documentID ? 'page' : undefined} onClick={() => open(file)}>
        <span className="aui-tab-browser-thumb"><FileIcon icon={fileIcon(file)}/></span>
        <span className="aui-tab-browser-text"><strong>{file.name}</strong><small>{fileType(file)}{file.kind === 'file' ? ` · Revision ${file.revision}` : ''}</small></span>
      </button>
      <IconButton label={`Options for ${file.name}`} onClick={event => { const r = event.currentTarget.getBoundingClientRect(); setMenu({ file, x: r.left, y: r.bottom }); }}><AetherIcon name="more"/></IconButton>
    </li>)}
    {!busy && !listing.files.length && <li className="aui-tab-browser-empty">This folder is empty.</li>}
    {busy && <li role="status">Loading files…</li>}
    {listing.next && <li><Button disabled={busy} onClick={() => void load(true)}>Load more</Button></li>}
    </ul>
    <Menu open={Boolean(menu)} anchor={menu} ariaLabel="Drive actions" items={items} onSelect={action} onClose={() => setMenu(null)}/>
    {creating && place && <NewFileDialog title={creating === 'folder' ? 'New Drive folder' : `New ${creating} design`} directory={[rootName, ...listing.path.map(p => p.name)].join(' / ')} onClose={() => setCreating(null)} onCreate={async name => {
      await connection.flush();
      const destination = { organization: place.organization, workspace: place.workspace, parent: place.parent };
      if (creating === 'folder') { await driveRequest('create', { ...destination, app: 'drive', kind: 'folder', name, data_base64: '' }); await load(); }
      else { const file = await createNativeFile<DriveFile>('cad', creating, name, destination, 'drive'); await navigateDocument(editorURL(file)); }
    }}/>}
  </section>;
}
