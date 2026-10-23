/** Reach point (joint.reach): move the selected occurrence so a point of it lands on a world point. */
import { cadAssemblyWorkspace } from "../../cad-assembly-workspace-store";
import { type CADPresentationSnapshot, cadPresentation } from "../../cad-presentation-store";
import { Button, Dialog, FieldRow, NumberField } from "@aether/ui";
import { useEffect, useState, useSyncExternalStore } from "react";

export interface ReachPointDraft { readonly instanceID: string; readonly pointMillimeters: readonly [number, number, number]; readonly atMillimeters?: readonly [number, number, number] }

export function ReachPointDialog({ presentation }: { presentation: CADPresentationSnapshot }) {
  const assembly = useSyncExternalStore(cadAssemblyWorkspace.subscribe, cadAssemblyWorkspace.snapshot, cadAssemblyWorkspace.snapshot);
  const selected = assembly.data?.selectedInstanceID ?? null;
  const [point, setPoint] = useState<[number, number, number]>([0, 0, 0]);
  const open = presentation.startDialog === "reach-point";
  const close = () => cadPresentation.dispatch({ type: "show-start-dialog", dialog: null });
  useEffect(() => { if (open) setPoint([0, 0, 0]); }, [open]);
  const set = (i: number, value: number) => setPoint(point.map((v, k) => (k === i ? value : v)) as [number, number, number]);
  const ok = selected !== null && point.every(Number.isFinite);
  return (
    <Dialog open={open} title="Reach point" onClose={close} actions={(<>
      <Button onClick={close}>Cancel</Button>
      <Button primary disabled={!ok} onClick={() => selected && cadPresentation.dispatch({ type: "reach-assembly-point", draft: { instanceID: selected, pointMillimeters: point } })}>Move</Button>
    </>)}>
      <div className="cad-start-form">
        {(["X", "Y", "Z"] as const).map((axis, i) => (
          <FieldRow key={axis} label={`${axis} (mm)`} htmlFor={`reach-${axis}`}>
            <NumberField id={`reach-${axis}`} value={point[i]} step={1} precision={3} unit="mm" scrubLabel={`${axis} position`} onValueChange={(value) => set(i, value ?? 0)} />
          </FieldRow>
        ))}
        <p className="cad-form-note">{selected ? "The occurrence's origin moves to this world point; its rotation and mates stay as they are. Solve afterwards to see the mates' answer." : "Select one occurrence in the assembly tree."}</p>
      </div>
    </Dialog>
  );
}
