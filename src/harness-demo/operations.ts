import type {
  HarnessDocument,
  Point,
  Wire,
  Connector,
  Endpoint,
} from "./model";
export type PartKind =
  | "Connector"
  | "Wire"
  | "Cable"
  | "Splice"
  | "Diode"
  | "Resistor"
  | "Contact"
  | "Cavity plug"
  | "Cavity seal"
  | "Lock"
  | "Dust cover"
  | "Boot"
  | "Backshell"
  | "Mount"
  | "Heatshrink"
  | "Tape"
  | "Corrugated tubing"
  | "Spiral wrap"
  | "Tubing"
  | "Braided sleeve"
  | "Ferrule"
  | "Ring terminal"
  | "Spade terminal"
  | "Quick connect"
  | "Group";
export const partKinds: PartKind[] = [
  "Connector",
  "Wire",
  "Cable",
  "Splice",
  "Diode",
  "Resistor",
  "Contact",
  "Cavity plug",
  "Cavity seal",
  "Lock",
  "Dust cover",
  "Boot",
  "Backshell",
  "Mount",
  "Heatshrink",
  "Tape",
  "Corrugated tubing",
  "Spiral wrap",
  "Tubing",
  "Braided sleeve",
  "Ferrule",
  "Ring terminal",
  "Spade terminal",
  "Quick connect",
  "Group",
];
export interface Part {
  id: string;
  kind: PartKind;
  number: string;
  manufacturer: string;
  description: string;
  unitPrice: number;
  cavities?: number;
  gaugeAWG?: number;
}
export interface Note {
  id: string;
  text: string;
  view: "layout" | "harness";
  at: Point;
}
export interface Group {
  id: string;
  name: string;
  members: string[];
  locked?: boolean;
}
export interface Mate {
  id: string;
  a: string;
  b: string;
}
const key = (p: Point) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`;
/** Physical route is independent of schematic drawing waypoints. Distances are declared mm. */
export function routeWire(
  doc: HarnessDocument,
  w: Wire,
): { lengthMm: number; branches: string[] } | null {
  const a = doc.connectors.find((c) => c.id === w.from.connector),
    b = doc.connectors.find((c) => c.id === w.to.connector);
  if (!a || !b) return null;
  if (a.id === b.id) return { lengthMm: 0, branches: [] };
  const start = key(a.layout),
    end = key(b.layout);
  if (start === end) return null;
  const queue = [{ node: start, lengthMm: 0, branches: [] as string[] }],
    visited = new Set<string>();
  while (queue.length) {
    queue.sort((a, b) => a.lengthMm - b.lengthMm);
    const current = queue.shift()!;
    if (visited.has(current.node)) continue;
    if (current.node === end)
      return { lengthMm: current.lengthMm, branches: current.branches };
    visited.add(current.node);
    for (const branch of doc.branches) {
      const ends = [
        key(branch.points[0]),
        key(branch.points[branch.points.length - 1]),
      ];
      const i = ends.indexOf(current.node);
      if (i < 0) continue;
      queue.push({
        node: ends[1 - i],
        lengthMm: current.lengthMm + branch.lengthMm,
        branches: [...current.branches, branch.id],
      });
    }
  }
  return null;
}
export function moveConnector(
  doc: HarnessDocument,
  id: string,
  view: "layout" | "harness",
  at: Point,
): HarnessDocument {
  const c = doc.connectors.find((c) => c.id === id);
  if (!c || doc.groups?.some((g) => g.locked && g.members.includes(id)))
    return doc;
  const old = c[view];
  return {
    ...doc,
    connectors: doc.connectors.map((c) =>
      c.id === id ? { ...c, [view]: at } : c,
    ),
    branches:
      view === "layout"
        ? doc.branches.map((b) => ({
            ...b,
            points: b.points.map((p, i) =>
              (i === 0 || i === b.points.length - 1) && key(p) === key(old)
                ? at
                : p,
            ),
          }))
        : doc.branches,
  };
}
export function addBundle(
  doc: HarnessDocument,
  a: string,
  b: string,
): HarnessDocument {
  const from = doc.connectors.find((c) => c.id === a),
    to = doc.connectors.find((c) => c.id === b);
  if (!from || !to || a === b) return doc;
  const start = from.layout,
    end = to.layout;
  if (key(start) === key(end)) return doc;
  if (
    doc.branches.some(
      (b) =>
        [key(b.points[0]), key(b.points[b.points.length - 1])]
          .sort()
          .join("|") === [key(start), key(end)].sort().join("|"),
    )
  )
    return doc;
  return {
    ...doc,
    branches: [
      ...doc.branches,
      {
        id: `Bundle ${crypto.randomUUID().slice(0, 6)}`,
        points: [start, [end[0], start[1]], end],
        lengthMm: 500,
        label: [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2 - 12],
      },
    ],
  };
}
export function splitBranch(doc: HarnessDocument, id: string): HarnessDocument {
  const b = doc.branches.find((b) => b.id === id);
  if (!b) return doc;
  const index = Math.floor((b.points.length - 1) / 2),
    a = b.points[index],
    z = b.points[index + 1];
  const p: Point = [(a[0] + z[0]) / 2, (a[1] + z[1]) / 2];
  return {
    ...doc,
    branches: [
      ...doc.branches.filter((b) => b.id !== id),
      {
        ...b,
        id: `${id} A`,
        points: [...b.points.slice(0, index + 1), p],
        lengthMm: b.lengthMm / 2,
        label: [p[0] - 20, p[1] - 10],
      },
      {
        ...b,
        id: `${id} B`,
        points: [p, ...b.points.slice(index + 1)],
        lengthMm: b.lengthMm / 2,
        label: [p[0] + 20, p[1] + 20],
      },
    ],
    connectors: [
      ...doc.connectors,
      {
        id: crypto.randomUUID(),
        title: "Branch point",
        kind: "branch",
        terminal: true,
        pins: [{ id: "1", label: "" }],
        tone: "neutral",
        harness: [p[0], p[1]],
        layout: p,
      },
    ],
  };
}
const endpointKey = (e: Endpoint) => `${e.connector}:${e.pin}`;
export function netWires(
  doc: HarnessDocument,
  selected: string | null,
): Set<string> {
  const wire = doc.wires.find((w) => w.id === selected),
    connector = doc.connectors.find((c) => c.id === selected);
  const seeds = wire
    ? [endpointKey(wire.from), endpointKey(wire.to)]
    : connector
      ? connector.pins.map((p) => `${connector.id}:${p.id}`)
      : [];
  const visited = new Set(seeds),
    ids = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const w of doc.wires)
      if (visited.has(endpointKey(w.from)) || visited.has(endpointKey(w.to))) {
        if (!ids.has(w.id)) {
          ids.add(w.id);
          visited.add(endpointKey(w.from));
          visited.add(endpointKey(w.to));
          changed = true;
        }
      }
    for (const mate of doc.mates ?? []) {
      const a = doc.connectors.find((c) => c.id === mate.a),
        b = doc.connectors.find((c) => c.id === mate.b);
      if (!a || !b || a.pins.length !== b.pins.length) continue;
      a.pins.forEach((p, i) => {
        const x = `${a.id}:${p.id}`,
          y = `${b.id}:${b.pins[i].id}`;
        if (visited.has(x) && !visited.has(y)) {
          visited.add(y);
          changed = true;
        }
        if (visited.has(y) && !visited.has(x)) {
          visited.add(x);
          changed = true;
        }
      });
    }
  }
  return ids;
}
export function validateHarness(
  doc: HarnessDocument,
): { id: string; message: string }[] {
  const issues: { id: string; message: string }[] = [];
  for (const c of doc.connectors) {
    if (c.kind === "branch") continue;
    for (const p of c.pins)
      if (
        !doc.wires.some(
          (w) =>
            (w.from.connector === c.id && w.from.pin === p.id) ||
            (w.to.connector === c.id && w.to.pin === p.id),
        )
      )
        issues.push({
          id: c.id,
          message: `${c.title}.${p.id} — not connected`,
        });
    const part = doc.parts?.find((p) => p.id === c.partID);
    if (part?.cavities && part.cavities !== c.pins.length)
      issues.push({
        id: c.id,
        message: `${c.title} — part cavity count differs`,
      });
  }
  for (const w of doc.wires) {
    if (!routeWire(doc, w))
      issues.push({ id: w.id, message: `${w.id} — no physical bundle route` });
    if (!w.partID)
      issues.push({ id: w.id, message: `${w.id} — no wire part assigned` });
  }
  for (const m of doc.mates ?? []) {
    const a = doc.connectors.find((c) => c.id === m.a),
      b = doc.connectors.find((c) => c.id === m.b);
    if (!a || !b || a.pins.length !== b.pins.length)
      issues.push({ id: m.id, message: "Mate — cavity counts do not match" });
  }
  return [...issues, ...signalConflicts(doc)];
}
export function partQuantity(doc: HarnessDocument, p: Part): number {
  if (p.kind === "Wire")
    return doc.wires
      .filter((w) => w.partID === p.id)
      .reduce(
        (n, w) => n + (routeWire(doc, w)?.lengthMm ?? w.lengthMm) / 1000,
        0,
      );
  return doc.connectors.filter((c) => c.partID === p.id).length;
}
export function csv(rows: (string | number)[][]) {
  return rows
    .map((row) =>
      row
        .map(
          (v) =>
            `"${(typeof v === "string" && /^[=+@\t\r-]/.test(v) ? `'${v}` : String(v)).replaceAll('"', '""')}"`,
        )
        .join(","),
    )
    .join("\r\n");
}
export function endpointLabel(doc: HarnessDocument, e: Endpoint) {
  const c = doc.connectors.find((c) => c.id === e.connector);
  return `${c?.title ?? e.connector}.${e.pin}`;
}
export function connectionCSV(doc: HarnessDocument) {
  return csv([
    ["Wire", "From", "To", "Color", "AWG", "Length mm", "Route"],
    ...doc.wires.map((w) => {
      const r = routeWire(doc, w);
      return [
        w.id,
        endpointLabel(doc, w.from),
        endpointLabel(doc, w.to),
        w.color,
        w.gaugeAWG,
        r?.lengthMm ?? w.lengthMm,
        r ? "Routed" : "Unrouted",
      ];
    }),
  ]);
}
export function bomCSV(doc: HarnessDocument) {
  return csv([
    [
      "Part number",
      "Type",
      "Manufacturer",
      "Quantity",
      "Unit",
      "Unit price",
      "Total",
    ],
    ...(doc.parts ?? []).map((p) => {
      const q = partQuantity(doc, p);
      return [
        p.number,
        p.kind,
        p.manufacturer,
        q,
        p.kind === "Wire" ? "m" : "each",
        p.unitPrice,
        q * p.unitPrice,
      ];
    }),
  ]);
}
export function newConnector(kind: Connector["kind"] = "connector"): Connector {
  const pins =
    kind === "splice" || kind === "branch" || kind === "terminal" ? 1 : 2;
  return {
    id: crypto.randomUUID(),
    title:
      kind === "connector"
        ? "New connector"
        : `${kind![0].toUpperCase()}${kind!.slice(1)}`,
    kind,
    pins: Array.from({ length: pins }, (_, i) => ({
      id: String(i + 1),
      label: "",
    })),
    terminal: pins === 1,
    tone: "neutral",
    layout: [440, 200],
    harness: [80, 100],
  };
}

/** A mating pair connects matching cavity positions, without implying contact compatibility. */
export function mateConnector(
  doc: HarnessDocument,
  a: string,
  b: string | null,
): HarnessDocument {
  const from = doc.connectors.find((c) => c.id === a),
    to = doc.connectors.find((c) => c.id === b);
  if (
    !from ||
    (b && (!to || from.id === to.id || from.pins.length !== to.pins.length))
  )
    return doc;
  return {
    ...doc,
    mates: [
      ...(doc.mates ?? []).filter(
        (m) => ![a, b].includes(m.a) && ![a, b].includes(m.b),
      ),
      ...(b ? [{ id: crypto.randomUUID(), a, b }] : []),
    ],
  };
}
function connectedPins(doc: HarnessDocument, seed: Endpoint): Set<string> {
  const pins = new Set([endpointKey(seed)]);
  let changed = true;
  const edges = doc.wires.map((w) => [endpointKey(w.from), endpointKey(w.to)]);
  for (const m of doc.mates ?? []) {
    const a = doc.connectors.find((c) => c.id === m.a),
      b = doc.connectors.find((c) => c.id === m.b);
    if (a && b && a.pins.length === b.pins.length)
      a.pins.forEach((p, i) =>
        edges.push([`${a.id}:${p.id}`, `${b.id}:${b.pins[i].id}`]),
      );
  }
  while (changed) {
    changed = false;
    for (const [a, b] of edges)
      if (pins.has(a) !== pins.has(b)) {
        pins.add(a);
        pins.add(b);
        changed = true;
      }
  }
  return pins;
}
/** Fill empty labels only; named signals remain authoritative and conflicts are reviewed. */
export function propagateSignal(
  doc: HarnessDocument,
  id: string,
): HarnessDocument {
  const c = doc.connectors.find((c) => c.id === id);
  if (!c) return doc;
  let next = doc;
  for (const pin of c.pins) {
    if (!pin.label.trim()) continue;
    const pins = connectedPins(next, { connector: id, pin: pin.id });
    next = {
      ...next,
      connectors: next.connectors.map((c) => ({
        ...c,
        pins: c.pins.map((p) =>
          pins.has(`${c.id}:${p.id}`) && !p.label.trim()
            ? { ...p, label: pin.label }
            : p,
        ),
      })),
    };
  }
  return next;
}
export function signalConflicts(
  doc: HarnessDocument,
): { id: string; message: string }[] {
  const visited = new Set<string>(),
    issues: { id: string; message: string }[] = [];
  for (const wire of doc.wires) {
    const key = endpointKey(wire.from);
    if (visited.has(key)) continue;
    const net = connectedPins(doc, wire.from);
    net.forEach((p) => visited.add(p));
    const labels = new Set(
      doc.connectors.flatMap((c) =>
        c.pins
          .filter((p) => net.has(`${c.id}:${p.id}`) && p.label.trim())
          .map((p) => p.label.trim()),
      ),
    );
    if (labels.size > 1)
      issues.push({
        id: wire.id,
        message: `Conflicting signals — ${[...labels].join(", ")}`,
      });
  }
  return issues;
}
export function moveGroup(
  doc: HarnessDocument,
  id: string,
  view: "layout" | "harness",
  delta: Point,
): HarnessDocument {
  const group = doc.groups?.find((g) => g.id === id);
  if (!group || group.locked || !delta.every(Number.isFinite)) return doc;
  const members = doc.connectors.filter((c) => group.members.includes(c.id));
  if (
    doc.groups?.some(
      (g) => g.locked && g.members.some((id) => group.members.includes(id)),
    )
  )
    return doc;
  const points = new Set(members.map((c) => key(c.layout))),
    shift = (p: Point): Point => [p[0] + delta[0], p[1] + delta[1]];
  const connectors = doc.connectors.map((c) =>
    group.members.includes(c.id) ? { ...c, [view]: shift(c[view]) } : c,
  );
  if (
    connectors.some((c) =>
      c[view].some((v) => !Number.isFinite(v) || Math.abs(v) >= 10000),
    )
  )
    return doc;
  return {
    ...doc,
    connectors,
    branches:
      view === "layout"
        ? doc.branches.map((b) => {
            const all =
              points.has(key(b.points[0])) && points.has(key(b.points.at(-1)!));
            return {
              ...b,
              points: b.points.map((p, i) =>
                all ||
                ((i === 0 || i === b.points.length - 1) && points.has(key(p)))
                  ? shift(p)
                  : p,
              ),
              label: all ? shift(b.label) : b.label,
            };
          })
        : doc.branches,
  };
}
