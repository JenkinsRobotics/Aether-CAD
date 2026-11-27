/** Live document parameters & pinned-variable monitoring panel — lives under Design › Parameters. */
import { useState, useSyncExternalStore } from "react";
import { AetherIcon, Button, EmptyState, FieldRow, IconButton, InspectorActions, InspectorSection, SelectField, TextField } from "@aether/ui";
import {
  evaluateDocumentVariables,
  exportVariables,
  renameVariable,
  safeDeleteVariable,
  setVariableComment,
  setVariableFavorite,
  updatePartDocumentVariables,
  variableGraph,
  type DocumentVariable,
  type PartDocument,
} from "@aether/core/document";
import "../CADInspector.css";

interface ParametersBridgeState {
  doc: PartDocument | null;
  onApply?: (next: PartDocument) => Promise<void> | void;
}

const listeners = new Set<() => void>();
let bridgeState: ParametersBridgeState = { doc: null };
const emit = () => { for (const fn of listeners) fn(); };

/** Reactive bridge syncing ParametersPanel, ConfigurationsPanel, PhysicalMaterialPanel,
 *  and InspectorPanel directly with the active PartDocument. */
export const documentParametersBridge = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  snapshot(): ParametersBridgeState {
    return bridgeState;
  },
  bind(doc: PartDocument | null, onApply?: (next: PartDocument) => Promise<void> | void): void {
    bridgeState = { doc, onApply };
    emit();
  },
};

export function formatEvaluatedVariable(val: unknown): string {
  if (typeof val === "string") return val;
  if (val && typeof val === "object" && "magnitudeSI" in val) {
    const q = val as { magnitudeSI: number; lengthPower: number; anglePower: number };
    if (q.lengthPower === 1 && q.anglePower === 0) return `${(q.magnitudeSI * 1000).toFixed(3)} mm`;
    if (q.anglePower === 1 && q.lengthPower === 0) return `${((q.magnitudeSI * 180) / Math.PI).toFixed(3)}°`;
    return String(Number(q.magnitudeSI.toFixed(6)));
  }
  return "";
}

const KIND_OPTIONS: { value: DocumentVariable["kind"]; label: string }[] = [
  { value: "length", label: "Length" },
  { value: "angle", label: "Angle" },
  { value: "number", label: "Number" },
  { value: "string", label: "String" },
];

export function ParametersPanel({ active }: { active: boolean }) {
  const { doc, onApply } = useSyncExternalStore(
    documentParametersBridge.subscribe,
    documentParametersBridge.snapshot,
    documentParametersBridge.snapshot,
  );
  const [name, setName] = useState("");
  const [expression, setExpression] = useState("");
  const [kind, setKind] = useState<DocumentVariable["kind"]>("length");
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const [editingVar, setEditingVar] = useState<string | null>(null);
  const [editRename, setEditRename] = useState("");
  const [editExpr, setEditExpr] = useState("");
  const [editComment, setEditComment] = useState("");
  const [quickDrafts, setQuickDrafts] = useState<Record<string, string>>({});

  const variables = doc?.variables ?? [];
  const favorites = variables.filter((v) => v.favorite);
  let evaluated = new Map<string, unknown>();
  try {
    evaluated = evaluateDocumentVariables(variables);
  } catch {
    evaluated = new Map();
  }
  const graph = doc ? variableGraph(doc) : null;

  const commit = async (next: PartDocument) => {
    setError("");
    try {
      await onApply?.(next);
      documentParametersBridge.bind(next, onApply);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleAddOrUpdate = async () => {
    if (!doc || !name.trim() || !expression.trim()) return;
    setError("");
    try {
      const trimmedName = name.trim().replace(/^#/, "");
      const existing = doc.variables ?? [];
      const idx = existing.findIndex((v) => v.name === trimmedName);
      const entry: DocumentVariable = {
        ...(idx >= 0 ? existing[idx] : {}),
        name: trimmedName,
        expression: expression.trim(),
        kind,
        ...(comment.trim() ? { comment: comment.trim() } : {}),
      };
      const nextVars = idx >= 0 ? existing.map((v, i) => (i === idx ? entry : v)) : [...existing, entry];
      const nextDoc = await updatePartDocumentVariables(doc, nextVars);
      await commit(nextDoc);
      setName("");
      setExpression("");
      setComment("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleQuickApply = async (variable: DocumentVariable) => {
    if (!doc) return;
    const draft = (quickDrafts[variable.name] ?? variable.expression).trim();
    if (!draft || draft === variable.expression) return;
    setError("");
    try {
      const nextVars = (doc.variables ?? []).map((v) =>
        v.name === variable.name ? { ...v, expression: draft } : v,
      );
      const nextDoc = await updatePartDocumentVariables(doc, nextVars);
      await commit(nextDoc);
      setQuickDrafts((prev) => {
        const copy = { ...prev };
        delete copy[variable.name];
        return copy;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const startInlineEdit = (v: DocumentVariable) => {
    setEditingVar(v.name);
    setEditRename(v.name);
    setEditExpr(v.expression);
    setEditComment(v.comment ?? "");
    setError("");
  };

  const commitInlineEdit = async (original: DocumentVariable) => {
    if (!doc) return;
    setError("");
    try {
      let next = doc;
      const targetName = editRename.trim().replace(/^#/, "");
      if (targetName && targetName !== original.name) {
        next = renameVariable(next, original.name, targetName);
      }
      const activeName = targetName || original.name;
      if (editComment !== (original.comment ?? "")) {
        next = setVariableComment(next, activeName, editComment);
      }
      if (editExpr.trim() && editExpr.trim() !== original.expression) {
        const updatedVars = (next.variables ?? []).map((v) =>
          v.name === activeName ? { ...v, expression: editExpr.trim() } : v,
        );
        next = await updatePartDocumentVariables(next, updatedVars);
      }
      await commit(next);
      setEditingVar(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleExportCSV = () => {
    if (!doc) return;
    const url = URL.createObjectURL(new Blob([exportVariables(doc, "csv")], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${doc.name || "part"}-parameters.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <section className="cad-property-sheet" hidden={!active} data-panel="parameters" aria-label="Document parameters">
      {favorites.length > 0 && (
        <InspectorSection defaultOpen title={`Pinned (${favorites.length})`}>
          <ul className="cad-inspector-card-list" aria-label="Pinned parameters">
            {favorites.map((v) => {
              const draft = quickDrafts[v.name] ?? v.expression;
              const dirty = draft.trim() !== v.expression;
              return (
                <li key={v.name} className="cad-inspector-card" data-pinned-param={v.name}>
                  <div className="cad-inspector-card-header">
                    <span className="cad-inspector-card-title">#{v.name}</span>
                    {evaluated.has(v.name) && (
                      <span className="cad-pill cad-pill--accent">{formatEvaluatedVariable(evaluated.get(v.name))}</span>
                    )}
                  </div>
                  <div className="cad-inline-edit-row">
                    <TextField
                      aria-label={`Quick edit ${v.name}`}
                      value={draft}
                      onChange={(e) => setQuickDrafts((prev) => ({ ...prev, [v.name]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === "Enter") void handleQuickApply(v); }}
                    />
                    <Button primary disabled={!dirty} onClick={() => void handleQuickApply(v)}>Apply</Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </InspectorSection>
      )}

      <InspectorSection defaultOpen title="Add or update parameter">
        <FieldRow label="Name" htmlFor="param-var-name">
          <TextField id="param-var-name" value={name} placeholder="wall_t" onChange={(e) => setName(e.target.value)} />
        </FieldRow>
        <FieldRow label="Expression" htmlFor="param-var-expr">
          <TextField id="param-var-expr" value={expression} placeholder="4 mm" onChange={(e) => setExpression(e.target.value)} />
        </FieldRow>
        <FieldRow label="Unit kind" htmlFor="param-var-kind">
          <SelectField
            id="param-var-kind"
            value={kind}
            options={KIND_OPTIONS}
            onChange={(e) => setKind(e.target.value as DocumentVariable["kind"])}
          />
        </FieldRow>
        <FieldRow label="Comment" htmlFor="param-var-comment">
          <TextField id="param-var-comment" value={comment} placeholder="Optional note" onChange={(e) => setComment(e.target.value)} />
        </FieldRow>
        <InspectorActions>
          <Button primary disabled={!doc || !name.trim() || !expression.trim()} onClick={() => void handleAddOrUpdate()}>
            Set parameter
          </Button>
          <Button disabled={!doc || !variables.length} onClick={handleExportCSV}>
            Export CSV
          </Button>
        </InspectorActions>
        {error && <p role="alert" className="cad-callout cad-callout--error">{error}</p>}
        {graph && (graph.cycles.length > 0 || graph.errors.length > 0) && (
          <p role="alert" className="cad-callout cad-callout--error">
            Parameter graph issues: {[...graph.errors, ...graph.cycles.map((c) => `Cycle: ${c.join(" → ")}`)].join("; ")}
          </p>
        )}
      </InspectorSection>

      <InspectorSection defaultOpen title={`Document variables (${variables.length})`}>
        {variables.length === 0 ? (
          <EmptyState
            title="No variables yet"
            description="Add named #variables above to drive sketches, 3D features, and configurations. Star any parameter to pin it for live adjustment."
          />
        ) : (
          <ul aria-label="Document variables list" className="cad-inspector-card-list">
            {variables.map((v) => {
              const isEditing = editingVar === v.name;
              return (
                <li key={v.name} className="cad-inspector-card" data-param-name={v.name}>
                  <div className="cad-inspector-card-header">
                    <span className="cad-inspector-card-title">#{v.name}</span>
                    <span className="cad-pill">{v.kind}</span>
                    {evaluated.has(v.name) && (
                      <span className="cad-pill cad-pill--accent">{formatEvaluatedVariable(evaluated.get(v.name))}</span>
                    )}
                    <IconButton
                      size="small"
                      label={v.favorite ? `Unpin ${v.name}` : `Pin ${v.name}`}
                      aria-pressed={Boolean(v.favorite)}
                      onClick={() => doc && void commit(setVariableFavorite(doc, v.name, !v.favorite))}
                    >
                      <AetherIcon name={v.favorite ? "pin" : "star"} />
                    </IconButton>
                  </div>

                  {isEditing ? (
                    <>
                      <FieldRow label="Name" htmlFor={`param-edit-name-${v.name}`}>
                        <TextField id={`param-edit-name-${v.name}`} value={editRename} onChange={(e) => setEditRename(e.target.value)} />
                      </FieldRow>
                      <FieldRow label="Formula" htmlFor={`param-edit-expr-${v.name}`}>
                        <TextField id={`param-edit-expr-${v.name}`} value={editExpr} onChange={(e) => setEditExpr(e.target.value)} />
                      </FieldRow>
                      <FieldRow label="Comment" htmlFor={`param-edit-comment-${v.name}`}>
                        <TextField id={`param-edit-comment-${v.name}`} value={editComment} placeholder="Note" onChange={(e) => setEditComment(e.target.value)} />
                      </FieldRow>
                      <div className="cad-inspector-card-actions">
                        <Button primary onClick={() => void commitInlineEdit(v)}>Save</Button>
                        <Button onClick={() => setEditingVar(null)}>Cancel</Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="cad-inspector-card-value">
                        <code>{v.expression}</code>
                        {v.comment && <span className="cad-inspector-card-meta"> — {v.comment}</span>}
                      </div>
                      <div className="cad-inspector-card-actions">
                        <Button onClick={() => startInlineEdit(v)}>Edit</Button>
                        <Button onClick={() => {
                          if (!doc) return;
                          try { void commit(safeDeleteVariable(doc, v.name)); }
                          catch (err) { setError(err instanceof Error ? err.message : String(err)); }
                        }}>Delete</Button>
                      </div>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </InspectorSection>
    </section>
  );
}
