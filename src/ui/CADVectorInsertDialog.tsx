import { useEffect, useRef, useState } from "react";
import { Button, Dialog, FieldRow, NumberField, SelectField } from "@aether/ui";
import type { SketchPlane } from "@aether/core/document";
import { appendVector } from "../modeling/vector-insert";
import { insertPreparedPart } from "../modeling/cad-import-service";
import "./CADPopups.css";

export function CADVectorInsertDialog({ format, onClose }: { format: "svg" | "dxf" | null; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [plane, setPlane] = useState<SketchPlane>("XY");
  const [scale, setScale] = useState<number | null>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);

  useEffect(() => { setFile(null); setError(""); }, [format]);
  useEffect(() => () => request.current?.abort(), []);
  const close = () => { request.current?.abort(); onClose(); };

  const run = async () => {
    if (!file || !format || !scale) return;
    const control = new AbortController();
    request.current = control;
    setBusy(true);
    setError("");
    try {
      await insertPreparedPart(async (source) => appendVector(source, file.name, await file.text(), format, plane, scale), control.signal);
      onClose();
    } catch (e) {
      if (!control.signal.aborted) setError((e as Error).message);
    } finally {
      setBusy(false);
      request.current = null;
    }
  };

  return (
    <Dialog
      open={format !== null}
      title={`Insert ${format?.toUpperCase() ?? "vector"}`}
      onClose={close}
      actions={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button primary onClick={() => void run()} disabled={busy || !file || scale === null || !Number.isFinite(scale) || scale <= 0}>
            {busy ? "Inserting…" : "Insert"}
          </Button>
        </>
      }
    >
      <div className="cad-dialog-form">
        <p className="cad-dialog-lead">Insert editable contours as a new sketch profile. Double-click the profile in the feature tree to edit it.</p>
        <div className="cad-dialog-section">
          <h4 className="cad-dialog-section-title">Source &amp; placement</h4>
          <div className="cad-file-field">
            <input aria-label="Vector file" type="file" accept={`.${format}`} disabled={busy} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <FieldRow label="Plane" htmlFor="vector-plane">
            <SelectField id="vector-plane" value={plane} disabled={busy} onChange={(e) => setPlane(e.target.value as SketchPlane)} options={["XY", "XZ", "YZ"].map((value) => ({ value, label: value }))} />
          </FieldRow>
          <FieldRow label="Scale (mm / unit)" htmlFor="vector-scale">
            <NumberField
              id="vector-scale"
              aria-label="Millimeters per source unit"
              min={0.000001}
              step={0.1}
              precision={4}
              value={scale}
              disabled={busy}
              onValueChange={setScale}
            />
          </FieldRow>
          <p className="cad-form-note">Use 1 for millimeters or 25.4 for inches. SVG drawing units are interpreted using this scale.</p>
        </div>
        {error && <p className="cad-dialog-alert" role="alert">{error}</p>}
      </div>
    </Dialog>
  );
}
