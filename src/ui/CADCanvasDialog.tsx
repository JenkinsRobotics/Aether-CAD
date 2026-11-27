import { useEffect, useRef, useState } from "react";
import { Button, Checkbox, Dialog, FieldRow, NumberField, SelectField, TextField } from "@aether/ui";
import { createEmptyPartDocument, validatePartDocument, type ImageCanvas } from "@aether/core/document";
import { currentInsertionDocument, editPartPresentation, selectedInsertionFace } from "../modeling/cad-import-service";
import "./CADPopups.css";

const defaults = (): ImageCanvas => ({
  id: crypto.randomUUID(),
  name: "Canvas",
  dataUrl: "",
  plane: "XY",
  widthMillimeters: 100,
  heightMillimeters: 100,
  xMillimeters: 0,
  yMillimeters: 0,
  offsetMillimeters: 0,
  rotationDegrees: 0,
  opacity: 0.5,
  visible: true,
});

export function CADCanvasDialog({ open, onClose, decal = false }: { open: boolean; onClose: () => void; decal?: boolean }) {
  const [canvas, setCanvas] = useState<ImageCanvas>(defaults);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null);
  const load = useRef(0);
  const source = useRef(currentInsertionDocument());
  const saved = (currentInsertionDocument()?.imageCanvases ?? []).filter((c) => Boolean(c.face) === decal);

  useEffect(() => {
    if (open) {
      source.current = currentInsertionDocument();
      setCanvas({ ...defaults(), name: decal ? "Decal" : "Canvas", ...(decal ? { face: selectedInsertionFace() } : {}) });
      setError("");
    }
    return () => { load.current++; };
  }, [open, decal]);

  useEffect(() => () => request.current?.abort(), []);
  const close = () => { load.current++; request.current?.abort(); onClose(); };

  const save = async (remove = false) => {
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    try {
      editPartPresentation((src) => {
        const base = src ?? createEmptyPartDocument("Part");
        const next = {
          ...base,
          imageCanvases: [...(base.imageCanvases ?? []).filter((c) => c.id !== canvas.id), ...(remove ? [] : [canvas])],
        };
        validatePartDocument(next);
        if (new TextEncoder().encode(JSON.stringify(next)).length > 4 * 1024 * 1024) {
          throw Error("The Part exceeds the 4 MiB document limit. Choose a smaller image.");
        }
        return next;
      }, source.current);
      onClose();
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
    } finally {
      setBusy(false);
      request.current = null;
    }
  };

  const read = async (file: File) => {
    const serial = ++load.current;
    setError("");
    try {
      if (file.size > 2 * 1024 * 1024 || !["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
        throw Error("Choose PNG, JPEG or WebP up to 2 MiB.");
      }
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(Error("Could not read image."));
        reader.readAsDataURL(file);
      });
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(Error("The image cannot be decoded."));
        img.src = dataUrl;
      });
      if (image.naturalWidth * image.naturalHeight > 32_000_000) throw Error("Use an image below 32 megapixels.");
      if (serial === load.current) {
        setCanvas((c) => ({ ...c, name: file.name, dataUrl, heightMillimeters: (c.widthMillimeters * image.naturalHeight) / image.naturalWidth }));
      }
    } catch (e) {
      if (serial === load.current) setError((e as Error).message);
    }
  };

  const numeric = (key: keyof ImageCanvas, label: string, unit?: string) => (
    <FieldRow key={key} label={label} htmlFor={`canvas-${key}`}>
      <NumberField
        id={`canvas-${key}`}
        aria-label={label}
        disabled={busy}
        value={Number(canvas[key])}
        step={key === "opacity" ? 0.05 : 1}
        precision={3}
        unit={unit}
        onValueChange={(value) => setCanvas((c) => ({ ...c, [key]: value ?? 0 }))}
      />
    </FieldRow>
  );

  return (
    <Dialog
      open={open}
      title={decal ? "Decal" : "Canvas"}
      onClose={close}
      actions={
        <>
          <Button onClick={close}>Cancel</Button>
          {saved.some((c) => c.id === canvas.id) && (
            <Button disabled={busy} onClick={() => void save(true)}>Remove</Button>
          )}
          <Button primary disabled={busy || !canvas.dataUrl || (decal && !canvas.face)} onClick={() => void save()}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <div className="cad-dialog-form">
        <p className="cad-dialog-lead">
          {decal
            ? "Place an image clipped to the selected planar face. It follows the face on rebuild."
            : "Place a reference image on a construction plane. Embedded images are saved inside the Part."}
        </p>
        {decal && !canvas.face && (
          <p className="cad-dialog-alert" role="alert">Select one unambiguous planar face, then reopen Decal.</p>
        )}

        <div className="cad-dialog-section">
          <h4 className="cad-dialog-section-title">Image source</h4>
          <FieldRow label="Canvas" htmlFor="canvas-saved">
            <SelectField
              id="canvas-saved"
              disabled={busy}
              value={saved.some((c) => c.id === canvas.id) ? canvas.id : ""}
              options={[{ value: "", label: "New canvas" }, ...saved.map((c) => ({ value: c.id, label: c.name }))]}
              onChange={(e) => {
                load.current++;
                setCanvas(saved.find((c) => c.id === e.target.value) ?? { ...defaults(), ...(decal ? { face: selectedInsertionFace() } : {}) });
              }}
            />
          </FieldRow>
          <div className="cad-file-field">
            <input aria-label="Image file" disabled={busy} type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => { if (e.target.files?.[0]) void read(e.target.files[0]); }} />
          </div>
          {canvas.dataUrl && (
            <div className="cad-dialog-preview-frame">
              <img src={canvas.dataUrl} alt="Canvas preview" />
            </div>
          )}
          <FieldRow label="Name" htmlFor="canvas-name">
            <TextField id="canvas-name" disabled={busy} value={canvas.name} onChange={(e) => setCanvas((c) => ({ ...c, name: e.target.value }))} />
          </FieldRow>
          {!decal && (
            <FieldRow label="Plane" htmlFor="canvas-plane">
              <SelectField
                id="canvas-plane"
                disabled={busy}
                value={canvas.plane}
                options={["XY", "XZ", "YZ"].map((p) => ({ value: p, label: p }))}
                onChange={(e) => setCanvas((c) => ({ ...c, plane: e.target.value as ImageCanvas["plane"] }))}
              />
            </FieldRow>
          )}
        </div>

        <div className="cad-dialog-section">
          <h4 className="cad-dialog-section-title">Size &amp; placement</h4>
          <div className="cad-dialog-grid-2">
            {numeric("widthMillimeters", "Width (mm)", "mm")}
            {numeric("heightMillimeters", "Height (mm)", "mm")}
            {numeric("xMillimeters", "X (mm)", "mm")}
            {numeric("yMillimeters", "Y (mm)", "mm")}
            {!decal && numeric("offsetMillimeters", "Offset (mm)", "mm")}
            {numeric("rotationDegrees", "Rotation (degrees)", "°")}
            {numeric("opacity", "Opacity (0–1)")}
          </div>
          <Checkbox label="Visible" disabled={busy} checked={canvas.visible} onChange={(e) => setCanvas((c) => ({ ...c, visible: e.target.checked }))} />
        </div>

        {error && <p className="cad-dialog-alert" role="alert">{error}</p>}
      </div>
    </Dialog>
  );
}
