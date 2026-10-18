import { useEffect, useMemo, useState } from "react";
import { AetherIcon, IconButton } from "@aether/ui";
import { cadCommands } from "../cad-command-registry";

type SavedHistory = {
  revisions: { revision: number; author: string; saved: number; event: string; note: string; branch: string; parent_revision: number | null }[];
  versions: { name: string; revision: number; created: number; message: string }[];
  branches: { name: string; head_revision: number; created_from: number | null }[];
};

async function call(action: string, body: object) {
  const response = await fetch("/api/library/" + action, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app: "cad", ...body }),
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error?.message ?? data.error ?? "Version control request failed.") as Error & { detail?: MergeConflict };
    error.detail = data.detail;
    throw error;
  }
  return data;
}

type MergeConflict = {
  conflict: true; base: number | null;
  source: string; source_head: number; target: string; target_head: number;
  features: FeatureDiff | null;
};
type FeatureDiff = { added: { id: string; name: string }[]; removed: { id: string; name: string }[]; changed: { id: string; name: string }[] };
type Compare = { from: number; to: number; base: number | null; same_content: boolean; from_only: { revision: number; note: string; event: string; author: string }[]; to_only: Compare["from_only"]; features: FeatureDiff | null };

/** One line a person can read, from the host's feature-level diff. */
function describeDiff(diff: FeatureDiff | null, sameContent: boolean): string {
  if (sameContent) return "No differences.";
  if (!diff) return "The documents differ.";
  const part = (label: string, items: { name: string }[]) => (items.length ? `${label}: ${items.map((f) => f.name).join(", ")}` : "");
  return [part("Added", diff.added), part("Removed", diff.removed), part("Changed", diff.changed)].filter(Boolean).join("\n") || "The documents differ.";
}

/**
 * The marks down the left of the tree, and the legend that explains them.
 *
 * Jonathan supplied Onshape's panel as the reference (2026-10-02) and asked for
 * the same vocabulary, so the names and their order are its own. Four of the
 * seven are states this document store cannot reach yet — it has no release
 * workflow — and they are drawn dimmed rather than hidden, because the legend
 * is also how someone learns what the panel will show them later.
 */
const LEGEND = [
  { kind: "branch", icon: "branch", label: "Branch", planned: false },
  { kind: "workspace", icon: "workspace", label: "Workspace", planned: false },
  { kind: "version", icon: "tag", label: "Version", planned: false },
  { kind: "change", icon: "change", label: "Change", planned: false },
  { kind: "candidate", icon: "triangle", label: "Release candidate", planned: true },
  { kind: "release", icon: "triangle-filled", label: "Release", planned: true },
  { kind: "obsoletion", icon: "obsoletion", label: "Contains obsoletion", planned: true },
  { kind: "automatic", icon: "auto-version", label: "Automatic version", planned: true },
] as const;

const ICON_FOR: Record<string, string> = Object.fromEntries(LEGEND.map((entry) => [entry.kind, entry.icon]));

/** Onshape-style versions-and-history: commits, branches and changes over the
 * host's revision DAG. Merge is listed but disabled until engine-level
 * feature merge lands (see PDM_Versioning.md). */
export function CADVersionsPanel({ documentName, onClose }: { documentName: string; onClose?: () => void }) {
  const [history, setHistory] = useState<SavedHistory | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  /** The row the toolbar acts on; the reference highlights it and restores it. */
  const [selected, setSelected] = useState<number | null>(null);
  /** Compare takes two rows: the selection, and the one picked while comparing. */
  const [comparing, setComparing] = useState(false);
  const [comparison, setComparison] = useState<Compare | null>(null);
  const search = typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams();
  const id = search.get("document");
  const activeBranch = search.get("branch") ?? "Main";
  /** Every mutation is guarded by the head the panel last saw on the branch it is working in. */
  const branchArgs = () => ({ branch: activeBranch === "Main" ? undefined : activeBranch, expected_revision: activeHead });
  const load = async () => {
    if (!id) return;
    setBusy(true); setError("");
    try { setHistory((await call("history", { id })) as SavedHistory); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  useEffect(() => { setHistory(null); void load(); }, [id, documentName]);

  const mainHead = history?.branches.find((b) => b.name === "Main")?.head_revision ?? 0;
  const activeHead = history?.branches.find((b) => b.name === activeBranch)?.head_revision ?? mainHead;
  const versionAt = useMemo(() => new Map((history?.versions ?? []).map((v) => [v.revision, v])), [history]);
  const headOf = useMemo(() => new Map((history?.branches ?? []).map((b) => [b.head_revision, b.name])), [history]);

  /**
   * A row per workspace head and per version, newest first, with the plain
   * changes since the previous milestone folded underneath it. That folding is
   * why each row carries its own disclosure rather than the panel carrying one
   * switch: you open the history of the one version you are asking about.
   */
  const rows = useMemo(() => {
    const ordered = [...(history?.revisions ?? [])].sort((a, b) => b.revision - a.revision);
    const oldest = ordered[ordered.length - 1];
    type Row = { revision: number; kind: string; name: string; author: string; saved: number; branch: string; message: string; changes: typeof ordered };
    const out: Row[] = [];
    let current: Row | null = null;
    for (const r of ordered) {
      const version = versionAt.get(r.revision);
      const workspace = headOf.get(r.revision);
      // The first and last rows are always milestones: the branch head you are
      // working in, and the document's creation. Everything between is a plain
      // save, which belongs to the milestone *above* it — those are the changes
      // made since that milestone, which is what the disclosure promises.
      if (version || workspace || r === oldest) {
        current = {
          revision: r.revision,
          kind: workspace ? "workspace" : version ? "version" : "change",
          name: workspace ? `${workspace} (workspace)` : version ? version.name : "Start",
          author: r.author, saved: r.saved, branch: r.branch,
          message: version?.message ?? "",
          changes: [],
        };
        out.push(current);
      } else if (current) {
        current.changes.push(r);
      }
    }
    return out;
  }, [history, versionAt, headOf]);

  const needle = query.trim().toLowerCase();
  const shown = needle
    ? rows.filter((row) => `${row.name} ${row.author} ${row.message}`.toLowerCase().includes(needle))
    : rows;

  const branchURL = (branch: string) => {
    const next = new URLSearchParams(location.search);
    if (branch === "Main") next.delete("branch"); else next.set("branch", branch);
    next.delete("revision");
    return location.pathname + "?" + next.toString();
  };
  const createBranch = async (from: number) => {
    const name = prompt("Branch name", "");
    if (!name?.trim()) return;
    setBusy(true); setError("");
    try {
      await call("branch_create", { id, name: name.trim(), from_revision: from, ...branchArgs() });
      await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  /** Runs one host action under the busy flag, reloads, and reports its refusal. */
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true); setError("");
    try { await work(); await load(); return true; }
    catch (e) { setError((e as Error).message); return false; }
    finally { setBusy(false); }
  };
  const restore = (revision: number) => {
    if (!confirm(`Restore revision ${revision} on ${activeBranch}? The current state is kept in history.`)) return;
    void run(() => call("restore", { id, revision, ...branchArgs() }));
  };
  /**
   * Merge another branch into the one being viewed. The host fast-forwards
   * when it can; when both sides moved it refuses with the diff, and the
   * person chooses a side — the same shape as git on a file it cannot merge.
   */
  const merge = async () => {
    const others = (history?.branches ?? []).map((b) => b.name).filter((name) => name !== activeBranch);
    if (!others.length) { setError("There is no other branch to merge from."); return; }
    const source = others.length === 1 ? others[0] : prompt(`Merge which branch into ${activeBranch}?\n${others.join(", ")}`, others[0]);
    if (!source) return;
    const attempt = (resolution?: "source" | "target") =>
      call("merge", { id, source, target: activeBranch === "Main" ? undefined : activeBranch, resolution, expected_revision: activeHead });
    setBusy(true); setError("");
    try {
      await attempt();
    } catch (e) {
      const detail = (e as Error & { detail?: MergeConflict }).detail;
      if (!detail?.conflict) { setError((e as Error).message); setBusy(false); return; }
      const keepSource = confirm(
        `Both ${detail.source} and ${detail.target} changed since they diverged.\n\n${describeDiff(detail.features, false)}\n\nOK keeps ${detail.source}'s state. Cancel keeps ${detail.target}'s and records the merge.`,
      );
      try { await attempt(keepSource ? "source" : "target"); }
      catch (again) { setError((again as Error).message); setBusy(false); return; }
    }
    await load(); setBusy(false);
  };
  /** Compare the selected row with the next one clicked. */
  const compareWith = async (other: number) => {
    if (selected === null || other === selected) { setComparing(false); return; }
    setComparing(false);
    setBusy(true); setError("");
    try { setComparison((await call("compare", { id, from: selected, to: other })) as Compare); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const renameBranch = () => {
    const name = prompt(`Rename branch ${activeBranch} to:`, activeBranch);
    if (!name?.trim() || name.trim() === activeBranch) return;
    void run(() => call("branch_rename", { id, name: activeBranch, new_name: name.trim(), ...branchArgs() })).then((ok) => {
      if (ok) location.assign(branchURL(name.trim()));
    });
  };
  const deleteBranch = () => {
    if (!confirm(`Delete branch ${activeBranch}? Its merged work stays in history.`)) return;
    void run(async () => {
      try { await call("branch_delete", { id, name: activeBranch, ...branchArgs() }); }
      catch (e) {
        // Unmerged work is refused unless the person says it is disposable.
        if (!/not merged/.test((e as Error).message) || !confirm(`${(e as Error).message}\n\nDelete anyway and discard that work?`)) throw e;
        await call("branch_delete", { id, name: activeBranch, force: true, ...branchArgs() });
      }
    }).then((ok) => { if (ok) location.assign(branchURL("Main")); });
  };
  const renameVersion = (current: string, message: string) => {
    const name = prompt(`Version name:`, current);
    if (name === null) return;
    const text = prompt("Description:", message);
    if (text === null) return;
    void run(() => call("version_update", { id, name: current, new_name: name.trim() || current, message: text, ...branchArgs() }));
  };
  const deleteVersion = (name: string) => {
    if (!confirm(`Delete version ${name}? The revision it marked stays in history.`)) return;
    void run(() => call("version_delete", { id, name, ...branchArgs() }));
  };
  const toggle = (revision: number) => setExpanded((current) => {
    const next = new Set(current);
    if (!next.delete(revision)) next.add(revision);
    return next;
  });
  const when = (seconds: number) => new Date(seconds * 1000).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });

  if (!id) {
    return (
      <section className="cad-versions-panel" aria-label="Versions and history">
        <p>Save this document to your server to keep history, commits and branches.</p>
      </section>
    );
  }

  return (
    <section className="cad-versions-panel" aria-label="Versions and history">
      <header className="cad-version-head">
        <h2>Versions and history</h2>
        <div className="cad-version-head-actions">
          <IconButton
            label="Create version"
            title={activeBranch === "Main" ? "Create version — name this state" : "Versions land on Main; branch work arrives with merge"}
            disabled={busy || activeBranch !== "Main"}
            onClick={() => void cadCommands.execute("commit-part")}
          ><AetherIcon name="version-create" /></IconButton>
          <IconButton
            label="Compare history entries"
            title={selected === null ? "Select a row, then compare it with another" : comparing ? "Click the row to compare against" : "Compare the selected row with another"}
            disabled={busy || selected === null}
            aria-pressed={comparing}
            onClick={() => setComparing((on) => !on)}
          ><AetherIcon name="compare" /></IconButton>
          <IconButton label="Merge a branch into this one" title={`Merge another branch into ${activeBranch}`} disabled={busy || (history?.branches.length ?? 0) < 2} onClick={() => void merge()}>
            <AetherIcon name="tools" />
          </IconButton>
          {onClose ? <IconButton label="Close versions and history" onClick={onClose}><AetherIcon name="close" /></IconButton> : null}
        </div>
      </header>

      <div className="cad-version-tools">
        <IconButton
          label="Branch from the selected entry"
          title={selected === null ? "Select a row to branch from it" : `Start a branch at revision ${selected}`}
          disabled={busy || selected === null}
          onClick={() => selected !== null && void createBranch(selected)}
        ><AetherIcon name="branch-from" /></IconButton>
        <IconButton
          label="Restore the selected entry"
          title={selected === null ? "Select a row to restore it" : selected === activeHead ? "This is already the current state" : `Restore revision ${selected} on ${activeBranch}`}
          disabled={busy || selected === null || selected === activeHead}
          onClick={() => selected !== null && restore(selected)}
        ><AetherIcon name="restore" /></IconButton>
        {activeBranch !== "Main" ? (
          <>
            <IconButton label="Rename this branch" disabled={busy} onClick={renameBranch}><AetherIcon name="pencil" /></IconButton>
            <IconButton label="Delete this branch" disabled={busy} onClick={deleteBranch}><AetherIcon name="delete" /></IconButton>
          </>
        ) : null}
        <IconButton label="Refresh history" disabled={busy} onClick={() => void load()}><AetherIcon name="refresh" /></IconButton>
      </div>

      <div className="cad-version-search">
        <input
          type="search"
          placeholder="Search history"
          aria-label="Search history"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <AetherIcon name="search" aria-hidden="true" />
      </div>

      {history && history.branches.length > 0 ? (
        <div className="cad-version-branches" aria-label="Branches">
          {history.branches.map((branch) => (
            <a
              key={branch.name}
              className={"cad-version-branch" + (branch.name === activeBranch ? " cad-version-branch--active" : "")}
              href={branchURL(branch.name)}
              title={branch.name === activeBranch ? "Current workspace" : `Open the ${branch.name} branch`}
            ><AetherIcon name="branch" style={{width:14,height:14,verticalAlign:"middle",marginRight:5}} aria-hidden="true" />{branch.name}</a>
          ))}
        </div>
      ) : null}

      {error && <p className="cad-version-error" role="alert">{error}</p>}

      {comparison ? (
        <div className="cad-version-compare" role="status">
          <div className="cad-version-compare-head">
            <strong>r{comparison.from} → r{comparison.to}</strong>
            <span>{comparison.base === null ? "unrelated" : `since r${comparison.base}`} · {comparison.from_only.length + comparison.to_only.length} revisions</span>
            <button type="button" aria-label="Close comparison" onClick={() => setComparison(null)}><AetherIcon name="close" /></button>
          </div>
          <pre>{describeDiff(comparison.features, comparison.same_content)}</pre>
        </div>
      ) : null}

      <div className="cad-version-columns" aria-hidden="true"><span>Name</span><span>Modified</span></div>

      <ol className="cad-version-graph">
        {shown.map((row) => {
          const open = expanded.has(row.revision);
          return (
            <li
              key={`${row.branch}-${row.revision}`}
              className="cad-version-node"
              data-kind={row.kind}
              data-branch={row.branch}
              data-selected={selected === row.revision || undefined}
              data-compare-target={comparing && selected !== row.revision || undefined}
              onClick={() => (comparing ? void compareWith(row.revision) : setSelected(row.revision))}
            >
              <span className="cad-version-marker" aria-hidden="true">
                <AetherIcon name={ICON_FOR[row.kind] ?? "change"} />
              </span>
              <div className="cad-version-row">
                <div className="cad-version-name">
                  <strong title={row.message || row.name}>{row.name}</strong>
                  {row.kind === "version" ? (
                    <span className="cad-version-row-actions">
                      <button type="button" disabled={busy} title="Rename or describe this version" onClick={(event) => { event.stopPropagation(); renameVersion(row.name, row.message); }}><AetherIcon name="pencil" /></button>
                      <button type="button" disabled={busy} title="Delete this version" onClick={(event) => { event.stopPropagation(); deleteVersion(row.name); }}><AetherIcon name="delete" /></button>
                    </span>
                  ) : null}
                  {row.changes.length ? (
                    <button type="button" className="cad-version-expand" aria-expanded={open} onClick={() => toggle(row.revision)}>
                      <AetherIcon name="chevron-right" aria-hidden="true" />
                      Show changes
                    </button>
                  ) : null}
                </div>
                <div className="cad-version-modified">
                  <span>{row.author}</span>
                  <small>{when(row.saved)}</small>
                </div>
              </div>
              {open ? (
                <ol className="cad-version-changes">
                  {row.changes.map((change) => (
                    <li key={change.revision}>
                      <span className="cad-version-change-name">{change.note || change.event}</span>
                      <span className="cad-version-change-when">{when(change.saved)}</span>
                      <span className="cad-version-change-links">
                        <a href={`${location.pathname}?document=${encodeURIComponent(id)}&revision=${change.revision}`} target="_blank" rel="noreferrer">Open read-only</a>
                        <button type="button" disabled={busy} onClick={() => void createBranch(change.revision)}>Branch from here</button>
                        <button type="button" disabled={busy} onClick={() => restore(change.revision)}>Restore</button>
                      </span>
                    </li>
                  ))}
                </ol>
              ) : null}
            </li>
          );
        })}
      </ol>

      <dl className="cad-version-legend">
        {LEGEND.map((entry) => (
          <div key={entry.kind} data-planned={entry.planned || undefined} title={entry.planned ? "Shown once this document store has a release workflow" : undefined}>
            <dt><AetherIcon name={entry.icon} aria-hidden="true" /></dt>
            <dd>{entry.label}</dd>
          </div>
        ))}
      </dl>

      <footer className="cad-version-foot">
        <span>Right-click on a row to perform actions</span>
        <a href="https://github.com/aether-studio" target="_blank" rel="noreferrer" aria-label="About versions and history"><AetherIcon name="help" /></a>
      </footer>
    </section>
  );
}
