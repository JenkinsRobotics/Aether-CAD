import { useState } from "react";
import { Button, DataTable, TextField, SelectField } from "@aether/ui";
import type { HarnessDocument } from "./model";
import {
  endpointLabel,
  routeWire,
  partQuantity,
  partKinds,
  type PartKind,
} from "./operations";
export function HarnessReports({
  doc,
  view,
  selected,
  onSelect,
  change,
}: {
  doc: HarnessDocument;
  view: "connections" | "parts";
  selected: string | null;
  onSelect: (id: string) => void;
  change: (d: HarnessDocument) => void;
}) {
  const [filter, setFilter] = useState(""),
    [kind, setKind] = useState<PartKind>("Connector");
  return (
    <section
      className="cad-harness-report"
      aria-label={view === "parts" ? "Harness parts" : "Harness connections"}
    >
      <div className="cad-harness-report-tools">
        <TextField
          aria-label="Filter report"
          placeholder="Search this table…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        {view === "parts" && (
          <>
            <SelectField
              aria-label="New part type"
              value={kind}
              options={partKinds.map((value) => ({ value, label: value }))}
              onChange={(e) => setKind(e.target.value as PartKind)}
            />
            <Button
              onClick={() =>
                change({
                  ...doc,
                  parts: [
                    ...(doc.parts ?? []),
                    {
                      id: crypto.randomUUID(),
                      kind,
                      number: `New ${kind}`,
                      manufacturer: "",
                      description: "",
                      unitPrice: 0,
                    },
                  ],
                })
              }
            >
              Add part
            </Button>
          </>
        )}
      </div>
      {view === "connections" ? (
        <DataTable
          ariaLabel="Connection table"
          rows={doc.wires}
          rowID={(w) => w.id}
          selectedIDs={new Set(selected ? [selected] : [])}
          onSelect={(ids) => onSelect(ids[0])}
          selectionMode="single"
          filter={filter}
          filterText={(w) =>
            `${w.id} ${endpointLabel(doc, w.from)} ${endpointLabel(doc, w.to)} ${w.ident ?? ""}`
          }
          columns={[
            {
              id: "id",
              header: "Wire",
              cell: (w) => w.ident || w.id,
              sortValue: (w) => w.id,
              sortable: true,
            },
            {
              id: "from",
              header: "From",
              cell: (w) => endpointLabel(doc, w.from),
              sortValue: (w) => endpointLabel(doc, w.from),
              sortable: true,
            },
            {
              id: "to",
              header: "Destination",
              cell: (w) => endpointLabel(doc, w.to),
              sortValue: (w) => endpointLabel(doc, w.to),
              sortable: true,
            },
            {
              id: "color",
              header: "Color",
              cell: (w) => (
                <span
                  className="cad-harness-color"
                  style={{ background: w.color }}
                />
              ),
            },
            {
              id: "gauge",
              header: "Gauge",
              cell: (w) => `${w.gaugeAWG} AWG`,
              sortValue: (w) => w.gaugeAWG,
              sortable: true,
            },
            {
              id: "length",
              header: "Length",
              cell: (w) => `${routeWire(doc, w)?.lengthMm ?? w.lengthMm} mm`,
              sortValue: (w) => routeWire(doc, w)?.lengthMm ?? w.lengthMm,
              sortable: true,
            },
            {
              id: "route",
              header: "Routing",
              cell: (w) => (routeWire(doc, w) ? "Routed" : "No route"),
            },
            {
              id: "part",
              header: "Part",
              cell: (w) =>
                doc.parts?.find((p) => p.id === w.partID)?.number ??
                "Unassigned",
            },
          ]}
        />
      ) : (
        <DataTable
          ariaLabel="Parts table"
          rows={doc.parts ?? []}
          rowID={(p) => p.id}
          selectedIDs={new Set(selected ? [selected] : [])}
          onSelect={(ids) => onSelect(ids[0])}
          selectionMode="single"
          filter={filter}
          filterText={(p) => `${p.number} ${p.kind} ${p.manufacturer}`}
          columns={[
            {
              id: "number",
              header: "Part number",
              cell: (p) => p.number,
              editable: true,
              editValue: (p) => p.number,
              sortable: true,
              sortValue: (p) => p.number,
            },
            {
              id: "kind",
              header: "Type",
              cell: (p) => p.kind,
              sortable: true,
              sortValue: (p) => p.kind,
            },
            {
              id: "manufacturer",
              header: "Manufacturer",
              cell: (p) => p.manufacturer || "—",
              editable: true,
              editValue: (p) => p.manufacturer,
            },
            {
              id: "description",
              header: "Description",
              cell: (p) => p.description || "—",
              editable: true,
              editValue: (p) => p.description,
            },
            {
              id: "quantity",
              header: "Quantity",
              cell: (p) =>
                `${partQuantity(doc, p).toFixed(p.kind === "Wire" ? 2 : 0)} ${p.kind === "Wire" ? "m" : "each"}`,
              sortable: true,
              sortValue: (p) => partQuantity(doc, p),
            },
            {
              id: "unitPrice",
              header: "Unit price",
              cell: (p) => p.unitPrice.toFixed(2),
              editable: true,
              editValue: (p) => String(p.unitPrice),
            },
            {
              id: "total",
              header: "Total",
              cell: (p) => (partQuantity(doc, p) * p.unitPrice).toFixed(2),
            },
          ]}
          onEdit={(id, column, value) => {
            if (
              !["number", "manufacturer", "description", "unitPrice"].includes(
                column,
              )
            )
              return;
            if (
              column === "unitPrice" &&
              (!Number.isFinite(Number(value)) || Number(value) < 0)
            )
              return;
            change({
              ...doc,
              parts: doc.parts!.map((p) =>
                p.id === id
                  ? {
                      ...p,
                      [column]: column === "unitPrice" ? Number(value) : value,
                    }
                  : p,
              ),
            });
          }}
        />
      )}
      <p>
        {view === "parts"
          ? `Double-click a field to edit. Total: ${(doc.parts ?? []).reduce((n, p) => n + partQuantity(doc, p) * p.unitPrice, 0).toFixed(2)} · prices are user-entered.`
          : "Lengths follow declared physical bundle lengths. Unrouted wires retain a manual length."}
      </p>
    </section>
  );
}
