import { useSyncExternalStore } from 'react';
import { historyPlayback } from './playback';
import './playback.css';

export function HistoryPlaybackControls() {
  const state=useSyncExternalStore(historyPlayback.subscribe,historyPlayback.snapshot,historyPlayback.snapshot);
  const active=state.status!=='idle', playing=state.status==='playing';
  return <div className="cad-history-playback" aria-label="History playback">
    <div className="cad-history-playback-controls">
      <button type="button" disabled={!state.available} aria-label={playing?'Pause history playback':state.status==='paused'?'Resume history playback':'Play feature history'}
        title="Replay native feature history without changing or saving the document"
        onClick={()=>playing?historyPlayback.pause():historyPlayback.play()}>{playing?'Ⅱ':'▶'} <span>{playing?'Pause':state.status==='paused'?'Resume':'Play'}</span></button>
      <button type="button" disabled={!active} aria-label="Stop history playback" title="Stop and return to the current model" onClick={()=>historyPlayback.stop()}>■</button>
      <select aria-label="History playback speed" value={state.speed} onChange={event=>historyPlayback.setSpeed(Number(event.target.value))}>
        {[.5,1,2,4].map(speed=><option key={speed} value={speed}>{speed}×</option>)}
      </select>
      {active&&<span className="cad-history-playback-count">{state.index} / {state.total}</span>}
    </div>
    {active&&<>
      <div className="cad-history-playback-step" role="status" aria-live="polite">
        <strong>{state.label}</strong><span>{state.pending?'Building…':state.status==='complete'?'Complete':state.status==='paused'?'Paused':''}</span>
      </div>
      <progress aria-label="Feature playback progress" value={state.index} max={state.total||1}/>
      {state.buildMilliseconds!==null&&<small className="cad-history-playback-timing">Build {state.buildMilliseconds.toFixed(0)} ms{state.presentationMilliseconds!==null?` · Present ${state.presentationMilliseconds.toFixed(0)} ms`:''}</small>}
      {state.error&&<p role="alert">{state.error}</p>}
    </>}
  </div>;
}
