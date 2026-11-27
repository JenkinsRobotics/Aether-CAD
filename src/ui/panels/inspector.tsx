/** Dynamic context-aware Inspector — lives under Properties › Selection.
 *  Adapts live to what the user is interacting with: active Sketch, Assembly,
 *  selected Feature, selected Body/Face/Edge, or Part overview with pinned #variables. */
import { useEffect, useState, useSyncExternalStore } from "react";
import { AetherIcon, Button, InspectorActions, InspectorSection, TextField } from "@aether/ui";
import {
  availableBodies,
  evaluateDocumentVariables,
  materialForBody,
  updatePartDocumentVariables,
  type DocumentVariable,
} from "@aether/core/document";
import { CADDocumentSettings } from "../CADDocumentSettings";
import { cadAssemblyWorkspace } from "../../core/stores/cad-assembly-workspace-store";
import { cadCommands } from "../../core/cad-command-registry";
import { cadPresentation, requestCADPropertyPanel, type CADPanelPlacement } from "../../core/stores/cad-presentation-store";
import { cadSelection } from "../../core/stores/cad-selection-store";
import { cadWorkspace } from "../../core/stores/cad-workspace-store";
import { documentParametersBridge, formatEvaluatedVariable } from "./parameters";
import { findTreeNode, ReadOnlyPropertyGrid, ReadOnlyPropertySections } from "./shared";
import "../CADInspector.css";

export function InspectorPanel(_props: { placement: CADPanelPlacement }) {
  const [unitsOpen, setUnitsOpen] = useState(false);
  const [sketchEditing, setSketchEditing] = useState(false);
  const [quickDrafts, setQuickDrafts] = useState<Record<string, string>>({});
  const [paramError, setParamError] = useState("");

  useEffect(() => {
    const onSketchMode = (event: Event) => setSketchEditing(Boolean((event as CustomEvent).detail));
    window.addEventListener("aether-sketch-mode", onSketchMode);
    return () => window.removeEventListener("aether-sketch-mode", onSketchMode);
  }, []);

  const workspace = useSyncExternalStore(cadWorkspace.subscribe, cadWorkspace.snapshot, cadWorkspace.snapshot);
  const selection = useSyncExternalStore(cadSelection.subscribe, cadSelection.snapshot, cadSelection.snapshot);
  const commands = useSyncExternalStore(cadCommands.subscribe, cadCommands.snapshot, cadCommands.snapshot);
  const presentation = useSyncExternalStore(cadPresentation.subscribe, cadPresentation.snapshot, cadPresentation.snapshot);
  const assembly = useSyncExternalStore(
    cadAssemblyWorkspace.subscribe,
    cadAssemblyWorkspace.snapshot,
    cadAssemblyWorkspace.snapshot,
  );
  const { doc, onApply } = useSyncExternalStore(
    documentParametersBridge.subscribe,
    documentParametersBridge.snapshot,
    documentParametersBridge.snapshot,
  );

  const selectedTreeNode =
    workspace.selectedItemIDs.size === 1
      ? findTreeNode(workspace.itemNodes, [...workspace.selectedItemIDs][0])
      : undefined;
  const editable = selectedTreeNode?.actions?.some((action) => action.id === "edit-feature");
  const suppressAction = selectedTreeNode?.actions?.find((action) => action.id === "suppress-feature");
  const rollbackAction = selectedTreeNode?.actions?.find((action) => action.id === "rollback-before");
  const saved = typeof location !== "undefined" && new URLSearchParams(location.search).has("document");
  const canonicalAssembly = assembly.loadState === "ready" && assembly.data !== null;

  const bodies = doc ? availableBodies(doc) : [];
  const primaryPicked = selection.items[0];
  const pickedBodyId = primaryPicked?.partId && bodies.some((b) => b.id === primaryPicked.partId) ? primaryPicked.partId : undefined;
  const pickedMaterial = doc && pickedBodyId ? materialForBody(doc, pickedBodyId) : undefined;

  const favorites = (doc?.variables ?? []).filter((v) => v.favorite);
  let evaluated = new Map<string, unknown>();
  try {
    if (favorites.length && doc?.variables) evaluated = evaluateDocumentVariables(doc.variables);
  } catch {
    evaluated = new Map();
  }

  const applyPinnedParam = async (variable: DocumentVariable) => {
    if (!doc) return;
    const nextExpr = (quickDrafts[variable.name] ?? variable.expression).trim();
    if (!nextExpr || nextExpr === variable.expression) return;
    setParamError("");
    try {
      const nextVars = (doc.variables ?? []).map((v) =>
        v.name === variable.name ? { ...v, expression: nextExpr } : v,
      );
      const nextDoc = await updatePartDocumentVariables(doc, nextVars);
      await onApply?.(nextDoc);
      documentParametersBridge.bind(nextDoc, onApply);
      setQuickDrafts((prev) => {
        const copy = { ...prev };
        delete copy[variable.name];
        return copy;
      });
    } catch (err) {
      setParamError(err instanceof Error ? err.message : String(err));
    }
  };

  // Determine the live contextual header from what the user is actively interacting with.
  const renderContextBanner = () => {
    if (sketchEditing) {
      return (
        <div className="cad-context-banner" data-context="sketch">
          <div className="cad-context-header">
            <span className="cad-context-icon"><AetherIcon name="sketch" /></span>
            <div className="cad-context-meta">
              <div className="cad-context-title-row">
                <span className="cad-context-title">Editing sketch</span>
                <span className="cad-pill cad-pill--accent">2D Sketch</span>
              </div>
              <span className="cad-context-subtitle">
                {selection.items.length
                  ? `${selection.items.length} sketch item${selection.items.length === 1 ? "" : "s"} selected`
                  : "Draw geometry, add dimensions, or click Apply when fully defined."}
              </span>
            </div>
          </div>
          <div className="cad-context-actions">
            <Button disabled={!commands["fit-view"].enabled} onClick={() => cadCommands.execute("fit-view")}>
              <AetherIcon name="fit" /><span>Fit</span>
            </Button>
            <Button onClick={() => requestCADPropertyPanel("parameters")}>
              <AetherIcon name="scribble-variable" /><span>Parameters</span>
            </Button>
          </div>
        </div>
      );
    }

    if (canonicalAssembly) {
      const summary = assembly.data!.summary;
      const statusTone = summary.solveStatus === "solved" ? "cad-pill--ok" : "cad-pill--warn";
      return (
        <div className="cad-context-banner" data-context="assembly">
          <div className="cad-context-header">
            <span className="cad-context-icon"><AetherIcon name="assembly" /></span>
            <div className="cad-context-meta">
              <div className="cad-context-title-row">
                <span className="cad-context-title">{presentation.documentName}</span>
                <span className={`cad-pill ${statusTone}`}>{summary.solveStatus}</span>
              </div>
              <span className="cad-context-subtitle">
                {summary.instanceCount} instance{summary.instanceCount === 1 ? "" : "s"} · {summary.mateCount} mate{summary.mateCount === 1 ? "" : "s"} · {summary.remainingFreeDOFCount} free DOF
              </span>
            </div>
          </div>
          <div className="cad-context-actions">
            {commands["assembly-edit-component"].enabled && (
              <Button onClick={() => cadCommands.execute("assembly-edit-component")}>Placement…</Button>
            )}
            {commands["assembly-open-component-part"].enabled && (
              <Button onClick={() => cadCommands.execute("assembly-open-component-part")}>Open Part</Button>
            )}
            {commands["assembly-set-mate-dof-value"].enabled && (
              <Button onClick={() => cadCommands.execute("assembly-set-mate-dof-value")}>Drive DOF…</Button>
            )}
            {commands["assembly-edit-mate-dof-limits"].enabled && (
              <Button onClick={() => cadCommands.execute("assembly-edit-mate-dof-limits")}>Limits…</Button>
            )}
            <Button onClick={() => requestCADPropertyPanel("mates")}>Mates &amp; BOM</Button>
          </div>
        </div>
      );
    }

    if (selectedTreeNode && editable) {
      return (
        <div className="cad-context-banner" data-context="feature">
          <div className="cad-context-header">
            <span className="cad-context-icon"><AetherIcon name="layers" /></span>
            <div className="cad-context-meta">
              <div className="cad-context-title-row">
                <span className="cad-context-title">{selectedTreeNode.label}</span>
                <span className="cad-pill cad-pill--accent">Feature</span>
              </div>
              <span className="cad-context-subtitle">Quick feature controls for the active selection.</span>
            </div>
          </div>
          <div className="cad-context-actions">
            <Button primary onClick={() => cadWorkspace.dispatch({ type: "item-action", id: selectedTreeNode.id, actionID: "edit-feature" })}>
              Edit
            </Button>
            {suppressAction && (
              <Button onClick={() => cadWorkspace.dispatch({ type: "item-action", id: selectedTreeNode.id, actionID: "suppress-feature" })}>
                {suppressAction.label.startsWith("Unsuppress") ? "Unsuppress" : "Suppress"}
              </Button>
            )}
            {rollbackAction && (
              <Button onClick={() => cadWorkspace.dispatch({ type: "item-action", id: selectedTreeNode.id, actionID: "rollback-before" })}>
                Roll before
              </Button>
            )}
          </div>
        </div>
      );
    }

    if (selection.items.length > 0) {
      const label =
        selection.items.length === 1
          ? primaryPicked.label
          : `${selection.items.length} entities selected`;
      return (
        <div className="cad-context-banner" data-context="geometry">
          <div className="cad-context-header">
            <span className="cad-context-icon"><AetherIcon name="cube" /></span>
            <div className="cad-context-meta">
              <div className="cad-context-title-row">
                <span className="cad-context-title">{label}</span>
                <span className="cad-pill cad-pill--accent">{primaryPicked.kind}</span>
              </div>
              <span className="cad-context-subtitle">
                {pickedMaterial
                  ? `Material: ${pickedMaterial.name} (${pickedMaterial.densityKgPerM3} kg/m³)`
                  : "Pick additional geometry or open Measure / Appearance."}
              </span>
            </div>
          </div>
          <div className="cad-context-actions">
            <Button disabled={!commands.measure.enabled} onClick={() => cadCommands.execute("measure")}>
              <AetherIcon name="tape-measure" /><span>Measure</span>
            </Button>
            <Button onClick={() => requestCADPropertyPanel("visualization")}>Appearance</Button>
            <Button onClick={() => requestCADPropertyPanel("physical-material")}>Material</Button>
          </div>
        </div>
      );
    }

    return (
      <div className="cad-context-banner" data-context="document">
        <div className="cad-context-header">
          <span className="cad-context-icon"><AetherIcon name="file-part" /></span>
          <div className="cad-context-meta">
            <div className="cad-context-title-row">
              <span className="cad-context-title">{presentation.documentName}</span>
              <span className="cad-pill">{presentation.partOpen ? "Part" : "Empty"}</span>
            </div>
            <span className="cad-context-subtitle">
              {doc
                ? `${bodies.length} bod${bodies.length === 1 ? "y" : "ies"} · ${doc.features.length} feature${doc.features.length === 1 ? "" : "s"}${(doc.variables?.length ?? 0) > 0 ? ` · ${doc.variables!.length} var` : ""}`
                : "Select a feature, body, face, or edge to inspect and adjust it."}
            </span>
          </div>
        </div>
        {presentation.partOpen && (
          <div className="cad-context-actions">
            <Button onClick={() => requestCADPropertyPanel("parameters")}>Parameters</Button>
            <Button onClick={() => requestCADPropertyPanel("physical-material")}>Material</Button>
            <Button onClick={() => requestCADPropertyPanel("configurations")}>Configs</Button>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      {renderContextBanner()}

      {favorites.length > 0 && !canonicalAssembly && (
        <InspectorSection defaultOpen title={`Pinned parameters (${favorites.length})`}>
          <ul className="cad-inspector-card-list" aria-label="Quick pinned parameters">
            {favorites.map((v) => {
              const draft = quickDrafts[v.name] ?? v.expression;
              const dirty = draft.trim() !== v.expression;
              return (
                <li key={v.name} className="cad-inspector-card">
                  <div className="cad-inspector-card-header">
                    <span className="cad-inspector-card-title">#{v.name}</span>
                    {evaluated.has(v.name) && (
                      <span className="cad-pill cad-pill--accent">{formatEvaluatedVariable(evaluated.get(v.name))}</span>
                    )}
                  </div>
                  <div className="cad-inline-edit-row">
                    <TextField
                      aria-label={`Adjust ${v.name}`}
                      value={draft}
                      onChange={(e) => setQuickDrafts((prev) => ({ ...prev, [v.name]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === "Enter") void applyPinnedParam(v); }}
                    />
                    <Button primary disabled={!dirty} onClick={() => void applyPinnedParam(v)}>Set</Button>
                  </div>
                </li>
              );
            })}
          </ul>
          {paramError && <p role="alert" className="cad-callout cad-callout--error">{paramError}</p>}
        </InspectorSection>
      )}

      <InspectorSection defaultOpen title={canonicalAssembly ? "Assembly selection" : "Selection"}>
        {canonicalAssembly ? (
          <ReadOnlyPropertySections
            sections={assembly.data!.inspectorSections}
            ariaLabel="Assembly inspector"
            emptyState="Select an Assembly entity to inspect Core-projected values."
          />
        ) : (
          <ReadOnlyPropertyGrid
            ariaLabel="Part inspector"
            emptyState="Create or open a Part to inspect document, feature, and exact-topology values."
          />
        )}
      </InspectorSection>

      <InspectorSection defaultOpen title="Editing and units">
        <InspectorActions>
          <Button
            disabled={!editable}
            onClick={() => {
              if (selectedTreeNode) {
                cadWorkspace.dispatch({ type: "item-action", id: selectedTreeNode.id, actionID: "edit-feature" });
              }
            }}
          >
            Edit selected feature
          </Button>
          <Button disabled={!saved} onClick={() => setUnitsOpen(true)}>
            Units and precision…
          </Button>
        </InspectorActions>
      </InspectorSection>

      {unitsOpen && <CADDocumentSettings action="units" onClose={() => setUnitsOpen(false)} />}
    </>
  );
}
