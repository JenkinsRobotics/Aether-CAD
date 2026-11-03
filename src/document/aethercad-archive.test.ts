import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { documentKind, drawingGraph, emptyGraph, partGraph, readAetherCAD, sha256, writeAetherCAD } from "./aethercad-archive";

const part = { format: "aether-part", formatVersion: 3, units: "millimeter", documentId: "part-1", name: "Bracket", features: [] as unknown[] };
const drawing = { format: "aether-drawing", formatVersion: 2, documentId: "drawing-1", name: "Sheet 1" };

describe("aethercad archive", () => {
  it("round-trips a part document deterministically", () => {
    const bytes = writeAetherCAD(partGraph(part));
    expect(writeAetherCAD(partGraph(part))).toEqual(bytes);
    const read = readAetherCAD(bytes);
    expect(read.kind).toBe("part");
    expect(read.name).toBe("Bracket");
    expect(read.graph.part_definitions[0].feature_document).toEqual(part);
  });
  it("derives the kind from content", () => {
    expect(documentKind(emptyGraph("Doc", "w"))).toBe("part");
    expect(documentKind(drawingGraph(drawing))).toBe("drawing");
    const mixed = partGraph(part);
    mixed.drawings = [{ id: "drawing-1", name: "Sheet 1", document: drawing }];
    expect(documentKind(mixed)).toBe("mixed");
    const assembly = emptyGraph("Doc", "w");
    assembly.instances = [{ id: "instance-1" }];
    expect(documentKind(assembly)).toBe("assembly");
  });
  it("refuses other zips and other files", () => {
    expect(() => readAetherCAD(new TextEncoder().encode('{"format":"aether-part"}'))).toThrow(/not a zip/);
  });
  it("hashes like the platform", () => {
    for (const text of ["", "abc", "x".repeat(55), "y".repeat(64), "z".repeat(1000)]) {
      const data = new TextEncoder().encode(text);
      expect(Buffer.from(sha256(data)).toString("hex")).toBe(createHash("sha256").update(data).digest("hex"));
    }
  });
  it("is read by the service codec with the same kind and part", () => {
    const dir = mkdtempSync(join(tmpdir(), "aethercad-"));
    const file = join(dir, "Bracket.aethercad");
    writeFileSync(file, writeAetherCAD(partGraph(part)));
    writeFileSync(join(dir, "Sheet.aethercad"), writeAetherCAD(drawingGraph(drawing)));
    const script = `
import json, sys
sys.path.insert(0, ${JSON.stringify(join(process.cwd(), "service/aether_cad_service/runtime/runner.pyz"))})
from aether_animation.aether_workspace import AetherWorkspace
from aether_animation.aether_project import project_projection
w = AetherWorkspace.load(__import__("pathlib").Path(${JSON.stringify(file)}))
d = AetherWorkspace.load(__import__("pathlib").Path(${JSON.stringify(join(dir, "Sheet.aethercad"))}))
print(json.dumps({"kind": w.kind, "part": project_projection(w)["parts"][0]["document"], "drawingKind": d.kind, "drawing": list(d.drawings.values())[0]["document"]}))`;
    const answer = JSON.parse(execFileSync("python3", ["-I", "-c", script], { encoding: "utf8" }));
    expect(answer.kind).toBe("part");
    expect(answer.part).toEqual(part);
    expect(answer.drawingKind).toBe("drawing");
    expect(answer.drawing).toEqual(drawing);
  });
});

it("reads the graph out of a document decoded as text", async () => {
  const { readAetherCADText } = await import("./aethercad-archive");
  const text = new TextDecoder().decode(writeAetherCAD(partGraph(part)));
  const read = readAetherCADText(text);
  expect(read.kind).toBe("part");
  expect(read.graph.part_definitions[0].feature_document).toEqual(part);
});
