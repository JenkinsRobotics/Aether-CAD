/** Framing cut-list CSV export and current-view HLR DXF export commands. */
import { exportPartScript, frameCutList, frameCutListCSV, rollbackPosition, type PartDocument } from "@aether/core/document";
import { exportDrawingDXF, buildDrawing, createDrawingDocument, applyDrawingCommand } from "@aether/core/drawing";
import { cadCommands } from "../../core/cad-command-registry";
import { cadPresentation } from "../../core/stores/cad-presentation-store";
import { aetherKernel } from "../../core/engine/aether/kernel";

function downloadText(filename: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function mountFramingAndExportCommands(getDocument: () => PartDocument | null) {
  const report = (message: string, tone: "error" | "normal" = "normal") =>
    cadPresentation.patch({ statusMessage: message, statusTone: tone === "error" ? "error" : "success" });

  const releaseCutList = cadCommands.register("framing-cut-list", () => {
    const doc = getDocument();
    if (!doc) { report("Open a Part with structural frame members first.", "error"); return; }
    const activeDoc: PartDocument = { ...doc, features: doc.features.slice(0, rollbackPosition(doc)), rollbackIndex: undefined };
    const rows = frameCutList(activeDoc.features);
    if (!rows.length) { report("No structural frame members found in this Part.", "error"); return; }
    downloadText(`${doc.name || "frame"}-cut-list.csv`, frameCutListCSV(rows), "text/csv");
    report(`Frame cut list exported (${rows.length} group${rows.length === 1 ? "" : "s"}).`);
  });
  cadCommands.setEnabled("framing-cut-list", true);

  const releaseViewDXF = cadCommands.register("export-view-dxf", () => {
    const doc = getDocument();
    if (!doc) { report("Open a Part before exporting DXF.", "error"); return; }
    const activeDoc: PartDocument = { ...doc, features: doc.features.slice(0, rollbackPosition(doc)), rollbackIndex: undefined };
    let dwg = createDrawingDocument(activeDoc);
    const sheetId = dwg.activeSheetId;
    dwg = applyDrawingCommand(dwg, {
      type: "add-view",
      sheetId,
      view: { id: "view-front", name: "Front", orientation: "front", originMm: [148.5, 105], scale: 1, hiddenLines: true },
    });
    void buildDrawing(dwg, (source, options) => aetherKernel().projectDrawing(source, options))
      .then((built) => {
        const dxf = exportDrawingDXF(built, sheetId);
        downloadText(`${doc.name || "part"}-view.dxf`, dxf, "application/dxf");
        report("Current view exported as exact R2000 DXF.");
      })
      .catch((err: unknown) => report(err instanceof Error ? err.message : String(err), "error"));
  });
  cadCommands.setEnabled("export-view-dxf", true);

  const releaseScript = cadCommands.register("export-part-script", () => {
    const doc = getDocument();
    if (!doc) { report("Open a Part before exporting its script.", "error"); return; }
    const script = exportPartScript(doc);
    downloadText(`${doc.name || "part"}.aether.ts`, script, "text/typescript");
    report(`Parametric script exported (${doc.features.length} features).`);
  });
  cadCommands.setEnabled("export-part-script", true);

  return () => {
    releaseCutList();
    releaseViewDXF();
    releaseScript();
  };
}
