import { describe, it, expect } from "vitest";
import { exampleHarness } from "./fixture";
import {
  connect,
  parseDocument,
  removeSelection,
  wirePath,
  insertWaypoint,
} from "./model";
import {
  addBundle,
  routeWire,
  moveConnector,
  splitBranch,
  netWires,
  validateHarness,
  connectionCSV,
  mateConnector,
  propagateSignal,
  moveGroup,
  csv,
} from "./operations";
describe("harness authoring document", () => {
  it("roundtrips the sample and rejects missing endpoints", () => {
    const doc = exampleHarness();
    expect(parseDocument(JSON.stringify(doc))).toEqual(doc);
    doc.wires[0].to.pin = "missing";
    expect(() => parseDocument(JSON.stringify(doc))).toThrow("endpoint");
  });
  it("connects real pins once in either direction and permits distinct-pin loopbacks", () => {
    const d = exampleHarness(),
      a = { connector: "inj1", pin: "1" },
      b = { connector: "inj2", pin: "1" };
    const next = connect(d, a, b);
    expect(next.wires).toHaveLength(d.wires.length + 1);
    expect(connect(next, b, a)).toBe(next);
    expect(connect(next, a, a)).toBe(next);
    expect(connect(d, a, { connector: "inj1", pin: "2" }).wires).toHaveLength(
      d.wires.length + 1,
    );
  });
  it("deleting one component preserves the others and removes its wires and mate", () => {
    const d = exampleHarness(),
      next = removeSelection(d, "bulk-e");
    expect(next.connectors).toHaveLength(d.connectors.length - 1);
    expect(next.connectors.some((c) => c.id === "bulk-c")).toBe(true);
    expect(next.wires.some((w) => w.to.connector === "bulk-e")).toBe(false);
    expect(next.mates).toEqual([]);
  });
  it("finds the shortest declared bundle route and updates when its length changes", () => {
    const d = exampleHarness(),
      w = d.wires.find((w) => w.id === "signal-inj1")!;
    expect(routeWire(d, w)?.lengthMm).toBe(1350);
    d.branches.find((b) => b.id === "Left trunk")!.lengthMm = 900;
    expect(routeWire(d, w)?.lengthMm).toBe(1550);
    const next = addBundle(d, "inj1", "bulk-e");
    expect(routeWire(next, w)?.lengthMm).toBe(500);
  });
  it("retains physical connectivity when moving a connector, without changing schematic positions", () => {
    const d = exampleHarness(),
      w = d.wires[0];
    const next = moveConnector(d, "inj1", "layout", [160, 300]);
    expect(routeWire(next, w)).toEqual(routeWire(d, w));
    expect(next.connectors[0].harness).toEqual(d.connectors[0].harness);
  });
  it("splitting a branch keeps the path and its total length", () => {
    const d = exampleHarness(),
      next = splitBranch(d, "Left trunk");
    expect(next.connectors).toHaveLength(d.connectors.length + 1);
    expect(routeWire(next, d.wires[0])?.lengthMm).toBe(1350);
  });
  it("net highlight follows mapped bulkhead cavities while validation reports unused pins", () => {
    const d = exampleHarness();
    expect(netWires(d, "signal-inj1")).toEqual(
      new Set(["signal-inj1", "ecu-signal-0"]),
    );
    expect(
      validateHarness(d).some(
        (i) => i.message === "Injector 1.1 — not connected",
      ),
    ).toBe(true);
  });
  it("exports real routed lengths and builds finite wire paths", () => {
    const d = exampleHarness();
    expect(connectionCSV(d)).toContain('"1350","Routed"');
    for (const w of d.wires)
      expect(wirePath(d, w)).not.toMatch(/NaN|undefined/);
  });
  it("rejects malformed branches and optional document collections before rendering", () => {
    const d = exampleHarness();
    for (const patch of [
      { branches: [{ id: "b", points: [], label: [0, 0], lengthMm: 20 }] },
      { parts: {} },
      { notes: [null] },
      { groups: [{ id: "g", name: "g", members: ["missing"] }] },
      { mates: [{ id: "m", a: "missing", b: "inj1" }] },
    ])
      expect(() => parseDocument(JSON.stringify({ ...d, ...patch }))).toThrow();
  });
  it("inserts an editable waypoint into the closest wire segment", () => {
    const d = exampleHarness(),
      w = d.wires[0];
    const next = insertWaypoint(d, w, [650, 100]);
    expect(next.wires[0].bends).toHaveLength((w.bends?.length ?? 2) + 1);
    expect(next.wires[0].bends).toContainEqual([650, 100]);
    expect(wirePath(next, next.wires[0])).not.toContain("NaN");
    expect(d.wires[0]).toEqual(w);
  });
  it("removes incident bundles on connector deletion and merges a deleted two-way branch point", () => {
    const d = exampleHarness();
    const deleted = removeSelection(d, "inj1");
    expect(deleted.branches).toHaveLength(d.branches.length - 1);
    const split = splitBranch(d, "Left trunk");
    const merged = removeSelection(split, split.connectors.at(-1)!.id);
    expect(merged.branches).toHaveLength(d.branches.length);
    expect(routeWire(merged, d.wires[0])?.lengthMm).toBe(1350);
    expect(parseDocument(JSON.stringify(merged))).toEqual(merged);
  });

  it("mates same-size connectors once and propagates only blank connected signals", () => {
    const d = exampleHarness();
    expect(mateConnector(d, "inj1", "ecu2")).toBe(d);
    const m = mateConnector(d, "inj1", "inj2");
    expect(m.mates?.some((x) => x.a === "inj1" && x.b === "inj2")).toBe(true);
    m.connectors.find((c) => c.id === "inj2")!.pins[0].label = "";
    expect(
      propagateSignal(m, "inj1").connectors.find((c) => c.id === "inj2")!
        .pins[0].label,
    ).toBe("BAT +");
    expect(
      propagateSignal(m, "inj1").connectors.find((c) => c.id === "inj2")!
        .pins[1].label,
    ).toBe("INJ 2");
  });
  it("moves groups without losing routing and honors the group lock", () => {
    const d = exampleHarness();
    d.groups = [{ id: "g", name: "Inputs", members: ["inj1", "coil1"] }];
    const m = moveGroup(d, "g", "layout", [20, 40]);
    expect(m.connectors[0].layout).toEqual([
      d.connectors[0].layout[0] + 20,
      d.connectors[0].layout[1] + 40,
    ]);
    expect(routeWire(m, d.wires[0])?.lengthMm).toBe(1350);
    d.groups[0].locked = true;
    expect(moveGroup(d, "g", "layout", [20, 40])).toBe(d);
    expect(removeSelection(d, "inj1")).toBe(d);
  });
  it("quotes spreadsheet formulas and removes deleted part assignments", () => {
    expect(csv([["=1+1", "normal"]])).toBe('"\'=1+1","normal"');
    const d = exampleHarness(),
      id = d.connectors[0].partID!;
    const next = removeSelection(d, id);
    expect(next.connectors[0].partID).toBeUndefined();
    expect(next.parts?.some((p) => p.id === id)).toBe(false);
  });
});
