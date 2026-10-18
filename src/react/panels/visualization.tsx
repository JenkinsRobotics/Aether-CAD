import { useState, useSyncExternalStore } from 'react';
import { Button, Checkbox, FieldRow, InspectorSection, SegmentedControl, SelectField, Slider, TextField } from '@aether/ui';
import { cadAppearance, type CADBackgroundPreset, type CADBuiltinEnvironment, type CADFloorMode, type CADLightingPreset } from '../../cad-appearance-store';
import { captureEnvironment, cadEnvironmentPresets } from '../../cad-environment-presets';
import { resolveAppearance } from '../../viewport/appearance-themes';
import { readViewportThemeOverride } from '../../viewport/suite-viewport-theme';
import { EnvironmentAdvanced } from './environment-advanced';
import { ObjectAppearanceControls, RenderDisplayControls } from './object-appearance';
import '../CADInspector.css';
const backgrounds = [ ['cad-light','CAD Light'],['onshape','Onshape'],['graphite','Graphite'],['midnight','Midnight'],['blueprint','Blueprint'] ].map(([value,label])=>({value,label}));
export function VisualizationPanel({active}:{active:boolean}) {
  const appearance=useSyncExternalStore(cadAppearance.subscribe,cadAppearance.snapshot,cadAppearance.snapshot);
  const presets=useSyncExternalStore(cadEnvironmentPresets.subscribe,cadEnvironmentPresets.snapshot,cadEnvironmentPresets.snapshot);
  const [tab,setTab]=useState('presets'),[name,setName]=useState(''),[message,setMessage]=useState(''),[error,setError]=useState('');
  const selected=presets.find(p=>p.id===appearance.activePresetId);
  const resolved=resolveAppearance(appearance,readViewportThemeOverride());
  const modified=selected && JSON.stringify(captureEnvironment(appearance))!==JSON.stringify(captureEnvironment(selected.appearance));
  const save=(update=false)=>{
    try {
      const title=update&&selected?selected.name:name;
      const value=captureEnvironment(); const id=cadEnvironmentPresets.save(title,value,update?selected?.id:undefined);
      cadAppearance.dispatch({type:'apply-saved-preset',id,appearance:value});setName('');setError('');setMessage(`Saved “${title.trim()}” on this device.`);
    } catch(e){setError((e as Error).message);setMessage('');}
  };
  return <section className="cad-property-sheet" hidden={!active} data-panel="rendering">
    <div className="visualization-panel-scroll">
      <InspectorSection title="Environment" defaultOpen>
        <FieldRow label="Preset"><SelectField aria-label="Environment preset" value={selected?`saved:${selected.id}`:appearance.environmentTheme}
          options={[{value:'model-studio',label:'Model Studio'},{value:'fusion360',label:'Fusion 360'},{value:'blender',label:'Blender'},...backgrounds,{value:'aether',label:'Aether'},{value:'high-contrast',label:'High contrast'},{value:'custom',label:'Custom (unsaved)',disabled:true},...presets.map(p=>({value:`saved:${p.id}`,label:`${p.name}${selected?.id===p.id&&modified?' · Modified':''}`}))]}
          onChange={event=>{
            const id=event.target.value;const preset=presets.find(p=>`saved:${p.id}`===id);
            if(preset)cadAppearance.dispatch({type:'apply-saved-preset',id:preset.id,appearance:preset.appearance});
            else cadAppearance.dispatch({type:'apply-environment-theme',theme:id as CADBuiltinEnvironment});setMessage('');setError('');
          }}/></FieldRow>
        <SegmentedControl ariaLabel="Environment controls" value={tab} options={[{id:'presets',label:'Presets'},{id:'advanced',label:'Advanced'},{id:'objects',label:'Defaults'}]} onChange={setTab}/>
      </InspectorSection>
      <InspectorSection title="Save custom preset" defaultOpen>
        <FieldRow label="Name"><TextField aria-label="Custom preset name" placeholder="My CAD environment" value={name} maxLength={80} onChange={e=>setName(e.target.value)}/></FieldRow>
        <div className="cad-view-actions">
          <Button disabled={!name.trim()} onClick={()=>save()}>Save as new preset</Button>
          {selected && <><Button onClick={()=>save(true)}>Update saved preset</Button>{modified && <Button onClick={()=>{cadAppearance.dispatch({type:'apply-saved-preset',id:selected.id,appearance:selected.appearance});setMessage('Saved appearance restored.');setError('');}}>Restore saved preset</Button>}<Button onClick={()=>{
            try{cadEnvironmentPresets.remove(selected.id);cadAppearance.dispatch({type:'apply-saved-preset',id:'',appearance:captureEnvironment()});setMessage('Preset deleted. Current appearance kept.');setError('');}catch(e){setError((e as Error).message);}
          }}>Delete preset</Button></>}
        </div>
        {message&&<p role="status">{message}</p>}{error&&<p role="alert">{error}</p>}
        <p className="cad-form-note">Custom presets save the environment and default object appearance in this browser on this device. Individual object overrides are separate.</p>
      </InspectorSection>
      {appearance.environmentTheme==='fusion360' && <p className="cad-form-note">Fusion 360 inspired: white canvas, neutral gray solids, crisp edges and colored origin planes.</p>}
      {appearance.environmentTheme==='blender' && <p className="cad-form-note">Blender inspired: charcoal canvas, neutral studio shading and colored ground axes.</p>}
      {tab!=='objects' && <RenderDisplayControls/>}
      {tab==='objects'?<ObjectAppearanceControls/>:tab==='advanced'?<EnvironmentAdvanced appearance={appearance} resolved={resolved}/>:<>
        <InspectorSection title="Background" defaultOpen><FieldRow label="Background"><SelectField aria-label="Background" value={appearance.background} options={backgrounds} onChange={e=>cadAppearance.dispatch({type:'set-background',background:e.target.value as CADBackgroundPreset})}/></FieldRow></InspectorSection>
        <InspectorSection title="Lighting and ground" defaultOpen>
          <FieldRow label="Lighting"><SelectField aria-label="Viewport lighting preset" value={appearance.lightingPreset} options={[{value:'studio',label:'Studio'},{value:'softbox',label:'Softbox'},{value:'daylight',label:'Daylight'},{value:'dark-room',label:'Dark room'},{value:'model-studio',label:'Model Studio'}]} onChange={e=>cadAppearance.dispatch({type:'set-lighting-preset',preset:e.target.value as CADLightingPreset})}/></FieldRow>
          <FieldRow label="Environment"><Slider ariaLabel="Environment intensity" min={0} max={200} step={5} unit="%" value={appearance.environmentPercent} onChange={percent=>cadAppearance.dispatch({type:'set-environment-percent',percent})}/></FieldRow>
          <FieldRow label="Ground" layout="stacked"><SegmentedControl ariaLabel="Viewport ground mode" value={appearance.floorMode} options={[{id:'none',label:'None'},{id:'grid',label:'Grid'},{id:'floor',label:'Floor'},{id:'both',label:'Both'}]} onChange={mode=>cadAppearance.dispatch({type:'set-floor-mode',mode:mode as CADFloorMode})}/></FieldRow>
          <FieldRow label="Grid opacity"><Slider ariaLabel="Grid opacity" min={0} max={100} step={1} unit="%" value={resolved.gridOpacity*100} onChange={value=>cadAppearance.dispatch({type:'set-advanced',key:'gridMinorOpacityPercent',value})}/></FieldRow>
          <Checkbox label="Contact shadows" checked={appearance.contactShadowsVisible} onChange={e=>cadAppearance.dispatch({type:'set-contact-shadows-visible',visible:e.target.checked})}/>
          <p className="cad-form-note">Open Advanced to tune each grid layer, plane fill and outline, background gradient, lights and floor. Use Material properties for a selected part, or Defaults for unassigned objects.</p>
        </InspectorSection>
      </>}
    </div>
  </section>;
}
