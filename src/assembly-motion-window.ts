import { openCompactFeatureWindow } from "@aether/ui";
import type { AssemblyProjectionV1 } from "./cad-assembly-bridge";
import { assemblyJobFor } from "./assembly-job";
import { motionFrames, motionFramesCSV, motionPlotSVG, motionSeries, motionTrace, motionTraceCSV, type MotionFrame, type MotionKey } from "./startup/assembly-motion";
import { bodiesForPlacements, type AssemblySolveDependencies, type SolvedBody } from "./startup/assembly-solve";
import { checkAssemblyContacts, describeOverlaps, liveContactSets } from "./startup/assembly-contacts";
import { aetherKernel } from "./engine/aether/kernel";

/** Motion study (SolidCraft's motion.study / motion.export): one mate DOF driven from a
 *  start to an end value over a number of steps, every step solved in-process, played in
 *  the viewport and exportable as CSV. */
export function openMotionStudyWindow(projection: AssemblyProjectionV1, deps: AssemblySolveDependencies, show: (bodies: SolvedBody[]) => void, report: (message: string, tone?: "error" | "success") => void, showCurves: (curves: { label: string; color: string; polylines: [number, number, number][][] }[]) => void = () => undefined): void {
  const viewport = document.querySelector<HTMLElement>(".cad-studio-viewport");
  if (!viewport || viewport.querySelector(".cad-motion-window")) return;
  const dofs = projection.mates.flatMap((mate) => (mate.suppressed ? [] : (mate.dofs ?? []).map((dof) => ({ id: dof.id, label: `${mate.name} · ${dof.name}`, joint: mate.id, dof: dof.name, kind: dof.kind, axis: (dof.name.endsWith("_x") ? "x" : dof.name.endsWith("_y") ? "y" : "z") as "x" | "y" | "z" }))));
  let frames: MotionFrame[] = [], playing = 0;
  const win = openCompactFeatureWindow({ viewport, className: "cad-motion-window", icon: "rotate", title: "Motion study", acceptLabel: "Export CSV", discardLabel: "Close",
    onAccept: async () => {
      if (!frames.length) { win.setError("Run the study first."); return; }
      const url = URL.createObjectURL(new Blob([motionFramesCSV(frames)], { type: "text/csv" }));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = "motion-study.csv"; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      report(`Motion study exported: ${frames.length} steps.`, "success");
    },
    onDiscard: async () => { playing++; showCurves([]); win.close(); } });
  const dofSelect = document.createElement("select"); dofSelect.setAttribute("aria-label", "Driven degree of freedom");
  for (const d of dofs) { const o = document.createElement("option"); o.value = d.id; o.textContent = `${d.label} (${d.kind === "rotation" ? "degrees" : "mm"})`; dofSelect.append(o); }
  const from = document.createElement("input"); from.type = "number"; from.value = "0"; from.setAttribute("aria-label", "Start value");
  const to = document.createElement("input"); to.type = "number"; to.value = "90"; to.setAttribute("aria-label", "End value");
  const steps = document.createElement("input"); steps.type = "number"; steps.value = "20"; steps.min = "1"; steps.setAttribute("aria-label", "Steps");
  const run = document.createElement("button"); run.type = "button"; run.className = "aui-button"; run.textContent = "Run and play";
  // motion.trace / plot / interference: which occurrence to trace, what to plot, whether every pair is checked.
  const traceSelect = document.createElement("select"); traceSelect.setAttribute("aria-label", "Trace occurrence");
  traceSelect.append(new Option("None", ""), ...projection.instances.filter((i) => !i.suppressed).map((i) => new Option(i.name, i.id)));
  const plotSelect = document.createElement("select"); plotSelect.setAttribute("aria-label", "Plot");
  const interference = document.createElement("input"); interference.type = "checkbox"; interference.setAttribute("aria-label", "Check interference between every pair");
  const keep = document.createElement("button"); keep.type = "button"; keep.className = "aui-button"; keep.textContent = "Keep trace (CSV)"; keep.disabled = true;
  const plot = document.createElement("div"); plot.className = "cad-motion-plot";
  win.row("Drive", dofSelect); win.row("From", from); win.row("To", to); win.row("Steps", steps); win.row("Trace", traceSelect, keep); win.row("Plot", plotSelect); win.row("Interference", interference); win.row("", run); win.body.append(plot);
  const refreshPlotOptions = () => { const chosen = dofs.find((d) => d.id === dofSelect.value); plotSelect.replaceChildren(...(chosen ? [new Option(chosen.label, `${chosen.joint}:${chosen.dof}`)] : []), ...projection.instances.filter((i) => !i.suppressed).flatMap((i) => ["x", "y", "z"].map((axis) => new Option(`${i.name} ${axis} (mm)`, `${i.id}.${axis}`)))); };
  refreshPlotOptions(); dofSelect.onchange = refreshPlotOptions;
  const drawPlot = () => { if (!frames.length) return; const label = plotSelect.selectedOptions[0]?.textContent ?? plotSelect.value; plot.innerHTML = motionPlotSVG(motionSeries(frames, plotSelect.value), label); };
  plotSelect.onchange = drawPlot;
  keep.onclick = () => {
    const trace = motionTrace(frames, traceSelect.value);
    const url = URL.createObjectURL(new Blob([motionTraceCSV(trace)], { type: "text/csv" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "motion-trace.csv"; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    report(`Motion trace kept: ${trace.length} points.`, "success");
  };
  if (!dofs.length) win.setError("No mate with a degree of freedom to drive.");
  run.onclick = async () => {
    const chosen = dofs.find((d) => d.id === dofSelect.value);
    if (!chosen) { win.setError("Choose a degree of freedom."); return; }
    const n = Number(steps.value);
    const key: MotionKey = { joint: chosen.joint, dof: chosen.dof, kind: chosen.kind, axis: chosen.axis, points: [[0, Number(from.value)], [n, Number(to.value)]] };
    const { job, untranslated } = assemblyJobFor(projection);
    if (untranslated.length) { win.setError(untranslated.map((u) => `${u.name}: ${u.reason}`).join("; ")); return; }
    win.setError(null); win.setNotice("Solving every step…"); run.disabled = true;
    try {
      frames = await motionFrames(job, [key], n, deps.solve);
      // Contacts on: the study stops at the first step where a contact set's bodies pass through each other.
      // Interference asked for: every pair of occurrences is one set, whatever the contact flag says.
      const everyPair = { ...projection, contacts_enabled: true, contact_sets: [] as never[] };
      if (interference.checked || liveContactSets(projection).length) {
        const scope = interference.checked ? everyPair : projection;
        for (let i = 0; i < frames.length; i++) {
          const overlaps = await checkAssemblyContacts(scope, frames[i].placements, { parseDocument: deps.parseDocument, checkContacts: (input) => aetherKernel().checkContacts(input) });
          if (overlaps.length) { if (interference.checked) report(`Motion interference at step ${i}: ${describeOverlaps(overlaps)}`, "error"); frames = frames.slice(0, Math.max(1, i)); win.setNotice(`Stopped at step ${frames.length - 1}: ${describeOverlaps(overlaps)}`); break; }
        }
      }
      const traced = traceSelect.value ? motionTrace(frames, traceSelect.value) : [];
      showCurves(traced.length > 1 ? [{ label: "motion trace", color: "#3e8ef7", polylines: [traced] }] : []);
      keep.disabled = traced.length < 2;
      drawPlot();
      const ticket = ++playing;
      for (const frame of frames) {
        if (ticket !== playing) return;
        show(await bodiesForPlacements(projection, frame.placements, deps));
        win.setNotice(`Step ${frame.step} of ${n} · ${chosen.label} = ${frame.values[`${chosen.joint}:${chosen.dof}`].toFixed(2)}`);
        await new Promise((resolve) => setTimeout(resolve, 60));
      }
      report(`Motion study: ${frames.length} steps solved.`, "success");
    } catch (error) { win.setError((error as Error).message); }
    finally { run.disabled = false; }
  };
}
