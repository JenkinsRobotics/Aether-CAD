import { useEffect, useRef, useState } from "react";
import {
  AetherIcon,
  AppIcon,
  AppearanceToggle,
  Button,
  DocumentBar,
  FieldRow,
  SelectField,
  SettingsWindow,
  StatusBar,
  StudioModeButton,
  Tabs,
  TextField,
  ThemeMenu,
  TreePanel,
  WorkspaceRibbon,
  WorkspaceShell,
  type LayoutPreset,
  type AetherIconName,
} from "@aether/ui";
import { HarnessCanvas } from "./HarnessCanvas";
import { HarnessInspector } from "./HarnessInspector";
import { HarnessGroups } from "./HarnessGroups";
import { HarnessReports } from "./HarnessReports";
import { exampleHarness } from "./fixture";
import {
  connect,
  parseDocument,
  removeSelection,
  type Endpoint,
  type HarnessDocument,
  type Point,
  type View,
} from "./model";
import {
  addBundle,
  bomCSV,
  connectionCSV,
  moveConnector,
  newConnector,
  validateHarness,
} from "./operations";
import { useHarnessDocument, download } from "./useHarnessDocument";
import { exportDrawing } from "./export";
import "./harness.css";

type Screen = View | "connections" | "parts";
export function HarnessApp() {
  const {
    doc,
    change,
    preview,
    undo,
    redo,
    canUndo,
    canRedo,
    message,
    setMessage,
  } = useHarnessDocument();
  const [screen, setScreen] = useState<Screen>("layout"),
    [selected, setSelected] = useState<string | null>(null),
    [tool, setTool] = useState("select"),
    [pending, setPending] = useState<Endpoint | null>(null),
    [zoom, setZoom] = useState(0.72),
    [split, setSplit] = useState(false),
    [layout, setLayout] = useState<LayoutPreset>("docked"),
    [settings, setSettings] = useState(false),
    [snap, setSnap] = useState(true),
    [tables, setTables] = useState(true),
    [nets, setNets] = useState(true);
  const [revisionName, setRevisionName] = useState(""),
    [revisions, setRevisions] = useState<
      { name: string; doc: HarnessDocument }[]
    >(() => {
      try {
        return JSON.parse(
          localStorage.getItem("aether.cad.harness-revisions.v1") ?? "[]",
        ).map((r: { name: string; doc: unknown }) => ({
          name: String(r.name),
          doc: parseDocument(JSON.stringify(r.doc)),
        }));
      } catch {
        return [];
      }
    });
  const stage = useRef<HTMLDivElement>(null),
    file = useRef<HTMLInputElement>(null);
  const view: View = screen === "harness" ? "harness" : "layout";
  const remove = () => {
    if (!selected) return;
    const next = removeSelection(doc, selected);
    if (next === doc) {
      setMessage("Unlock the group before deleting its components");
      return;
    }
    change(next);
    setSelected(null);
  };
  const select = (id: string | null) => {
    if (tool === "bundle" && id && doc.connectors.some((c) => c.id === id)) {
      if (!pending) {
        setPending({ connector: id, pin: "1" });
        setMessage("Choose the other bundle endpoint");
      } else {
        const next = addBundle(doc, pending.connector, id);
        change(next);
        setPending(null);
        if (next !== doc) setSelected(next.branches.at(-1)!.id);
        setMessage(
          next === doc
            ? "Bundle already exists or endpoints are invalid"
            : "Bundle connected — set its length in Properties",
        );
      }
    } else setSelected(id);
  };
  const pin = (e: Endpoint) => {
    setSelected(e.connector);
    if (tool !== "wire") {
      setMessage(
        `${doc.connectors.find((c) => c.id === e.connector)?.title} · pin ${e.pin}`,
      );
      return;
    }
    if (!pending) {
      setPending(e);
      setMessage("Choose a destination pin");
    } else {
      const next = connect(doc, pending, e);
      change(next);
      setPending(null);
      setMessage(
        next === doc
          ? "Connection already exists or endpoints are invalid"
          : "Wire created",
      );
    }
  };
  const fit = () => {
    const el = stage.current;
    if (el) {
      setZoom(
        Math.max(
          0.15,
          Math.min(
            (el.clientWidth - 40) / (split ? 1880 : 940),
            (el.clientHeight - 40) / 1800,
          ),
        ),
      );
      el.scrollTo(0, 0);
    }
  };
  const command = (id: string) => {
    if (["select", "wire", "bundle"].includes(id)) {
      setTool(id);
      setPending(null);
      if (id === "wire") setScreen("harness");
      if (id === "bundle") setScreen("layout");
    } else if (
      [
        "connector",
        "terminal",
        "splice",
        "diode",
        "resistor",
        "branch",
      ].includes(id)
    ) {
      const c = newConnector(id as Parameters<typeof newConnector>[0]);
      let slot = 0;
      while (
        doc.connectors.some(
          (x) => x.layout[0] === c.layout[0] && x.layout[1] === c.layout[1],
        )
      ) {
        slot++;
        c.layout = [80 + (slot % 5) * 160, 180 + Math.floor(slot / 5) * 160];
        c.harness = [c.layout[0], c.layout[1]];
      }
      change({ ...doc, connectors: [...doc.connectors, c] });
      setSelected(c.id);
      if (id === "branch") setScreen("layout");
      stage.current?.scrollTo(0, 0);
    } else if (id === "note") {
      const n = {
        id: crypto.randomUUID(),
        text: "Assembly note",
        view,
        at: [70, 80] as Point,
      };
      change({ ...doc, notes: [...(doc.notes ?? []), n] });
      setSelected(n.id);
    } else if (id === "undo") undo();
    else if (id === "redo") redo();
    else if (id === "delete") remove();
    else if (id === "fit") fit();
    else if (id === "save")
      download(`${doc.name}.aetherharness`, JSON.stringify(doc, null, 2));
    else if (id === "open") file.current?.click();
    else if (id === "example") {
      change(exampleHarness());
      setSelected(null);
      setMessage("Example restored — Undo returns to your draft");
    } else if (id === "connections")
      download("connections.csv", connectionCSV(doc), "text/csv");
    else if (id === "bom") download("parts.csv", bomCSV(doc), "text/csv");
    else if (id === "svg") {
      const svg = stage.current?.querySelector("svg");
      if (svg)
        void exportDrawing(svg, `${doc.name}-${view}`).catch((e) =>
          setMessage(String(e)),
        );
      else setMessage("Open Layout or Harness to export a drawing");
    }
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        (e.target as Element).closest(
          "input,textarea,select,[contenteditable=true],[role=dialog]",
        )
      )
        return;
      if (e.key === "Escape") {
        setPending(null);
        setTool("select");
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        remove();
      }
      if (e.key.toLowerCase() === "f" && !e.metaKey && !e.ctrlKey) fit();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  const icon = (name: AetherIconName) => <AetherIcon name={name} />;
  const cmd = (
    id: string,
    label: string,
    name: AetherIconName,
    disabled = false,
  ) => ({ id, label, icon: icon(name), active: tool === id, disabled });
  const toolbar = (
    <WorkspaceRibbon
      workspaces={[
        { id: "electrical", label: "Electrical", icon: icon("hardware") },
      ]}
      workspaceID="electrical"
      onWorkspaceSelect={() => {}}
      activeTabID="design"
      onTabSelect={() => {}}
      onCommand={command}
      tabs={[
        {
          id: "design",
          label: "Design",
          groups: [
            {
              id: "select",
              label: "Select",
              tools: [
                cmd("select", "Select", "cursor"),
                cmd("wire", "Wire", "link"),
                cmd("bundle", "Bundle", "branch"),
              ],
            },
            {
              id: "create",
              label: "Components",
              tools: [
                cmd("connector", "Connector", "hardware"),
                cmd("terminal", "Terminal", "circle"),
                cmd("splice", "Splice", "plus"),
                cmd("branch", "Branch point", "branch"),
                cmd("note", "Note", "document"),
              ],
              menuItems: [
                { id: "diode", label: "Add diode" },
                { id: "resistor", label: "Add resistor" },
              ],
            },
            {
              id: "edit",
              label: "Edit",
              tools: [
                cmd("undo", "Undo", "undo", !canUndo),
                cmd("redo", "Redo", "redo", !canRedo),
                cmd("delete", "Delete", "delete", !selected),
              ],
            },
            {
              id: "document",
              label: "Document",
              tools: [
                cmd("open", "Open", "folder"),
                cmd("save", "Save file", "save"),
                cmd("fit", "Fit", "fit"),
              ],
              menuItems: [
                { id: "svg", label: "Export drawing SVG" },
                { id: "connections", label: "Export connections CSV" },
                { id: "bom", label: "Export BOM CSV" },
                { id: "example", label: "Restore example" },
              ],
            },
          ],
        },
      ]}
    />
  );
  const issues = validateHarness(doc);
  const left = (
    <TreePanel
      title="Objects"
      ariaLabel="Harness objects"
      nodes={[
        {
          id: "components",
          label: "Components",
          badge: String(doc.connectors.length),
          children: doc.connectors.map((c) => ({
            id: c.id,
            label: c.title,
            icon: icon("hardware"),
            badge: String(c.pins.length),
          })),
        },
        {
          id: "wires",
          label: "Wires",
          badge: String(doc.wires.length),
          children: doc.wires.map((w) => ({
            id: w.id,
            label: w.ident || w.id,
            icon: icon("link"),
          })),
        },
        {
          id: "bundles",
          label: "Bundles",
          badge: String(doc.branches.length),
          children: doc.branches.map((b) => ({
            id: b.id,
            label: b.id,
            icon: icon("branch"),
          })),
        },
      ]}
      selectedIDs={new Set(selected ? [selected] : [])}
      onSelect={(ids) => select(ids[0] ?? null)}
      controls={[
        {
          id: "new",
          label: "Add connector",
          icon: icon("plus"),
          onClick: () => command("connector"),
        },
        {
          id: "delete",
          label: "Delete selection",
          icon: icon("delete"),
          disabled: !selected,
          onClick: remove,
        },
      ]}
    />
  );
  const revisionPanel = (
    <div className="cad-harness-inspector">
      <h2>Revisions</h2>
      <p>Named snapshots stored in this browser.</p>
      <TextField
        aria-label="Revision name"
        placeholder="Design review 01"
        value={revisionName}
        onChange={(e) => setRevisionName(e.target.value)}
      />
      <Button
        disabled={!revisionName.trim()}
        onClick={() => {
          const next = [
            { name: revisionName.trim(), doc: structuredClone(doc) },
            ...revisions,
          ].slice(0, 20);
          setRevisions(next);
          try {
            localStorage.setItem(
              "aether.cad.harness-revisions.v1",
              JSON.stringify(next),
            );
            setMessage("Revision saved");
          } catch {
            setMessage(
              "Revision is available this session only — storage is full",
            );
          }
          setRevisionName("");
        }}
      >
        Create revision
      </Button>
      {revisions.map((r, i) => (
        <Button
          key={i}
          onClick={() => {
            change(structuredClone(r.doc));
            setMessage(`Restored ${r.name}`);
          }}
        >
          Restore {r.name}
        </Button>
      ))}
    </div>
  );
  return (
    <div className="cad-harness-app">
      <DocumentBar
        leading={
          <>
            <a href="./index.html" title="Aether CAD">
              <AppIcon app="cad" size={30} />
            </a>
            <strong>{doc.name}</strong>
            <span className="cad-harness-subtitle">Harness · Local draft</span>
          </>
        }
        trailing={
          <>
            <StudioModeButton preset={layout} onChange={setLayout} />
            <ThemeMenu />
            <AppearanceToggle />
            <Button
              aria-label="Harness settings"
              onClick={() => setSettings(true)}
            >
              {icon("settings")}
            </Button>
          </>
        }
      />
      <WorkspaceShell
        preset={layout}
        sidebarVariant="tabs-top"
        leftPanels={[
          {
            id: "objects",
            title: "Objects",
            icon: icon("layers"),
            content: left,
          },
          {
            id: "groups",
            title: "Groups",
            icon: icon("folder"),
            content: <HarnessGroups doc={doc} view={view} change={change} />,
          },
          {
            id: "revisions",
            title: "Revisions",
            icon: icon("history"),
            content: revisionPanel,
          },
        ]}
        rightPanels={[
          {
            id: "properties",
            title: "Properties",
            icon: icon("settings"),
            content: (
              <HarnessInspector
                view={view}
                doc={doc}
                selected={selected}
                change={change}
                onDelete={remove}
              />
            ),
          },
          {
            id: "review",
            title: "Review",
            icon: icon("info"),
            content: (
              <div className="cad-harness-inspector">
                <h2>Design review</h2>
                <p>
                  {issues.length} observations · connectivity and assignment
                  checks
                </p>
                {issues.map((issue, i) => (
                  <Button key={i} onClick={() => setSelected(issue.id)}>
                    {issue.message}
                  </Button>
                ))}
                <p>
                  Checks do not certify current capacity, insulation, contacts
                  or manufacturing readiness.
                </p>
              </div>
            ),
          },
        ]}
        defaultOpenLeft={["objects"]}
        defaultOpenRight={["properties"]}
        toolbar={toolbar}
        statusBar={
          <StatusBar
            leading="Aether CAD · Harness"
            center={message}
            trailing={`${doc.connectors.length} components · ${doc.wires.length} wires · ${doc.branches.length} bundles`}
          />
        }
      >
        <div className="cad-harness-workspace">
          <div className="cad-harness-viewbar">
            <Tabs
              tabs={[
                { id: "layout", label: "Layout" },
                { id: "harness", label: "Harness" },
                { id: "connections", label: "Connections" },
                { id: "parts", label: "Parts" },
              ]}
              activeID={screen}
              onSelect={(id) => {
                setScreen(id as Screen);
                setPending(null);
                setTool("select");
              }}
            />
            <Button aria-pressed={split} onClick={() => setSplit(!split)}>
              Split view
            </Button>
          </div>
          {screen === "connections" || screen === "parts" ? (
            <HarnessReports
              doc={doc}
              view={screen}
              selected={selected}
              onSelect={setSelected}
              change={change}
            />
          ) : (
            <>
              <div
                ref={stage}
                className="cad-harness-stage"
                tabIndex={0}
                aria-label="Harness drawing viewport"
              >
                <div className="cad-harness-sheets">
                  {(split ? (["layout", "harness"] as View[]) : [view]).map(
                    (v) => (
                      <HarnessCanvas
                        key={v}
                        doc={doc}
                        view={v}
                        zoom={zoom}
                        selected={selected}
                        pending={pending}
                        wiring={tool === "wire"}
                        dragging={tool === "select"}
                        onSelect={select}
                        onPin={pin}
                        onMove={(id, at, commit) =>
                          preview(
                            moveConnector(
                              doc,
                              id,
                              v,
                              snap
                                ? [
                                    Math.round(at[0] / 10) * 10,
                                    Math.round(at[1] / 10) * 10,
                                  ]
                                : at,
                            ),
                            commit,
                          )
                        }
                        showTables={tables}
                        highlightNets={nets}
                        onChange={change}
                        onRouteMove={preview}
                      />
                    ),
                  )}
                </div>
              </div>
              <div className="cad-harness-viewtools">
                <Button aria-pressed={snap} onClick={() => setSnap(!snap)}>
                  Snap
                </Button>
                <Button
                  aria-pressed={tables}
                  onClick={() => setTables(!tables)}
                >
                  Tables
                </Button>
                <Button aria-pressed={nets} onClick={() => setNets(!nets)}>
                  Highlight nets
                </Button>
                <span />
                <Button onClick={fit}>Fit drawing</Button>
                <Button
                  aria-label="Zoom out"
                  onClick={() => setZoom((z) => Math.max(0.15, z - 0.1))}
                >
                  −
                </Button>
                <span>{Math.round(zoom * 100)}%</span>
                <Button
                  aria-label="Zoom in"
                  onClick={() => setZoom((z) => Math.min(2, z + 0.1))}
                >
                  +
                </Button>
              </div>
            </>
          )}
        </div>
      </WorkspaceShell>
      <input
        ref={file}
        type="file"
        accept=".aetherharness,.json"
        hidden
        aria-label="Open harness file"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          try {
            if (f.size > 5_000_000) throw Error("File exceeds 5 MB");
            change(parseDocument(await f.text()));
            setSelected(null);
            setMessage("Harness opened");
          } catch (error) {
            setMessage(`Could not open: ${String(error)}`);
          }
          e.target.value = "";
        }}
      />
      <SettingsWindow
        open={settings}
        title="Aether CAD Harness settings"
        sections={[
          { title: "Document", panes: [{ id: "harness", label: "Harness" }] },
        ]}
        activePaneID="harness"
        onSelectPane={() => {}}
        onClose={() => setSettings(false)}
      >
        <FieldRow label="Workspace layout">
          <SelectField
            aria-label="Workspace layout"
            value={layout}
            options={["docked", "floating", "canvas"].map((value) => ({
              value,
              label: value,
            }))}
            onChange={(e) => setLayout(e.target.value as LayoutPreset)}
          />
        </FieldRow>
        <p>
          Harness drawings are local design studies. Save a file or named
          revision to keep a checkpoint.
        </p>
        <Button onClick={() => command("example")}>Restore example</Button>
        <Button onClick={() => command("save")}>Save harness file</Button>
        <Button onClick={() => command("svg")}>Export drawing SVG</Button>
        <Button onClick={() => command("connections")}>
          Export connections CSV
        </Button>
        <Button onClick={() => command("bom")}>Export BOM CSV</Button>
      </SettingsWindow>
    </div>
  );
}
