import { bendTableCSV, bodyIDForFeature, profileFrame, rollbackPosition, sheetBendTable, type PartDocument } from "@aether/core/document";
import { sketchDrawingToDXF } from "@aether/core/sketch";
import { cadCommands } from "./cad-command-registry";
import { aetherKernel } from "./engine/aether/kernel";
import { cadPresentation } from "./cad-presentation-store";

/** Flat pattern as DXF (SolidCraft's sheet.export_dxf): the last sheet metal body's
 *  outline, read by sectioning it through the middle of its thickness in the base's
 *  sketch plane. Unfold first for a bent sheet; a flat plate exports as it is. */
export function mountSheetMetalCommands(getDocument: () => PartDocument | null) {
  const report = (message: string, tone: "error" | "normal" = "normal") => cadPresentation.patch({ statusMessage: message, statusTone: tone === "error" ? "error" : "success" });
  const release = cadCommands.register("sheet-export-flat-dxf", () => {
    const doc = getDocument();
    const features = doc?.features.slice(0, rollbackPosition(doc)) ?? [];
    const base = [...features].reverse().find((f) => f.type === "sheet-base" && !f.suppressed);
    if (!doc || !base || base.type !== "sheet-base") { report("Start with a sheet metal base to export a flat pattern.", "error"); return; }
    const sketch = features.find((f) => f.id === base.profileFeatureId);
    if (!sketch || !("plane" in sketch)) { report("The base's sketch is unavailable.", "error"); return; }
    const frame = profileFrame({ plane: sketch.plane as "XY" | "XZ" | "YZ", offsetMillimeters: "offsetMillimeters" in sketch ? sketch.offsetMillimeters : 0, frame: "frame" in sketch ? sketch.frame : undefined, flip: "flip" in sketch ? sketch.flip : undefined });
    const half = (base.reversed ? -1 : 1) * base.thicknessMillimeters / 2;
    const mid = { ...frame, originMillimeters: frame.originMillimeters.map((v, i) => v + frame.normal[i] * half) as [number, number, number] };
    void aetherKernel().sketchSection({ ...doc, features, rollbackIndex: undefined }, mid, "section").then((contours) => {
      if (!contours.length) { report("The sheet has no outline at mid-thickness.", "error"); return; }
      const url = URL.createObjectURL(new Blob([sketchDrawingToDXF({ type: "drawing", contours })], { type: "application/dxf" }));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${doc.name || "sheet"}-flat.dxf`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      report(`Flat pattern saved as DXF (${contours.length} curves).`);
    }).catch((error: unknown) => report(error instanceof Error ? error.message : String(error), "error"));
  });
  cadCommands.setEnabled("sheet-export-flat-dxf", true);
  // Bend table (SolidCraft's sheet.export_bend_table): every bend of the last sheet body, as CSV.
  const releaseTable = cadCommands.register("sheet-export-bend-table", () => {
    const doc = getDocument();
    const features = doc?.features.slice(0, rollbackPosition(doc)) ?? [];
    const base = [...features].reverse().find((f) => f.type === "sheet-base" && !f.suppressed);
    if (!doc || !base || base.type !== "sheet-base") { report("Start with a sheet metal base to export a bend table.", "error"); return; }
    const rows = sheetBendTable({ features }, bodyIDForFeature(doc, base), base);
    if (!rows.length) { report("This sheet has no bends yet.", "error"); return; }
    const url = URL.createObjectURL(new Blob([bendTableCSV(rows)], { type: "text/csv" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${doc.name || "sheet"}-bends.csv`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    report(`Bend table saved: ${rows.length} bend${rows.length === 1 ? "" : "s"}.`);
  });
  cadCommands.setEnabled("sheet-export-bend-table", true);
  return () => { release(); releaseTable(); };
}
