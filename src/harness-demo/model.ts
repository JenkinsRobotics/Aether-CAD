import {
  partKinds,
  type Part,
  type Note,
  type Group,
  type Mate,
} from "./operations";
export type Point = [number, number];
export type View = "layout" | "harness";
export interface Pin {
  side?: "left" | "right";
  id: string;
  label: string;
}
export interface Connector {
  id: string;
  title: string;
  kind?: "connector" | "terminal" | "splice" | "diode" | "resistor" | "branch";
  partID?: string;
  pins: Pin[];
  harness: Point;
  layout: Point;
  tables?: Partial<Record<View, Point>>;
  portSide?: "left" | "right";
  vertical?: boolean;
  terminal?: boolean;
  tone: "neutral" | "green" | "blue" | "orange";
}
export interface Endpoint {
  connector: string;
  pin: string;
}
export interface Wire {
  id: string;
  from: Endpoint;
  to: Endpoint;
  color: string;
  gaugeAWG: number;
  lengthMm: number;
  partID?: string;
  stripeColor?: string;
  ident?: string;
  bends?: Point[];
}
export interface Branch {
  id: string;
  points: Point[];
  lengthMm: number;
  label: Point;
}
export interface HarnessDocument {
  format: "aether-harness-demo";
  version: 1;
  name: string;
  parts?: Part[];
  notes?: Note[];
  groups?: Group[];
  mates?: Mate[];
  connectors: Connector[];
  wires: Wire[];
  branches: Branch[];
}
export const wireColors = [
  "#f48629",
  "#e9c638",
  "#4dbd66",
  "#369cde",
  "#ec5862",
  "#8d63e2",
  "#aa8781",
  "#8d9291",
];
export function endpointExists(doc: HarnessDocument, e: Endpoint) {
  return doc.connectors.some(
    (c) => c.id === e.connector && c.pins.some((p) => p.id === e.pin),
  );
}
export function connect(
  doc: HarnessDocument,
  from: Endpoint,
  to: Endpoint,
  color = wireColors[0],
): HarnessDocument {
  if (
    !endpointExists(doc, from) ||
    !endpointExists(doc, to) ||
    (from.connector === to.connector && from.pin === to.pin)
  )
    return doc;
  const key = (e: Endpoint) => `${e.connector}:${e.pin}`;
  if (
    doc.wires.some(
      (w) =>
        [key(w.from), key(w.to)].sort().join("|") ===
        [key(from), key(to)].sort().join("|"),
    )
  )
    return doc;
  return {
    ...doc,
    wires: [
      ...doc.wires,
      {
        id: crypto.randomUUID(),
        from,
        to,
        color,
        gaugeAWG: 22,
        lengthMm: 1000,
      },
    ],
  };
}
export function removeSelection(
  doc: HarnessDocument,
  id: string,
): HarnessDocument {
  const connector = doc.connectors.find((c) => c.id === id);
  if (doc.groups?.some((g) => g.locked && g.members.includes(id))) return doc;
  const incident = connector
    ? doc.branches.filter((b) =>
        [b.points[0], b.points.at(-1)!].some(
          (p) => p[0] === connector.layout[0] && p[1] === connector.layout[1],
        ),
      )
    : [];
  let branches = doc.branches.filter(
    (b) => b.id !== id && !incident.includes(b),
  );
  // A two-way branch-point deletion joins its two bundles without losing physical length.
  if (connector?.kind === "branch" && incident.length === 2) {
    const [a, b] = incident;
    const toward = (points: Point[]) =>
      points.at(-1)![0] === connector.layout[0] &&
      points.at(-1)![1] === connector.layout[1]
        ? points
        : [...points].reverse();
    branches = [
      ...branches,
      {
        ...a,
        points: [...toward(a.points), ...toward(b.points).reverse().slice(1)],
        lengthMm: a.lengthMm + b.lengthMm,
      },
    ];
  }
  return {
    ...doc,
    connectors: doc.connectors
      .filter((c) => c.id !== id)
      .map((c) => (c.partID === id ? { ...c, partID: undefined } : c)),
    wires: doc.wires
      .filter(
        (w) => w.id !== id && w.from.connector !== id && w.to.connector !== id,
      )
      .map((w) => (w.partID === id ? { ...w, partID: undefined } : w)),
    mates: doc.mates?.filter((m) => m.a !== id && m.b !== id),
    notes: doc.notes?.filter((n) => n.id !== id),
    groups: doc.groups
      ?.filter((g) => g.id !== id)
      .map((g) => ({ ...g, members: g.members.filter((m) => m !== id) })),
    parts: doc.parts?.filter((p) => p.id !== id),
    branches,
  };
}
export function pinPoint(c: Connector, pin: string): Point {
  const i = Math.max(
    0,
    c.pins.findIndex((p) => p.id === pin),
  );
  const left = (c.pins[i]?.side ?? c.portSide) === "left";
  return c.terminal
    ? [c.harness[0] + 180, c.harness[1] + 18]
    : c.vertical
      ? [c.harness[0] + 48 + i * 32, c.harness[1] + (left ? 190 : -10)]
      : [c.harness[0] + (left ? -10 : 190), c.harness[1] + 48 + i * 32];
}
export function roundedPath(points: readonly Point[], radius = 16): string {
  if (!points.length) return "";
  let d = `M${points[0].join(" ")}`;
  for (let i = 1; i < points.length; i++) {
    const p = points[i],
      prev = points[i - 1],
      next = points[i + 1];
    if (!next) {
      d += ` L${p.join(" ")}`;
      continue;
    }
    const a = Math.hypot(p[0] - prev[0], p[1] - prev[1]),
      b = Math.hypot(next[0] - p[0], next[1] - p[1]);
    const r = Math.min(radius, a / 2, b / 2);
    if (!a || !b) {
      d += ` L${p.join(" ")}`;
      continue;
    }
    d += ` L${p[0] + ((prev[0] - p[0]) * r) / a} ${p[1] + ((prev[1] - p[1]) * r) / a} Q${p.join(" ")} ${p[0] + ((next[0] - p[0]) * r) / b} ${p[1] + ((next[1] - p[1]) * r) / b}`;
  }
  return d;
}
export function wirePoints(doc: HarnessDocument, wire: Wire): Point[] {
  const from = doc.connectors.find((c) => c.id === wire.from.connector)!,
    to = doc.connectors.find((c) => c.id === wire.to.connector)!;
  const start = pinPoint(from, wire.from.pin),
    end = pinPoint(to, wire.to.pin);
  const bends =
    wire.bends ??
    ([
      [Math.max(start[0], end[0]) + 30, start[1]],
      [Math.max(start[0], end[0]) + 30, end[1]],
    ] as Point[]);
  return [start, ...bends, end];
}
export function wirePath(doc: HarnessDocument, wire: Wire): string {
  return roundedPath(wirePoints(doc, wire));
}
export function insertWaypoint(
  doc: HarnessDocument,
  wire: Wire,
  point: Point,
): HarnessDocument {
  const points = wirePoints(doc, wire);
  let index = 0,
    best = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i],
      b = points[i + 1],
      dx = b[0] - a[0],
      dy = b[1] - a[1];
    const t = Math.max(
      0,
      Math.min(
        1,
        ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) /
          (dx * dx + dy * dy || 1),
      ),
    );
    const distance = Math.hypot(
      point[0] - a[0] - t * dx,
      point[1] - a[1] - t * dy,
    );
    if (distance < best) {
      index = i;
      best = distance;
    }
  }
  const bends = points.slice(1, -1);
  bends.splice(index, 0, point);
  return {
    ...doc,
    wires: doc.wires.map((w) => (w.id === wire.id ? { ...w, bends } : w)),
  };
}
export function parseDocument(raw: string): HarnessDocument {
  const d = JSON.parse(raw) as HarnessDocument;
  const point = (p: unknown): p is Point =>
    Array.isArray(p) &&
    p.length === 2 &&
    p.every(
      (n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) < 10000,
    );
  if (
    d?.format !== "aether-harness-demo" ||
    d.version !== 1 ||
    typeof d.name !== "string" ||
    !Array.isArray(d.connectors) ||
    !Array.isArray(d.wires) ||
    !Array.isArray(d.branches)
  )
    throw Error("Not an Aether harness demo document");
  if (
    d.connectors.length > 200 ||
    d.wires.length > 1000 ||
    d.branches.length > 200
  )
    throw Error("Demo document is too large");
  const text = (s: unknown): s is string =>
    typeof s === "string" && s.length <= 2000;
  const id = (s: unknown): s is string => text(s) && s.length > 0;
  const number = (n: unknown, min = 0) =>
    typeof n === "number" && Number.isFinite(n) && n >= min && n <= 1e9;
  if (
    d.connectors.some(
      (c) =>
        !c ||
        !id(c.id) ||
        !text(c.title) ||
        !point(c.harness) ||
        !point(c.layout) ||
        !["neutral", "green", "blue", "orange"].includes(c.tone) ||
        (c.kind !== undefined &&
          ![
            "connector",
            "terminal",
            "splice",
            "diode",
            "resistor",
            "branch",
          ].includes(c.kind)) ||
        (c.partID !== undefined && !id(c.partID)) ||
        !Array.isArray(c.pins) ||
        c.pins.length < 1 ||
        c.pins.length > 12 ||
        c.pins.some((p) => !p || !id(p.id) || !text(p.label)) ||
        new Set(c.pins.map((p) => p.id)).size !== c.pins.length,
    )
  )
    throw Error("Invalid connector");
  if (
    d.connectors.some(
      (c) =>
        c.tables !== undefined &&
        (!c.tables ||
          typeof c.tables !== "object" ||
          Object.entries(c.tables).some(
            ([view, p]) => !["layout", "harness"].includes(view) || !point(p),
          )),
    )
  )
    throw Error("Invalid table position");
  if (
    d.wires.some(
      (w) =>
        !w ||
        !id(w.id) ||
        !w.from ||
        !w.to ||
        !endpointExists(d, w.from) ||
        !endpointExists(d, w.to) ||
        !/^#[0-9a-f]{6}$/i.test(w.color) ||
        !number(w.lengthMm) ||
        !number(w.gaugeAWG) ||
        w.gaugeAWG > 40 ||
        (w.bends !== undefined &&
          (!Array.isArray(w.bends) ||
            w.bends.length > 200 ||
            !w.bends.every(point))) ||
        (w.ident !== undefined && !text(w.ident)) ||
        (w.stripeColor !== undefined && !/^#[0-9a-f]{6}$/i.test(w.stripeColor)),
    )
  )
    throw Error("Invalid wire or endpoint");
  if (
    d.branches.some(
      (b) =>
        !b ||
        !id(b.id) ||
        !Array.isArray(b.points) ||
        b.points.length < 2 ||
        b.points.length > 200 ||
        !b.points.every(point) ||
        !point(b.label) ||
        !number(b.lengthMm),
    )
  )
    throw Error("Invalid branch");
  if (
    d.parts !== undefined &&
    (!Array.isArray(d.parts) ||
      d.parts.length > 1000 ||
      d.parts.some(
        (p) =>
          !p ||
          !id(p.id) ||
          !partKinds.includes(p.kind) ||
          !text(p.number) ||
          !text(p.description) ||
          !text(p.manufacturer) ||
          !number(p.unitPrice) ||
          (p.cavities !== undefined &&
            (!Number.isInteger(p.cavities) ||
              p.cavities < 1 ||
              p.cavities > 12)),
      ))
  )
    throw Error("Invalid part library");
  if (
    d.notes !== undefined &&
    (!Array.isArray(d.notes) ||
      d.notes.length > 200 ||
      d.notes.some(
        (n) =>
          !n ||
          !id(n.id) ||
          !text(n.text) ||
          !["layout", "harness"].includes(n.view) ||
          !point(n.at),
      ))
  )
    throw Error("Invalid notes");
  if (
    d.groups !== undefined &&
    (!Array.isArray(d.groups) ||
      d.groups.length > 200 ||
      d.groups.some(
        (g) =>
          !g ||
          !id(g.id) ||
          !text(g.name) ||
          !Array.isArray(g.members) ||
          g.members.some((m) => !d.connectors.some((c) => c.id === m)),
      ))
  )
    throw Error("Invalid groups");
  if (
    d.mates !== undefined &&
    (!Array.isArray(d.mates) ||
      d.mates.length > 100 ||
      d.mates.some(
        (m) =>
          !m ||
          !id(m.id) ||
          m.a === m.b ||
          ![m.a, m.b].every((id) => d.connectors.some((c) => c.id === id)),
      ))
  )
    throw Error("Invalid mates");
  const ids = [
    ...d.connectors,
    ...d.wires,
    ...d.branches,
    ...(d.parts ?? []),
    ...(d.notes ?? []),
    ...(d.groups ?? []),
    ...(d.mates ?? []),
  ].map((c) => c.id);
  if (new Set(ids).size !== ids.length) throw Error("Duplicate identity");
  return d;
}
