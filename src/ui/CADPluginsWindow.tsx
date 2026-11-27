import { useEffect, useRef, useState } from 'react';
import { AetherIcon, Button, Dialog } from '@aether/ui';
import './CADPluginsWindow.css';

export function CADPluginsIcon() {
  return <span className="cad-plugins-icon" aria-hidden="true"><AetherIcon name="grid-2"/><AetherIcon name="plus"/></span>;
}

/** Studio is an optional source. Never substitute localStorage for installed runtime state. */
export function CADPluginsWindow({ onClose }: { onClose: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const receive = (event: MessageEvent) => { if (event.origin === location.origin && event.source === frame.current?.contentWindow && event.data?.type === 'aether-close-plugins') onClose(); };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [onClose]);
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!location.pathname.startsWith('/cad/')) { setState('unavailable'); return; }
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 8000);
    fetch('/api/status', { credentials: 'same-origin', signal: abort.signal }).then(async response => {
      if (!response.ok) throw new Error('Unavailable');
      const status = await response.json();
      if (!status.user || !status.apps?.some((app: { id: string; enabled: boolean }) => app.id === 'cad' && app.enabled)) throw new Error('Unavailable');
      setState('ready');
    }).catch(() => { if (!abort.signal.aborted) setState('unavailable'); })
      .finally(() => clearTimeout(timeout));
    const deadline = setTimeout(() => setState(previous => previous === 'loading' ? 'unavailable' : previous), 8100);
    return () => { abort.abort(); clearTimeout(timeout); clearTimeout(deadline); };
  }, [attempt]);
  return <Dialog open title="Plugins" onClose={onClose}><div className="cad-plugins-window">
    {state === 'ready' ? <iframe ref={frame} title="Aether CAD plugins" src="/?pluginApp=cad"/> : <div className="cad-plugins-window__notice" role="status"><CADPluginsIcon/><h2>Aether CAD plugins</h2>
      <p>{state === 'loading' ? 'Loading available plugins…' : 'Studio’s plugin catalog is unavailable. Standalone plugin installation is not implemented yet.'}</p>
      {state === 'unavailable' && <Button onClick={() => { setState('loading'); setAttempt(value => value + 1); }}>Try again</Button>}
    </div>}
  </div></Dialog>;
}
