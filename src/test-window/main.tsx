import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { PART_FILE_EXTENSION } from "@aether/core/document";
import { createRoot } from "react-dom/client";
import { Button, ViewportNavigationCube } from "@aether/ui";
import { MateViewport } from "../viewer";
import { defaultCADAppearance, type CADDisplayStyle, type CADAppearanceSnapshot } from "../cad-appearance-store";
import { cadViewportMetrics } from "../cad-viewport-metrics-store";
import { cadSelection } from "../cad-selection-store";
import { describeGeometryEngine } from "../freecad-geometry";
import { evaluateNativePart } from "../native-part-evaluator";
import { savePartDocument } from "../part-file";
import { CADTestController } from "./controller";
import { testWindowConnectionError } from "./connection";
import { sprocketParameterFields, sprocketParameterProblem, type SprocketParameters } from "./sprocket";
import "@aether/ui/tokens.css";
import "@aether/ui/widgets.css";
import "./test-window.css";

const controller = new CADTestController(evaluateNativePart);
// The product viewport lives for this dedicated document. The gallery embeds
// the document in an iframe, so removing it also tears down its GPU and events.
let viewport: MateViewport | undefined;
const themeQuery = new URLSearchParams(location.search).get("theme");
const initialTheme = themeQuery === "light" ? "light" : "dark";
// Explicit embed origin survives a Vite/document reload, whose referrer may
// become this iframe's own URL. Messages still require the actual parent source.
const embedOrigin = new URLSearchParams(location.search).get("parentOrigin");
const parentOrigin = (() => {
  try { return embedOrigin && /^https?:\/\//.test(embedOrigin) ? new URL(embedOrigin).origin : document.referrer ? new URL(document.referrer).origin : null; }
  catch { return null; }
})();

function testAppearance(theme: "light" | "dark", style: CADDisplayStyle): CADAppearanceSnapshot {
  return { ...defaultCADAppearance, environmentTheme: "custom", background: theme === "light" ? "cad-light" : "graphite",
    backgroundColor: theme === "light" ? "#f4f5f8" : "#20252e", edgeColor: theme === "light" ? "#222b3a" : "#c9d3e3",
    bodyColor: "#c1cfdf", edgeWidthPx: 1.6, edgeOpacityPercent: 100, colorTransform: "standard", displayStyle: style,
    floorMode: "none", contactShadowsVisible: false };
}

function TestWindow() {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const metrics = useSyncExternalStore(cadViewportMetrics.subscribe, cadViewportMetrics.snapshot);
  const selection = useSyncExternalStore(cadSelection.subscribe, cadSelection.snapshot);
  const host = useRef<HTMLDivElement>(null);
  const history = useRef<HTMLDivElement>(null);
  const [theme, setTheme] = useState<"light" | "dark">(initialTheme);
  const [orientation, setOrientation] = useState<readonly [number, number, number, number]>([0, 0, 0, 1]);
  const [style, setStyle] = useState<CADDisplayStyle>("hidden-line");
  const [orbit, setOrbit] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<SprocketParameters>(state.parameters);
  const [engine, setEngine] = useState("Connecting to native engine…");
  const [viewportError, setViewportError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const framed = useRef(false);
  const engineReady = useRef(false);
  const localRuntime = import.meta.env.MODE === "cad-test-window";
  const describeError = (error: string) => testWindowConnectionError(error, localRuntime);
  const refreshEngine = () => { void describeGeometryEngine().then(result => { engineReady.current = result.ok; setEngine(result.ok ? `${result.engine}${localRuntime ? " · local" : ""}` : result.error); }).catch(error => setEngine(describeError(String(error)))); };
  const busy = state.playing || state.checking;

  useEffect(() => {
    document.documentElement.dataset.aetherTheme = theme;
    document.documentElement.classList.toggle("aether-light-theme", theme === "light");
    viewport?.setAppearance(testAppearance(theme, style));
  }, [theme, style]);
  useEffect(() => {
    try {
      viewport = new MateViewport(host.current!, {
        onHover() {}, onStateChanged() {}, onMateApplied() {},
        onStatus(message, tone) { if (tone === "error") setNotice(message); },
        onCameraChanged: setOrientation,
      });
      viewport.setProjection("orthographic");
      viewport.setCameraView("isometric");
      viewport.setAppearance(testAppearance(initialTheme, "hidden-line"));
    } catch (error) { setViewportError(error instanceof Error ? error.message : String(error)); }
    const unsubscribe = cadSelection.subscribe(() => viewport?.refreshSelectionAppearance());
    const themeMessage = (event: MessageEvent) => {
      if (event.source !== parent || event.origin !== parentOrigin || event.data?.type !== "aether-cad-test-theme") return;
      if (event.data.theme === "light" || event.data.theme === "dark") setTheme(event.data.theme);
    };
    window.addEventListener("message", themeMessage);
    const resize = new ResizeObserver(() => {
      if (parentOrigin && parent !== window) parent.postMessage({ type: "aether-cad-test-height", height: Math.ceil(document.getElementById("root")!.getBoundingClientRect().height) + 24 }, parentOrigin);
    });
    resize.observe(document.getElementById("root")!);
    refreshEngine();
    controller.start();
    return () => { controller.dispose(); unsubscribe(); resize.disconnect(); window.removeEventListener("message", themeMessage); };
  }, []);
  useEffect(() => {
    if (state.status === "ready" && !engineReady.current) refreshEngine();
    if (!viewport) return;
    viewport.setHistoryPreview(null, state.status !== "ready");
    if (state.status !== "ready" || !state.model) return;
    const liveIDs = new Set(state.model.parts.map(part => part.id));
    for (const part of viewport.getPartRows()) if (!liveIDs.has(part.id)) viewport.removeAuthoredPart(part.id);
    for (const part of state.model.parts) viewport.replaceAuthoredPart(part);
    cadSelection.dispatch({ type: "clear" });
    if (state.model.parts.length && !framed.current) { viewport.frameAll(); framed.current = true; }
  }, [state.model, state.status]);
  useEffect(() => { setDraft(state.parameters); }, [state.parameters]);
  useEffect(() => {
    if (!orbit) return;
    const timer = setInterval(() => viewport?.nudgeCamera(1, 0), 340);
    return () => clearInterval(timer);
  }, [orbit]);
  const problem = sprocketParameterProblem(draft);
  const stageAt = (y: number) => {
    const rect = history.current!.getBoundingClientRect();
    return Math.max(0, Math.min(state.stages.length, Math.round((y - rect.top) / 34)));
  };
  const pause = () => { controller.pause(); setOrbit(false); };
  return <main className="cad-test" aria-label="CAD native test window">
    <header className="cad-test-title"><span className="cad-test-mark" aria-hidden="true" /><strong>Aether CAD</strong><span className="cad-test-file">sprocket{PART_FILE_EXTENSION}</span><span className="cad-test-tag">TEST WINDOW</span></header>
    <nav className="cad-test-toolbar" aria-label="Playback and view">
      <Button onClick={() => busy ? pause() : controller.play()}>{busy ? "Pause" : "Play build"}</Button>
      <Button title="Previous feature" disabled={state.stage === 0} onClick={() => controller.setStage(state.stage - 1)}>Previous</Button>
      <Button title="Next feature" disabled={state.stage === state.stages.length} onClick={() => controller.setStage(state.stage + 1)}>Next</Button>
      <select aria-label="Build playback speed" value={state.delayMilliseconds} onChange={event => controller.setDelay(Number(event.target.value))}><option value={1600}>0.5×</option><option value={800}>1×</option><option value={400}>2×</option></select>
      <span className="cad-test-spacer" />
      <Button aria-pressed={orbit} onClick={() => setOrbit(!orbit)}>{orbit ? "Stop orbit" : "Orbit"}</Button>
      <Button onClick={() => viewport?.zoomToFit()}>Fit</Button>
      <select aria-label="Display style" value={style} onChange={event => setStyle(event.target.value as CADDisplayStyle)}><option value="hidden-line">Hidden line</option><option value="shaded-edges">Shaded + edges</option><option value="wireframe">Wireframe</option></select>
    </nav>
    <div className="cad-test-workspace">
      <aside className="cad-test-history" aria-label="Feature history">
        <div className="cad-test-history-heading"><strong>sprocket</strong><span>{state.document.features.length} operations · mm</span></div>
        <button className="cad-test-origin" onClick={() => controller.setStage(0)}>Origin · axes · planes</button>
        <div className="cad-test-stage-list" ref={history}>
          {state.stages.map((stage, index) => <button key={stage.id} className="cad-test-stage" data-rolled-back={index >= state.stage} aria-current={state.stage === index + 1 ? "step" : undefined} title={stage.detail} onClick={() => controller.setStage(index + 1)}><span className="cad-test-step-number">{String(index + 1).padStart(2, "0")}</span>{stage.name}</button>)}
          <div className="cad-test-rollback" role="slider" tabIndex={0} aria-label="Feature rollback" aria-orientation="vertical" aria-valuemin={0} aria-valuemax={state.stages.length} aria-valuenow={state.stage} aria-valuetext={state.stage ? state.stages[state.stage - 1].name : "Origin"} style={{ "--rollback-offset": `${state.stage * 34}px` } as CSSProperties}
            onPointerDown={event => { event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); pause(); }}
            onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) { const stage = stageAt(event.clientY); if (stage !== state.stage) controller.setStage(stage); } }}
            onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
            onKeyDown={event => { const target = event.key === "Home" ? 0 : event.key === "End" ? state.stages.length : ["ArrowUp", "ArrowLeft"].includes(event.key) ? Math.max(0, state.stage - 1) : ["ArrowDown", "ArrowRight"].includes(event.key) ? Math.min(state.stages.length, state.stage + 1) : null; if (target !== null) { event.preventDefault(); controller.setStage(target); } }}><span /></div>
        </div>
        <p className="cad-test-drag-hint">Drag the red bar to roll back.<br />Or select a feature.</p>
        <div className="cad-test-history-bottom"><span>{state.stage === 0 ? "Empty history" : state.stages[state.stage - 1].detail}</span><span>{state.document.features.length - controller.currentDocument().rollbackIndex!} operations rolled back</span></div>
      </aside>
      <section className="cad-test-viewport" aria-label="Live CAD viewport" onPointerDown={() => setOrbit(false)}>
        <div className="cad-test-render-host" ref={host} />
        <div className="cad-test-cube"><ViewportNavigationCube orientation={orientation} upAxis="z" onSelectView={view => { setOrbit(false); viewport?.setCameraView(view); }} onSelectDirection={direction => { setOrbit(false); viewport?.setCameraDirection(direction); }} onFit={() => viewport?.zoomToFit()} onNudge={(h, v) => viewport?.nudgeCamera(h, v)} onRoll={turns => viewport?.rollCamera(turns)} /></div>
        {(state.status !== "ready" || viewportError) && <div className="cad-test-overlay" role={state.status === "error" || viewportError ? "alert" : "status"}>{viewportError ? `Viewport unavailable: ${viewportError}` : state.error ? describeError(state.error) : state.message}{state.status === "error" && <><Button onClick={() => controller.rebuild()}>Retry rebuild</Button>{/sign in|401/i.test(state.error || "") && <a href={(import.meta.env.DEV ? `${location.protocol}//${location.hostname}:8780/?signin` : "/?signin")} target="_blank" rel="noopener noreferrer">Sign in to Studio ↗</a>}</>}</div>}
        {state.status === "ready" && state.stage === 0 && <div className="cad-test-empty">Origin<span>Move the rollback bar down to build the part.</span></div>}
        <div className="cad-test-viewport-caption">{selection.items.length ? `${selection.items.length} selected · ${selection.items[0].label}` : "Right-drag orbit · middle-drag pan · scroll zoom"}</div>
      </section>
    </div>
    <div className="cad-test-actions">
      <Button aria-expanded={editing} onClick={() => setEditing(!editing)}>Parameters</Button>
      <Button disabled={!state.canUndo} onClick={() => controller.undo()}>Undo</Button><Button disabled={!state.canRedo} onClick={() => controller.redo()}>Redo</Button>
      <span className="cad-test-spacer" />
      <Button disabled={busy} onClick={() => controller.rebuild()}>Rebuild</Button>
      <Button disabled={busy || state.status !== "ready"} onClick={() => controller.reopen()}>Test save/reopen</Button>
      <Button disabled={busy} onClick={() => controller.runChecks()}>Run checks</Button>
    </div>
    {editing && <form className="cad-test-parameters" onSubmit={event => { event.preventDefault(); if (!problem) { controller.changeParameters(draft); setNotice(""); } }}>
      <div className="cad-test-fields">{sprocketParameterFields.map(field => <label key={field.key}>{field.label}<span><input type="number" aria-label={field.label} min={field.min} max={field.max} step="any" value={Number.isFinite(draft[field.key]) ? draft[field.key] : ""} onChange={event => setDraft({ ...draft, [field.key]: event.target.valueAsNumber })} />{field.unit}</span></label>)}</div>
      <div className="cad-test-form-actions"><Button type="submit" disabled={!!problem}>Apply and rebuild</Button><Button onClick={() => controller.reset()}>Reset dimensions</Button><Button disabled={state.status !== "ready"} onClick={() => { void savePartDocument(controller.currentDocument()).then(name => setNotice(`Saved ${name}.`)).catch(error => { if (error?.name !== "AbortError") setNotice(String(error)); }); }}>Download part</Button></div>
      {problem && <p role="alert">{problem}</p>}
    </form>}
    <footer className="cad-test-status" aria-label="Engine status"><span className="cad-test-state-dot" data-state={state.status} /><span>{engine}</span><span className="cad-test-spacer" /><span>Feature {state.stage} / {state.stages.length}</span></footer>
    <div className="cad-test-diagnostics"><p role="status">{state.message}{state.checking && ` (${state.checkedStages}/8)`}</p><span>{metrics.backend} · {state.status === "ready" ? `${metrics.bodies} body · ${metrics.faces} faces · ${metrics.edgeSegments} edge segments · ${metrics.triangles.toLocaleString()} triangles` : state.status === "error" ? "Rebuild failed" : "Building…"}{metrics.fps !== null && ` · ${Math.round(metrics.fps)} fps`}</span>{notice && <p role="status">{notice}</p>}</div>
    <p className="cad-test-footnote">Native feature history, exact topology and the Aether CAD viewport. Local test part; edits last while this window is open. Build playback waits for each rebuild.</p>
  </main>;
}

createRoot(document.getElementById("root")!).render(<TestWindow />);
