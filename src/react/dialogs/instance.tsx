/** Compact occurrence editor; geometry, revision checks and history stay in CAD. */
import { useEffect, useRef, useState } from 'react';
import { Button, Checkbox, CoordinateFields, Dialog, FieldRow, TextField } from '@aether/ui';
import { type CADPresentationSnapshot, cadPresentation } from '../../cad-presentation-store';
import { captureInstanceEdit, saveInstanceEdit } from '../../assembly/instance-session';
import { instanceDraft, instancePoseControlled } from '../../assembly/instance-edit';
import { CADQuantityField } from '../CADQuantityField';

export function AssemblyInstanceDialog({ presentation }: { presentation: CADPresentationSnapshot }) {
  return presentation.startDialog === 'edit-component' ? <InstanceEditor/> : null;
}
function InstanceEditor() {
  const [captured] = useState(() => { try { return captureInstanceEdit(); } catch { return null; } });
  const [draft, setDraft] = useState(() => captured ? instanceDraft(captured.instance) : null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const abort = useRef(new AbortController());
  useEffect(() => () => abort.current.abort(), []);
  const close = () => { abort.current.abort(); cadPresentation.dispatch({ type: 'show-start-dialog', dialog: null }); };
  const controlled = !!captured && instancePoseControlled(captured.projection, captured.instance);
  const apply = async () => {
    if (!captured || !draft || busy) return;
    setBusy(true); setError('');
    try { await saveInstanceEdit(captured, draft, abort.current.signal); close(); }
    catch (error) { if (!abort.current.signal.aborted) { setError(error instanceof Error ? error.message : String(error)); setBusy(false); } }
  };
  return <Dialog open title="Component properties" onClose={close} actions={<>
    <Button onClick={close}>Cancel</Button><Button primary disabled={!draft || busy} onClick={() => void apply()}>{busy ? 'Applying…' : 'Apply'}</Button>
  </>}>
    {draft ? <div className="cad-start-form">
      <FieldRow label="Name" htmlFor="instance-name"><TextField id="instance-name" disabled={busy} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })}/></FieldRow>
      {(['positionM', 'rotationRad'] as const).map(field => <CoordinateFields key={field} label={field === 'positionM' ? 'Position' : 'Rotation'} fields={(['X', 'Y', 'Z'] as const).map((axis, index) => ({ axis, control:
        <CADQuantityField family={field === 'positionM' ? 'length' : 'angle'} id={`instance-${field}-${axis}`} aria-label={`${field === 'positionM' ? 'Position' : 'Rotation'} ${axis}`}
          value={draft[field][index]} disabled={busy || controlled} step={field === 'positionM' ? .001 : Math.PI / 180}
          onValueChange={value => { if (value !== null) setDraft({ ...draft, [field]: draft[field].map((v, i) => i === index ? value : v) }); }}/>,
      }))}/>)}
      {controlled && <p className="cad-form-note">Mates control this component’s position. Edit the mate value or suppress the mate to move it freely.</p>}
      <Checkbox label="Ground component" checked={draft.grounded} disabled={busy} onChange={event => setDraft({ ...draft, grounded: event.target.checked })}/>
      <Checkbox label="Visible" checked={draft.visible} disabled={busy} onChange={event => setDraft({ ...draft, visible: event.target.checked })}/>
      <p className="cad-form-note">Position is measured from the Assembly origin. Rotation uses local X, Y, Z axes. Other instances of this Part keep their placement.</p>
    </div> : <p>Select a component in an editable Assembly.</p>}
    {error && <p role="alert">{error}</p>}
  </Dialog>;
}
