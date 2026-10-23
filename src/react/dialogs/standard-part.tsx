/** Insert a standard part (parts.insert / parts.fastener) or change the selected one's size (parts.resize). */
import { cadAssemblyWorkspace } from "../../cad-assembly-workspace-store";
import { type CADPresentationSnapshot, cadPresentation } from "../../cad-presentation-store";
import { STANDARD_PARTS, standardPartFromProperties, standardPartIssues, type StandardPartFamily, type StandardPartRequest } from "@aether/core/document";
import { Button, Dialog, FieldRow, NumberField, SelectField } from "@aether/ui";
import { useEffect, useState, useSyncExternalStore } from "react";

export interface StandardPartDraft { readonly request: StandardPartRequest; readonly positionMillimeters: readonly [number, number, number]; readonly resize: boolean }
const families = (Object.entries(STANDARD_PARTS) as [StandardPartFamily, (typeof STANDARD_PARTS)[StandardPartFamily]][]).map(([value, spec]) => ({ value, label: `${spec.name} (${spec.standard})` }));
const fresh = (family: StandardPartFamily, size?: string, length?: number): StandardPartRequest => {
  const spec = STANDARD_PARTS[family], sizes = Object.keys(spec.sizes);
  return { family, size: size && sizes.includes(size) ? size : sizes[Math.min(3, sizes.length - 1)], ...(spec.lengths ? { length: length ?? spec.lengths[Math.min(5, spec.lengths.length - 1)] } : {}) };
};

export function StandardPartDialog({ presentation }: { presentation: CADPresentationSnapshot }) {
  const assembly = useSyncExternalStore(cadAssemblyWorkspace.subscribe, cadAssemblyWorkspace.snapshot, cadAssemblyWorkspace.snapshot);
  const resize = presentation.startDialog === "resize-standard-part";
  const open = resize || presentation.startDialog === "insert-standard-part";
  const selected = assembly.data?.selectedPartDefinition ? standardPartFromProperties(assembly.data.selectedPartDefinition.custom_properties) : null;
  const [request, setRequest] = useState<StandardPartRequest>(fresh("socket_head_cap_screw"));
  const [position, setPosition] = useState<[number, number, number]>([0, 0, 0]);
  const close = () => cadPresentation.dispatch({ type: "show-start-dialog", dialog: null });
  useEffect(() => { if (open) { setRequest(resize && selected ? selected : fresh(request.family)); setPosition([0, 0, 0]); } }, [open]);
  const spec = STANDARD_PARTS[request.family];
  const issues = resize && !selected ? ["Select an inserted standard part."] : standardPartIssues(request);
  const setAxis = (i: number, value: number | null) => setPosition(position.map((v, k) => (k === i ? value ?? 0 : v)) as [number, number, number]);
  return (
    <Dialog open={open} title={resize ? "Change part size" : "Insert standard part"} onClose={close} actions={(<>
      <Button onClick={close}>Cancel</Button>
      <Button primary disabled={issues.length > 0} onClick={() => cadPresentation.dispatch({ type: "insert-standard-part", draft: { request, positionMillimeters: position, resize } })}>{resize ? "Resize" : "Insert"}</Button>
    </>)}>
      <div className="cad-start-form">
        <FieldRow label="Family" htmlFor="standard-family">
          <SelectField id="standard-family" value={request.family} options={families} disabled={resize} onChange={(event) => setRequest(fresh(event.target.value as StandardPartFamily))} />
        </FieldRow>
        <FieldRow label="Size" htmlFor="standard-size">
          <SelectField id="standard-size" value={request.size} options={Object.keys(spec.sizes).map((value) => ({ value, label: value }))} onChange={(event) => setRequest({ ...request, size: event.target.value })} />
        </FieldRow>
        {spec.lengths ? (
          <FieldRow label="Length" htmlFor="standard-length">
            <SelectField id="standard-length" value={String(request.length)} options={spec.lengths.map((l) => ({ value: String(l), label: `${l} mm` }))} onChange={(event) => setRequest({ ...request, length: Number(event.target.value) })} />
          </FieldRow>
        ) : null}
        {!resize ? (["X", "Y", "Z"] as const).map((axis, i) => (
          <FieldRow key={axis} label={`${axis} (mm)`} htmlFor={`standard-${axis}`}>
            <NumberField id={`standard-${axis}`} value={position[i]} step={1} precision={3} unit="mm" scrubLabel={`${axis} position`} onValueChange={(value) => setAxis(i, value)} />
          </FieldRow>
        )) : null}
        <p className="cad-form-note">{resize ? "Every occurrence of this part takes the new size; mates stay on their connectors." : "Generated as an ordinary part: shank along +Z from the origin, head on top. Threads are not modelled."}</p>
        {issues.length > 0 ? <p className="cad-form-note" role="alert">{issues.join(" ")}</p> : null}
      </div>
    </Dialog>
  );
}
