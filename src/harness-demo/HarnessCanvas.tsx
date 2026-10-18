import { useRef, useId, type PointerEvent } from "react";
import {
  HarnessConnectorCard,
  ConnectorFace,
  ConnectorPreview,
  HarnessConnectionTable,
  HarnessDrawingScope,
  type HarnessConnectionRow,
} from "@aether/ui";
import { netWires, routeWire } from "./operations";
import {
  pinPoint,
  roundedPath,
  wirePath,
  insertWaypoint,
  type Connector,
  type Endpoint,
  type HarnessDocument,
  type Point,
  type View,
} from "./model";

export function connectionRows(
  doc: HarnessDocument,
  c: Connector,
): HarnessConnectionRow[] {
  return c.pins.flatMap((pin) => {
    const wires = doc.wires.filter(
      (w) =>
        (w.from.connector === c.id && w.from.pin === pin.id) ||
        (w.to.connector === c.id && w.to.pin === pin.id),
    );
    return (wires.length ? wires : [undefined]).map((wire) => {
      const e = wire && (wire.from.connector === c.id ? wire.to : wire.from),
        other = e && doc.connectors.find((x) => x.id === e.connector);
      return {
        id: wire?.id ?? c.id,
        pin: pin.id,
        destination: other
          ? `${other.title}.${e!.pin}`
          : `${pin.label} · unassigned`,
        color: wire?.color ?? "#626967",
        part: wire ? `${wire.gaugeAWG} AWG` : "—",
        length: wire
          ? `${((routeWire(doc, wire)?.lengthMm ?? wire.lengthMm) / 25.4).toFixed(1)} in`
          : "—",
        contact: "—",
      };
    });
  });
}
interface Props {
  doc: HarnessDocument;
  view: View;
  zoom: number;
  selected: string | null;
  pending: Endpoint | null;
  wiring: boolean;
  dragging: boolean;
  onSelect: (id: string | null) => void;
  onPin: (endpoint: Endpoint) => void;
  showTables: boolean;
  highlightNets: boolean;
  onChange: (doc: HarnessDocument) => void;
  onRouteMove: (doc: HarnessDocument, commit: boolean) => void;
  onMove: (id: string, at: Point, commit: boolean) => void;
}
export function HarnessCanvas({
  doc,
  view,
  zoom,
  selected,
  pending,
  wiring,
  dragging,
  onSelect,
  onPin,
  onMove,
  showTables,
  highlightNets,
  onChange,
  onRouteMove,
}: Props) {
  const patternID = useId();
  const highlights = highlightNets
    ? netWires(doc, selected)
    : new Set<string>();
  const highlightedBranches = new Set(
    doc.wires
      .filter((w) => highlights.has(w.id) || w.id === selected)
      .flatMap((w) => routeWire(doc, w)?.branches ?? []),
  );
  const svg = useRef<SVGSVGElement>(null);
  const waypoint = useRef<{ id: string; index: number } | null>(null);
  const tableDrag = useRef<{
    id: string;
    start: Point;
    at: Point;
    moved: boolean;
  } | null>(null);
  const drag = useRef<{
    id: string;
    at: Point;
    start: Point;
    moved: boolean;
  } | null>(null);
  const point = (e: PointerEvent): Point => {
    const matrix = svg.current!.getScreenCTM()!.inverse();
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix);
    return [p.x, p.y];
  };
  const down = (e: PointerEvent<SVGGElement>, c: Connector) => {
    if (
      !dragging ||
      e.button !== 0 ||
      !(e.target instanceof Element) ||
      e.target.closest(".aui-harness-pin")
    )
      return;
    e.stopPropagation();
    onSelect(c.id);
    drag.current = {
      id: c.id,
      at: [...c[view]],
      start: point(e),
      moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent<SVGGElement>) => {
    const d = drag.current;
    if (!d) return;
    const p = point(e);
    if (Math.hypot(p[0] - d.start[0], p[1] - d.start[1]) < 3 && !d.moved)
      return;
    d.moved = true;
    onMove(
      d.id,
      [
        Math.max(0, Math.min(840, d.at[0] + p[0] - d.start[0])),
        Math.max(0, Math.min(1700, d.at[1] + p[1] - d.start[1])),
      ],
      false,
    );
  };
  const up = () => {
    const d = drag.current;
    if (d?.moved) {
      const c = doc.connectors.find((c) => c.id === d.id)!;
      onMove(d.id, c[view], true);
    }
    drag.current = null;
  };
  const mates = (doc.mates ?? []).map((m) => {
    const a = doc.connectors.find((c) => c.id === m.a),
      b = doc.connectors.find((c) => c.id === m.b);
    if (!a || !b) return null;
    const center = (c: Connector): Point =>
      view === "layout"
        ? c.layout
        : c.vertical
          ? [c.harness[0] + (32 + c.pins.length * 32) / 2, c.harness[1] + 90]
          : [c.harness[0] + 90, c.harness[1] + (32 + c.pins.length * 32) / 2];
    const from = center(a),
      to = center(b),
      dx = to[0] - from[0],
      dy = to[1] - from[1],
      length = Math.hypot(dx, dy);
    if (length < 1) return null;
    const ux = dx / length,
      uy = dy / length;
    const inset = (c: Connector) =>
      view === "layout"
        ? 22
        : Math.min(
            (c.vertical ? (32 + c.pins.length * 32) / 2 : 90) /
              Math.max(Math.abs(ux), 0.001),
            (c.vertical ? 90 : (32 + c.pins.length * 32) / 2) /
              Math.max(Math.abs(uy), 0.001),
          ) + 12;
    const start: Point = [from[0] + ux * inset(a), from[1] + uy * inset(a)],
      end: Point = [to[0] - ux * inset(b), to[1] - uy * inset(b)];
    const arrow = (p: Point, d: number) =>
      `M${p[0] - ux * 6 * d - uy * 4} ${p[1] - uy * 6 * d + ux * 4}L${p.join(" ")}L${p[0] - ux * 6 * d + uy * 4} ${p[1] - uy * 6 * d - ux * 4}`;
    return (
      <path
        key={m.id}
        d={`M${start.join(" ")}L${end.join(" ")}${arrow(start, -1)}${arrow(end, 1)}`}
        className="cad-harness-mating"
      />
    );
  });
  const table = (c: Connector) => {
    const offset = c.tables?.[view];
    if (!offset) return null;
    return (
      <g
        key={`table-${c.id}`}
        transform={`translate(${c[view][0] + offset[0]} ${c[view][1] + offset[1]})`}
        onPointerDown={(e) => {
          if (e.button !== 0 || (e.target as Element).closest("[role=button]"))
            return;
          e.stopPropagation();
          tableDrag.current = {
            id: c.id,
            start: point(e),
            at: offset,
            moved: false,
          };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const drag = tableDrag.current;
          if (!drag) return;
          const p = point(e);
          if (
            Math.hypot(p[0] - drag.start[0], p[1] - drag.start[1]) < 3 &&
            !drag.moved
          )
            return;
          drag.moved = true;
          onRouteMove(
            {
              ...doc,
              connectors: doc.connectors.map((x) =>
                x.id === c.id
                  ? {
                      ...x,
                      tables: {
                        ...x.tables,
                        [view]: [
                          drag.at[0] + p[0] - drag.start[0],
                          drag.at[1] + p[1] - drag.start[1],
                        ],
                      },
                    }
                  : x,
              ),
            },
            false,
          );
        }}
        onPointerUp={() => {
          if (tableDrag.current?.moved) onRouteMove(doc, true);
          tableDrag.current = null;
        }}
        onPointerCancel={() => {
          if (tableDrag.current?.moved) onRouteMove(doc, true);
          tableDrag.current = null;
        }}
      >
        <HarnessConnectionTable
          width={c.id === "bulk-c" ? 425 : 330}
          contacts={c.id === "bulk-c"}
          rows={connectionRows(doc, c)}
          onSelect={onSelect}
        />
      </g>
    );
  };
  return (
    <svg
      ref={svg}
      className="cad-harness-svg"
      role="group"
      aria-label={`${view === "layout" ? "System layout" : "Wire harness"} drawing`}
      viewBox="0 0 940 1800"
      width={940 * zoom}
      height={1800 * zoom}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onSelect(null);
      }}
    >
      <defs>
        <pattern
          id={patternID}
          width="32"
          height="32"
          patternUnits="userSpaceOnUse"
        >
          <circle cx="1" cy="1" r=".9" className="cad-harness-dot" />
        </pattern>
      </defs>
      <rect
        width="940"
        height="1800"
        fill={`url(#${patternID})`}
        onClick={() => onSelect(null)}
      />
      <HarnessDrawingScope>
        {view === "harness" ? (
          <>
            {doc.wires.map((w) => (
              <g
                key={w.id}
                className="cad-harness-wire"
                role="button"
                tabIndex={0}
                aria-label={`Select wire ${w.id}`}
                aria-pressed={selected === w.id}
                opacity={highlights.size && !highlights.has(w.id) ? 0.25 : 1}
                onDoubleClick={(e) => {
                  const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(
                    svg.current!.getScreenCTM()!.inverse(),
                  );
                  onChange(insertWaypoint(doc, w, [p.x, p.y]));
                }}
                onClick={() => onSelect(w.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onSelect(w.id);
                }}
              >
                <path
                  d={wirePath(doc, w)}
                  stroke={w.color}
                  strokeWidth={selected === w.id ? 6 : 3.5}
                  fill="none"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                {w.stripeColor && (
                  <path
                    d={wirePath(doc, w)}
                    stroke={w.stripeColor}
                    strokeWidth="2"
                    strokeDasharray="8 8"
                    fill="none"
                  />
                )}
                <path
                  d={wirePath(doc, w)}
                  stroke="transparent"
                  strokeWidth="16"
                  fill="none"
                />
              </g>
            ))}
            {doc.wires
              .filter((w) => w.id === selected)
              .flatMap((w) =>
                (w.bends ?? []).map((p, index) => (
                  <circle
                    key={`${w.id}:${index}`}
                    cx={p[0]}
                    cy={p[1]}
                    r="6"
                    className="cad-harness-waypoint"
                    role="button"
                    tabIndex={0}
                    aria-label={`Routing point ${index + 1}`}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      waypoint.current = { id: w.id, index };
                      e.currentTarget.setPointerCapture(e.pointerId);
                    }}
                    onPointerMove={(e) => {
                      if (!waypoint.current) return;
                      const at = point(e);
                      onRouteMove(
                        {
                          ...doc,
                          wires: doc.wires.map((x) =>
                            x.id === w.id
                              ? {
                                  ...x,
                                  bends: x.bends!.map((b, i) =>
                                    i === index ? at : b,
                                  ),
                                }
                              : x,
                          ),
                        },
                        false,
                      );
                    }}
                    onPointerUp={() => {
                      if (waypoint.current) {
                        onRouteMove(doc, true);
                        waypoint.current = null;
                      }
                    }}
                    onPointerCancel={() => {
                      if (waypoint.current) {
                        onRouteMove(doc, true);
                        waypoint.current = null;
                      }
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      onChange({
                        ...doc,
                        wires: doc.wires.map((x) =>
                          x.id === w.id
                            ? {
                                ...x,
                                bends: x.bends!.filter((_, i) => i !== index),
                              }
                            : x,
                        ),
                      });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Delete" || e.key === "Backspace") {
                        e.preventDefault();
                        e.stopPropagation();
                        onChange({
                          ...doc,
                          wires: doc.wires.map((x) =>
                            x.id === w.id
                              ? {
                                  ...x,
                                  bends: x.bends!.filter((_, i) => i !== index),
                                }
                              : x,
                          ),
                        });
                      }
                    }}
                  />
                )),
              )}
            {mates}
            {doc.connectors
              .filter((c) => c.kind !== "branch")
              .map((c) => (
                <g
                  key={c.id}
                  transform={`translate(${c.harness.join(" ")})`}
                  onPointerDown={(e) => down(e, c)}
                  onPointerMove={move}
                  onPointerUp={up}
                  onPointerCancel={up}
                  className="cad-harness-node"
                >
                  {c.terminal ? (
                    <g
                      role="button"
                      tabIndex={0}
                      aria-label={`Select ${c.title} terminal ${c.id}`}
                      onClick={() =>
                        wiring
                          ? onPin({ connector: c.id, pin: c.pins[0].id })
                          : onSelect(c.id)
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter")
                          wiring
                            ? onPin({ connector: c.id, pin: c.pins[0].id })
                            : onSelect(c.id);
                      }}
                    >
                      <rect
                        width="180"
                        height="36"
                        rx="10"
                        className="aui-harness-card-body"
                        style={
                          selected === c.id
                            ? { stroke: "var(--harness-active)" }
                            : undefined
                        }
                      />
                      <circle
                        cx="16"
                        cy="18"
                        r="4"
                        fill="none"
                        stroke="currentColor"
                      />
                      <text x="32" y="24">
                        {c.title}
                      </text>
                      <circle
                        cx="170"
                        cy="18"
                        r="3"
                        className="aui-harness-port"
                      />
                    </g>
                  ) : (
                    <g
                      transform={
                        c.vertical ? "translate(0 180) rotate(-90)" : undefined
                      }
                    >
                      <HarnessConnectorCard
                        title={c.title}
                        pins={c.pins}
                        selected={selected === c.id}
                        activePin={
                          pending?.connector === c.id ? pending.pin : undefined
                        }
                        portSide={c.portSide ?? "right"}
                        onSelect={() => onSelect(c.id)}
                        onPin={(pin) => onPin({ connector: c.id, pin })}
                      />
                    </g>
                  )}
                </g>
              ))}
            {pending &&
              (() => {
                const c = doc.connectors.find(
                  (c) => c.id === pending.connector,
                );
                if (!c) return null;
                const p = pinPoint(c, pending.pin);
                return (
                  <circle
                    cx={p[0]}
                    cy={p[1]}
                    r="8"
                    fill="none"
                    className="cad-harness-pending"
                  />
                );
              })()}
          </>
        ) : (
          <>
            {doc.branches.map((b) => (
              <g
                key={b.id}
                role="button"
                tabIndex={0}
                aria-label={`Select branch ${b.id}`}
                onClick={() => onSelect(b.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onSelect(b.id);
                }}
              >
                <path
                  d={roundedPath(b.points, 28)}
                  className="cad-harness-bundle"
                  data-selected={
                    selected === b.id ||
                    highlightedBranches.has(b.id) ||
                    undefined
                  }
                />
                <path
                  d={roundedPath(b.points, 28)}
                  stroke="transparent"
                  strokeWidth="18"
                  fill="none"
                />
                <text
                  className="cad-harness-dimension"
                  transform={`translate(${b.label.join(" ")})${b.points[0][0] === b.points[1][0] ? " rotate(-90)" : ""}`}
                  textAnchor="middle"
                >
                  {b.lengthMm} mm
                </text>
              </g>
            ))}
            {Array.from(
              new Map(
                doc.branches
                  .flatMap((b) => [b.points[0], b.points.at(-1)!])
                  .map((p) => [p.join(","), p]),
              ).values(),
            )
              .filter(
                (p) =>
                  !doc.connectors.some(
                    (c) => c.layout[0] === p[0] && c.layout[1] === p[1],
                  ),
              )
              .map(([x, y]) => (
                <rect
                  key={`${x}:${y}`}
                  x={x - 12}
                  y={y - 5}
                  width="24"
                  height="10"
                  rx="2"
                  className="cad-harness-junction"
                />
              ))}
            {mates}
            {doc.connectors.map((c) => {
              const bulk = c.id.startsWith("bulk"),
                lower = ["ecu1", "ecu2", "dash"].includes(c.id),
                x = c.layout[0],
                y = c.layout[1];
              return (
                <g
                  key={c.id}
                  className="cad-harness-node"
                  transform={`translate(${x} ${y})`}
                  onPointerDown={(e) => down(e, c)}
                  onPointerMove={move}
                  onPointerUp={up}
                  onPointerCancel={up}
                >
                  <g
                    role="button"
                    tabIndex={0}
                    aria-label={`Select layout ${c.title}`}
                    onClick={() => onSelect(c.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") onSelect(c.id);
                    }}
                  >
                    <rect
                      x={c.terminal ? -55 : bulk ? -160 : lower ? -212 : -114}
                      y={c.terminal ? -18 : bulk ? -48 : lower ? -50 : -135}
                      width={c.terminal ? 110 : bulk ? 410 : lower ? 330 : 225}
                      height={c.terminal ? 65 : bulk ? 100 : lower ? 185 : 160}
                      rx="10"
                      fill="transparent"
                      pointerEvents="all"
                      className={
                        selected === c.id ? "cad-harness-selection" : undefined
                      }
                    />
                    {c.terminal ? (
                      <>
                        <circle
                          r="5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="3"
                        />
                        <text
                          x={c.id === "gnd1" ? -15 : c.id === "gnd2" ? 15 : 0}
                          y={
                            c.id.startsWith("bat")
                              ? 28
                              : c.id === "gnd3"
                                ? -20
                                : 5
                          }
                          textAnchor={
                            c.id === "gnd1"
                              ? "end"
                              : c.id === "gnd2"
                                ? "start"
                                : "middle"
                          }
                        >
                          {c.id === "gnd3" ? "Signal" : c.title}
                        </text>
                      </>
                    ) : (
                      <>
                        <rect
                          x="-11"
                          y="-9"
                          width="22"
                          height="18"
                          rx="5"
                          className="cad-harness-junction"
                        />
                        <g
                          transform={
                            bulk
                              ? "translate(-150 -42)"
                              : lower
                                ? "translate(-205 -40)"
                                : "translate(-100 -130)"
                          }
                        >
                          <ConnectorPreview title={c.title} tone={c.tone} />
                        </g>
                        <g
                          transform={
                            bulk
                              ? "translate(155 -42)"
                              : lower
                                ? "translate(-40 50)"
                                : "translate(20 -135)"
                          }
                        >
                          <ConnectorFace
                            title={c.title}
                            pins={c.pins.map((p) => p.id)}
                            triangular={c.id.startsWith("coil")}
                          />
                        </g>
                        <text
                          x={bulk ? 28 : lower ? -32 : 0}
                          y={bulk ? 5 : lower ? 5 : -28}
                          textAnchor={lower ? "end" : bulk ? "start" : "middle"}
                        >
                          {c.title}
                        </text>
                        <path
                          d={
                            bulk
                              ? "M112 0h34"
                              : lower
                                ? "M-115 0h30"
                                : "M-16-50l-8-18m48 18 5-18"
                          }
                          className="aui-harness-divider"
                        />
                      </>
                    )}
                  </g>
                </g>
              );
            })}
          </>
        )}
        {showTables && doc.connectors.map(table)}
        {(doc.notes ?? [])
          .filter((n) => n.view === view)
          .map((n) => (
            <g
              key={n.id}
              transform={`translate(${n.at.join(" ")})`}
              role="button"
              tabIndex={0}
              aria-label={`Select note ${n.text}`}
              onClick={() => onSelect(n.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSelect(n.id);
              }}
            >
              <rect
                width="220"
                height="45"
                rx="5"
                className="aui-harness-card-head"
              />
              <text x="12" y="28">
                {n.text.slice(0, 28)}
              </text>
            </g>
          ))}
      </HarnessDrawingScope>
    </svg>
  );
}
