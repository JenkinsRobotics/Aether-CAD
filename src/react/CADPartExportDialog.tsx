import { useEffect, useState } from "react";
import { Button, Dialog, FieldRow, SelectField, TextField } from "@aether/ui";
import { cadCommands } from "../cad-command-registry";
import { cadPresentation, type CADPresentationSnapshot } from "../cad-presentation-store";
import { consumeExportBody, downloadPartExport, exportBodyChoices, PART_EXPORT_FILES } from "../modeling/part-export";
import type { ExportFormat } from "@aether/core/contracts";

export function ExportCenter({ presentation }: { presentation: CADPresentationSnapshot }) {
  const [format, setFormat] = useState("native");
  const [body, setBody] = useState("");
  const [tolerance, setTolerance] = useState("0.1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const open = presentation.startDialog === "export";
  useEffect(() => { if (open) { const target = consumeExportBody(); setError(""); setBody(target ?? ""); if (target) setFormat("step"); } }, [open]);
  const close = () => { if (!busy) cadPresentation.dispatch({ type: "show-start-dialog", dialog: null }); };
  const exportFile = async () => {
    if (format === "native") { close(); cadCommands.execute("save-part"); return; }
    setBusy(true); setError("");
    try { await downloadPartExport(format as ExportFormat, body || undefined, Number(tolerance)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const meshFormat = format !== "native" && format !== "step";
  const invalidTolerance = meshFormat && (!Number.isFinite(Number(tolerance)) || Number(tolerance) < 0.001 || Number(tolerance) > 5);
  return <Dialog open={open} title="Export Part" onClose={close} actions={<><Button disabled={busy} onClick={close}>Close</Button><Button primary disabled={busy || !presentation.partOpen || invalidTolerance} onClick={exportFile}>{busy ? "Exporting…" : format === "native" ? "Save native Part" : "Download"}</Button></>}>
    <div className="cad-export-center">
      <p>{presentation.documentName}</p>
      <FieldRow label="Format" htmlFor="export-format"><SelectField id="export-format" value={format} onChange={e => setFormat(e.target.value)} disabled={busy} options={[{ value: "native", label: "Aether editable Part (.acpart)" }, ...Object.entries(PART_EXPORT_FILES).map(([value, file]) => ({ value, label: file.label }))]} /></FieldRow>
      {format !== "native" && <><FieldRow label="Bodies" htmlFor="export-bodies"><SelectField id="export-bodies" value={body} onChange={e => setBody(e.target.value)} disabled={busy} options={[{ value: "", label: "All bodies" }, ...exportBodyChoices().map(b => ({ value: b.id, label: b.name }))]} /></FieldRow><p>{format === "gltf" ? "glTF is written in metres with Y up, as viewers expect. " : "Exported in millimeters. "}Exports contain geometry only; save a native Part to retain editable history.</p></>}
      {meshFormat && <FieldRow label="Mesh tolerance (mm)" htmlFor="export-tolerance"><TextField id="export-tolerance" value={tolerance} disabled={busy} onChange={e => setTolerance(e.target.value)} /></FieldRow>}
      {invalidTolerance && <p role="alert">Enter a tolerance from 0.001 to 5 mm.</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  </Dialog>;
}
