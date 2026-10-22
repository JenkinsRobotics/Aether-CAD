import { openCompactFeatureWindow } from "@aether/ui";
import type { AssemblyProjectionV1 } from "./cad-assembly-bridge";
import { assemblyJobFor } from "./assembly-job";
import { motionFrames, motionFramesCSV, type MotionFrame, type MotionKey } from "./startup/assembly-motion";
import { bodiesForPlacements, type AssemblySolveDependencies, type SolvedBody } from "./startup/assembly-solve";

/** Motion study (SolidCraft's motion.study / motion.export): one mate DOF driven from a
 *  start to an end value over a number of steps, every step solved in-process, played in
 *  the viewport and exportable as CSV. */
export function openMotionStudyWindow(projection: AssemblyProjectionV1, deps: AssemblySolveDependencies, show: (bodies: SolvedBody[]) => void, report: (message: string, tone?: "error" | "success") => void): void {
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
    onDiscard: async () => { playing++; win.close(); } });
  const dofSelect = document.createElement("select"); dofSelect.setAttribute("aria-label", "Driven degree of freedom");
  for (const d of dofs) { const o = document.createElement("option"); o.value = d.id; o.textContent = `${d.label} (${d.kind === "rotation" ? "degrees" : "mm"})`; dofSelect.append(o); }
  const from = document.createElement("input"); from.type = "number"; from.value = "0"; from.setAttribute("aria-label", "Start value");
  const to = document.createElement("input"); to.type = "number"; to.value = "90"; to.setAttribute("aria-label", "End value");
  const steps = document.createElement("input"); steps.type = "number"; steps.value = "20"; steps.min = "1"; steps.setAttribute("aria-label", "Steps");
  const run = document.createElement("button"); run.type = "button"; run.className = "aui-button"; run.textContent = "Run and play";
  win.row("Drive", dofSelect); win.row("From", from); win.row("To", to); win.row("Steps", steps); win.row("", run);
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
