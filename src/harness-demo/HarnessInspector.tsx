import {
  Button,
  Checkbox,
  FieldRow,
  TextField,
  SelectField,
  HarnessDrawingScope,
  ConnectorFace,
  ConnectorPreview,
} from "@aether/ui";
import {
  type HarnessDocument,
  type Connector,
  type View,
  wireColors,
} from "./model";
import {
  routeWire,
  endpointLabel,
  splitBranch,
  mateConnector,
  propagateSignal,
} from "./operations";
export function HarnessInspector({
  doc,
  selected,
  change,
  onDelete,
  view,
}: {
  doc: HarnessDocument;
  selected: string | null;
  change: (d: HarnessDocument) => void;
  onDelete: () => void;
  view: View;
}) {
  const c = doc.connectors.find((c) => c.id === selected),
    w = doc.wires.find((w) => w.id === selected),
    b = doc.branches.find((b) => b.id === selected),
    n = doc.notes?.find((n) => n.id === selected);
  const updateConnector = (patch: Partial<Connector>) =>
    change({
      ...doc,
      connectors: doc.connectors.map((x) =>
        x.id === c!.id ? { ...x, ...patch } : x,
      ),
    });
  return (
    <div className="cad-harness-inspector">
      <small>PROPERTIES</small>
      <h2>
        {c?.title ?? (w ? "Wire" : b ? "Bundle" : n ? "Note" : "Harness")}
      </h2>
      {!c && !w && !b && !n && (
        <>
          <p>
            Select a connector, wire or bundle to edit its properties. Drag a
            connector to arrange the drawing.
          </p>
          <FieldRow label="Document name">
            <TextField
              aria-label="Harness name"
              value={doc.name}
              onChange={(e) => change({ ...doc, name: e.target.value })}
            />
          </FieldRow>
          <p>
            Layout defines physical branches. Harness defines pin-to-pin
            connections.
          </p>
        </>
      )}
      {c && (
        <>
          <svg viewBox="0 0 230 100" aria-label="Selected connector preview">
            <HarnessDrawingScope>
              <g transform="translate(6 9)">
                <ConnectorPreview title={c.title} tone={c.tone} />
              </g>
              <g transform="translate(134 10)">
                <ConnectorFace
                  title={c.title}
                  pins={c.pins.map((p) => p.id)}
                  triangular={c.id.startsWith("coil")}
                />
              </g>
            </HarnessDrawingScope>
          </svg>
          <FieldRow label="Name">
            <TextField
              aria-label="Connector name"
              value={c.title}
              onChange={(e) => updateConnector({ title: e.target.value })}
            />
          </FieldRow>
          <FieldRow label="Housing">
            <SelectField
              aria-label="Housing color"
              value={c.tone}
              options={["neutral", "green", "blue", "orange"].map((value) => ({
                value,
                label: value,
              }))}
              onChange={(e) =>
                updateConnector({ tone: e.target.value as Connector["tone"] })
              }
            />
          </FieldRow>
          <FieldRow label="Part">
            <SelectField
              aria-label="Connector part"
              value={c.partID ?? ""}
              options={[
                { value: "", label: "Unassigned" },
                ...(doc.parts ?? [])
                  .filter((p) => p.kind !== "Wire")
                  .map((p) => ({ value: p.id, label: p.number })),
              ]}
              onChange={(e) =>
                updateConnector({ partID: e.target.value || undefined })
              }
            />
          </FieldRow>
          <Checkbox
            label={`Wiring table in ${view}`}
            checked={!!c.tables?.[view]}
            onChange={(e) => {
              const tables = { ...c.tables };
              if (e.target.checked) tables[view] = [0, -140];
              else delete tables[view];
              updateConnector({ tables });
            }}
          />
          {!c.terminal && (
            <FieldRow label="Mating connector">
              <SelectField
                aria-label="Mating connector"
                value={
                  (doc.mates ?? []).find((m) => m.a === c.id || m.b === c.id)
                    ?.a === c.id
                    ? (doc.mates ?? []).find((m) => m.a === c.id)!.b
                    : ((doc.mates ?? []).find((m) => m.b === c.id)?.a ?? "")
                }
                options={[
                  { value: "", label: "None" },
                  ...doc.connectors
                    .filter(
                      (x) =>
                        x.id !== c.id &&
                        !x.terminal &&
                        x.pins.length === c.pins.length,
                    )
                    .map((x) => ({ value: x.id, label: x.title })),
                ]}
                onChange={(e) =>
                  change(mateConnector(doc, c.id, e.target.value || null))
                }
              />
            </FieldRow>
          )}
          <h3>Pin assignments</h3>
          {c.pins.map((p) => (
            <FieldRow key={p.id} label={`Pin ${p.id}`}>
              <TextField
                aria-label={`Pin ${p.id} signal`}
                value={p.label}
                onChange={(e) =>
                  updateConnector({
                    pins: c.pins.map((pin) =>
                      pin.id === p.id ? { ...pin, label: e.target.value } : pin,
                    ),
                  })
                }
              />
            </FieldRow>
          ))}
          <Button onClick={() => change(propagateSignal(doc, c.id))}>
            Fill connected blank signals
          </Button>
          <Button
            disabled={c.pins.length >= 12}
            onClick={() => {
              let id = String(c.pins.length + 1);
              while (c.pins.some((p) => p.id === id))
                id = String(Number(id) + 1);
              updateConnector({
                pins: [...c.pins, { id, label: "" }],
                terminal: false,
              });
            }}
          >
            Add pin
          </Button>
          <Button
            onClick={() => updateConnector({ vertical: !c.vertical })}
            disabled={c.terminal}
          >
            Rotate schematic
          </Button>
        </>
      )}
      {w &&
        (() => {
          const route = routeWire(doc, w);
          const patch = (p: Partial<typeof w>) =>
            change({
              ...doc,
              wires: doc.wires.map((x) => (x.id === w.id ? { ...x, ...p } : x)),
            });
          return (
            <>
              <p>
                {endpointLabel(doc, w.from)} → {endpointLabel(doc, w.to)}
              </p>
              <FieldRow label="Identification">
                <TextField
                  aria-label="Wire identification"
                  value={w.ident ?? ""}
                  onChange={(e) => patch({ ident: e.target.value })}
                />
              </FieldRow>
              <FieldRow label="Color">
                <SelectField
                  aria-label="Wire color"
                  value={w.color}
                  options={wireColors.map((value, i) => ({
                    value,
                    label: [
                      "Orange",
                      "Yellow",
                      "Green",
                      "Blue",
                      "Red",
                      "Violet",
                      "Brown",
                      "Gray",
                    ][i],
                  }))}
                  onChange={(e) => patch({ color: e.target.value })}
                />
              </FieldRow>
              <FieldRow label="Stripe">
                <SelectField
                  aria-label="Wire stripe"
                  value={w.stripeColor ?? ""}
                  options={[
                    { value: "", label: "None" },
                    ...wireColors.map((value, i) => ({
                      value,
                      label: [
                        "Orange",
                        "Yellow",
                        "Green",
                        "Blue",
                        "Red",
                        "Violet",
                        "Brown",
                        "Gray",
                      ][i],
                    })),
                  ]}
                  onChange={(e) =>
                    patch({ stripeColor: e.target.value || undefined })
                  }
                />
              </FieldRow>
              <FieldRow label="Gauge">
                <TextField
                  aria-label="Wire gauge"
                  unit="AWG"
                  type="number"
                  min="0"
                  max="40"
                  value={w.gaugeAWG}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (n >= 0 && n <= 40) patch({ gaugeAWG: n });
                  }}
                />
              </FieldRow>
              <FieldRow label="Part">
                <SelectField
                  aria-label="Wire part"
                  value={w.partID ?? ""}
                  options={[
                    { value: "", label: "Unassigned" },
                    ...(doc.parts ?? [])
                      .filter((p) => p.kind === "Wire")
                      .map((p) => ({ value: p.id, label: p.number })),
                  ]}
                  onChange={(e) =>
                    patch({ partID: e.target.value || undefined })
                  }
                />
              </FieldRow>
              <FieldRow
                label={route ? "Routed length" : "Manual length · unrouted"}
              >
                <TextField
                  aria-label="Wire length"
                  unit="mm"
                  type="number"
                  min="0"
                  readOnly={!!route}
                  value={route?.lengthMm ?? w.lengthMm}
                  onChange={(e) => {
                    if (Number(e.target.value) >= 0)
                      patch({ lengthMm: Number(e.target.value) });
                  }}
                />
              </FieldRow>
              <p>
                {route
                  ? `${route.branches.length} bundles · length follows the layout`
                  : "No continuous bundle route. Connect the endpoints in Layout."}
              </p>
              <Button
                onClick={() =>
                  patch({
                    from: w.to,
                    to: w.from,
                    bends: w.bends ? [...w.bends].reverse() : undefined,
                  })
                }
              >
                Reverse direction
              </Button>
              <Button onClick={() => patch({ bends: undefined })}>
                Reset wire route
              </Button>
            </>
          );
        })()}
      {b && (
        <>
          <FieldRow label="Bundle length">
            <TextField
              aria-label="Bundle length"
              type="number"
              unit="mm"
              min="0"
              value={b.lengthMm}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (n >= 0)
                  change({
                    ...doc,
                    branches: doc.branches.map((x) =>
                      x.id === b.id ? { ...x, lengthMm: n } : x,
                    ),
                  });
              }}
            />
          </FieldRow>
          <p>Physical length updates routed wires and connection reports.</p>
          <Button onClick={() => change(splitBranch(doc, b.id))}>
            Add branch point
          </Button>
        </>
      )}
      {n && (
        <FieldRow label="Text">
          <TextField
            aria-label="Note text"
            value={n.text}
            onChange={(e) =>
              change({
                ...doc,
                notes: doc.notes!.map((x) =>
                  x.id === n.id ? { ...x, text: e.target.value } : x,
                ),
              })
            }
          />
        </FieldRow>
      )}
      {(c || w || b || n) && (
        <Button onClick={onDelete}>Delete selection</Button>
      )}
    </div>
  );
}
