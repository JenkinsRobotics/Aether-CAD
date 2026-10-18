import { AppearanceInspector, MaterialBrowser } from '@aether/ui/concept-widgets';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Button, Checkbox, ColorField, FieldRow, InspectorSection, SegmentedControl, SelectField, Slider, TextField } from '@aether/ui';
import { cadAppearance, type CADDisplayStyle } from '../../cad-appearance-store';
import { cadObjectAppearance } from '../../cad-object-appearance';
import { cadSelection } from '../../cad-selection-store';
import { requestCADPropertyPanel } from '../../cad-presentation-store';
import { cadMaterialPresets, renderMaterials, materialValues, matchesMaterial } from '../../cad-render-materials';
import { resolveAppearance } from '../../viewport/appearance-themes';
import { resolvePartDisplay, type PartDisplayOverride } from '../../viewport/part-display';
import { readViewportThemeOverride } from '../../viewport/suite-viewport-theme';
import { Color, Level } from './environment-advanced';

const hex = (value: number) => `#${value.toString(16).padStart(6, '0')}`;
export function ObjectAppearanceControls({initialTarget = 'defaults', selectionRequest}: {initialTarget?: string; selectionRequest?: number} = {}) {
  const appearance = useSyncExternalStore(cadAppearance.subscribe, cadAppearance.snapshot, cadAppearance.snapshot);
  const rows = useSyncExternalStore(cadObjectAppearance.subscribe, cadObjectAppearance.snapshot, cadObjectAppearance.snapshot);
  const selection = useSyncExternalStore(cadSelection.subscribe, cadSelection.snapshot, cadSelection.snapshot);
  const custom = useSyncExternalStore(cadMaterialPresets.subscribe,cadMaterialPresets.snapshot,cadMaterialPresets.snapshot);
  const [target, setTarget] = useState(initialTarget), [tab,setTab] = useState('materials');
  const [preferredPreset,setPreferredPreset]=useState<string>();
  const [name,setName]=useState(''),[message,setMessage]=useState(''),[error,setError]=useState('');
  useEffect(() => {
    if (selectionRequest === undefined) return;
    setTarget('selection');setPreferredPreset(undefined);setMessage('');setError('');
  }, [selectionRequest]);
  const selectedIds = new Set(selection.items.map(item => item.partId));
  const targets = target === 'selection' ? rows.filter(row => selectedIds.has(row.id)) : rows.filter(row => JSON.stringify([row.documentId, row.id]) === target);
  const defaults = target === 'defaults', missing = !defaults && !targets.length;
  const base = resolveAppearance(appearance, readViewportThemeOverride());
  const r = defaults || missing ? base : resolvePartDisplay(base, targets[0].value);
  const values=materialValues(r),library=[...renderMaterials,...custom];
  const preset=library.find(item=>item.id===preferredPreset&&matchesMaterial(item.values,values))??library.find(item=>matchesMaterial(item.values,values));
  const used=library.filter(item=>rows.some(row=>matchesMaterial(item.values,materialValues(resolvePartDisplay(base,row.value))))).map(item=>item.id);
  const assignment=defaults?'Default for all objects':targets.length===1?targets[0].name:`${targets.length} selected objects`;
  const change = (value: PartDisplayOverride) => {
    setMessage('');setError('');
    if (!defaults) { targets.forEach(row => cadObjectAppearance.change(row, value)); return; }
    if (value.color !== undefined) cadAppearance.dispatch({ type: 'set-body-color', color: value.color });
    if (value.opacity !== undefined) cadAppearance.dispatch({ type: 'set-body-opacity', percent: value.opacity * 100 });
    if (value.roughness !== undefined) cadAppearance.dispatch({ type: 'set-roughness', value: value.roughness });
    if (value.metalness !== undefined) cadAppearance.dispatch({ type: 'set-metalness', value: value.metalness });
    if (value.emissiveColor !== undefined) cadAppearance.dispatch({type:'set-advanced',key:'emissiveColor',value:value.emissiveColor});
    if (value.emissiveIntensity !== undefined) cadAppearance.dispatch({type:'set-advanced',key:'emissiveIntensity',value:value.emissiveIntensity});
    if (value.edgeColor !== undefined) cadAppearance.dispatch({ type: 'set-render-color', target: 'edgeColor', color: value.edgeColor });
    if (value.edgeOpacity !== undefined) cadAppearance.dispatch({ type: 'set-edge-opacity', percent: value.edgeOpacity * 100 });
    if (value.edgeWidthPx !== undefined) cadAppearance.dispatch({ type: 'set-advanced', key: 'edgeWidthPx', value: value.edgeWidthPx });
    if (value.edgesVisible !== undefined) cadAppearance.dispatch({ type: 'set-edges-visible', visible: value.edgesVisible });
  };
  const assign=(id:string)=>{const item=library.find(p=>p.id===id);if(!item||missing)return;change(item.values);setPreferredPreset(id);setTab('appearance');setMessage(`${item.name} applied to ${assignment}.`);};
  const mixed=targets.length>1 && targets.some(row=>!matchesMaterial(materialValues(resolvePartDisplay(base,row.value)),values));
  return <div aria-label="Object appearance controls">
    <InspectorSection title="Material properties" defaultOpen>
      <FieldRow label="Apply to"><SelectField aria-label="Appearance target" value={target} options={[
        { value: 'selection', label: `Selected objects (${rows.filter(row => selectedIds.has(row.id)).length})` },
        ...rows.map(row => ({ value: JSON.stringify([row.documentId, row.id]), label: row.name })),
        { value: 'defaults', label: 'Default for all objects' },
        ...(missing && target !== 'selection' ? [{ value: target, label: 'Object no longer available', disabled: true }] : []),
      ]} onChange={e => {setTarget(e.target.value);setMessage('');setError('');}} /></FieldRow>
      {missing && <p role="status">Select an object in the viewport or choose one from the list.</p>}
      {targets.length > 1 && <p className="cad-form-note">{mixed?'Mixed materials. ':''}Showing {targets[0].name}. Individual adjustments change only that property on all {targets.length} selected objects.</p>}
      <p className="cad-form-note">{defaults ? 'Default appearance is saved on this device. Part overrides take precedence.' : 'Live part appearance lasts for this session. Save a custom material below to reuse its appearance.'} These controls do not assign engineering density or BOM materials.</p>
    </InspectorSection>
    <fieldset disabled={missing} className="cad-material-fields">
      <SegmentedControl ariaLabel="Material properties tabs" value={tab} options={[{id:'materials',label:'Material'},{id:'appearance',label:'Appearance'}]} onChange={setTab}/>
      <FieldRow label="Material"><SelectField aria-label="Render material" value={preset?.id??'custom'} options={[
        {value:'custom',label:'Custom appearance',disabled:true},...library.map(p=>({value:p.id,label:`${p.name} · ${p.finish}`})),
      ]} onChange={e=>assign(e.target.value)}/></FieldRow>
      {tab==='materials' && <MaterialBrowser showTabs={false} materials={library} selectedID={preset?.id} usedIDs={used} assignmentLabel={assignment} onSelect={assign}/>}
      {tab==='appearance' && <>
        <AppearanceInspector key={target} showTessellation={false} value={{color:values.color,opacity:values.opacity*100,tessellation:'auto'}} onChange={value => {
          if (value.color.toLowerCase() !== values.color) change({color:value.color});
          if (value.opacity !== values.opacity*100) change({opacity:value.opacity/100});
        }}/>
        <InspectorSection title="Surface finish" defaultOpen>
          <FieldRow label="Finish"><SelectField aria-label="Object finish" value={({'.8':'matte','.5':'satin','.2':'gloss'} as Record<string,string>)[String(r.finish.roughness).replace(/^0/,'')]??'custom'}
            options={[{value:'matte',label:'Matte'},{value:'satin',label:'Satin'},{value:'gloss',label:'Gloss'},{value:'custom',label:'Manual',disabled:true}]}
            onChange={e=>change({roughness:({matte:.8,satin:.5,gloss:.2} as Record<string,number>)[e.target.value]})}/></FieldRow>
          <FieldRow label="Gloss"><Slider ariaLabel="Object gloss" min={0} max={100} step={1} unit="%" value={Math.round((1-r.finish.roughness)*100)} onChange={value=>change({roughness:Number((1-value/100).toFixed(2))})}/></FieldRow>
          <FieldRow label="Roughness"><Slider ariaLabel="Object roughness" min={0} max={100} step={1} unit="%" value={Number((r.finish.roughness * 100).toFixed(2))} onChange={value => change({ roughness: value / 100 })} /></FieldRow>
          <FieldRow label="Metallic"><Slider ariaLabel="Object metallic" min={0} max={100} step={1} unit="%" value={r.finish.metalness * 100} onChange={value => change({ metalness: value / 100 })} /></FieldRow>
          <p className="cad-form-note">Gloss is the inverse of roughness. Opacity previews transparency; it does not simulate glass refraction.</p>
        </InspectorSection>
        <InspectorSection title="Self illumination">
          <FieldRow label="Color"><ColorField ariaLabel="Emission color" value={values.emissiveColor} onChange={emissiveColor=>change({emissiveColor})}/></FieldRow>
          <FieldRow label="Strength"><Slider ariaLabel="Emission strength" value={values.emissiveIntensity} min={0} max={5} step={.05} unit="×" onChange={emissiveIntensity=>change({emissiveIntensity})}/></FieldRow>
          <p className="cad-form-note">Brightens this surface without casting light onto neighboring parts.</p>
        </InspectorSection>
        <InspectorSection title="Save custom material" defaultOpen>
          <FieldRow label="Name"><TextField aria-label="Custom material name" value={name} maxLength={80} placeholder="My brushed finish" onChange={e=>setName(e.target.value)}/></FieldRow>
          <div className="cad-view-actions"><Button disabled={!name.trim()} onClick={()=>{try{setPreferredPreset(cadMaterialPresets.save(name,values));setMessage(`Saved “${name.trim()}” on this device.`);setName('');setError('');}catch(e){setError((e as Error).message);}}}>Save material</Button>
            {preset?.id.startsWith('custom:') && <Button onClick={()=>{try{cadMaterialPresets.remove(preset.id);setMessage('Removed from library. Current appearance kept.');setError('');}catch(e){setError((e as Error).message);}}}>Remove saved material</Button>}</div>
        </InspectorSection>
      </>}
      {tab==='appearance' && <InspectorSection title="Model edges" defaultOpen={false}>
        <Checkbox label="Show object edges" checked={defaults ? appearance.edgesVisible : (targets[0]?.value.edgesVisible ?? appearance.edgesVisible)} onChange={e => change({ edgesVisible: e.target.checked })} />
        <FieldRow label="Color"><ColorField ariaLabel="Object edge color" value={hex(r.edgeColor)} onChange={edgeColor => change({ edgeColor })} /></FieldRow>
        <FieldRow label="Opacity"><Slider ariaLabel="Object edge opacity" min={0} max={100} step={1} unit="%" value={appearance.displayStyle === 'hidden-line' ? 100 : r.edgeOpacity * 100} disabled={appearance.displayStyle === 'hidden-line'} onChange={value => change({ edgeOpacity: value / 100 })} /></FieldRow>
        <FieldRow label="Thickness"><Slider ariaLabel="Object edge thickness" min={.5} max={8} step={.25} unit="px" value={r.edgeWidth} onChange={edgeWidthPx => change({ edgeWidthPx })} /></FieldRow>
        <p className="cad-form-note">Edges appear in Shaded with edges, Ghost or Hidden line. Hidden line keeps opaque edges.</p>
      </InspectorSection>}
      {!defaults && <Button onClick={() => {targets.forEach(row => cadObjectAppearance.change(row, {}, true));setMessage('Restored environment defaults.');}}>Use environment defaults</Button>}
    </fieldset>
    {message&&<p role="status">{message}</p>}{error&&<p role="alert">{error}</p>}
  </div>;
}

export function RenderDisplayControls(){
  const appearance=useSyncExternalStore(cadAppearance.subscribe,cadAppearance.snapshot,cadAppearance.snapshot);
  const base=resolveAppearance(appearance,readViewportThemeOverride());
  return <InspectorSection title="Display and quality" defaultOpen>
    <FieldRow label="Style"><SelectField aria-label="Object display style" value={appearance.displayStyle} options={[
      {value:'shaded-edges',label:'Shaded with edges'},{value:'shaded',label:'Shaded'},{value:'wireframe',label:'Wireframe'},{value:'hidden-line',label:'Hidden line'},{value:'ghost',label:'Ghost'},
    ]} onChange={e=>cadAppearance.dispatch({type:'set-display-style',style:e.target.value as CADDisplayStyle})}/></FieldRow>
    <Checkbox label="Show model edges" checked={appearance.edgesVisible} onChange={e=>cadAppearance.dispatch({type:'set-edges-visible',visible:e.target.checked})}/>
    <FieldRow label="Render scale"><Slider ariaLabel="Render resolution" min={50} max={150} step={25} unit="%" value={(appearance.renderScale??1)*100} onChange={value=>cadAppearance.dispatch({type:'set-advanced',key:'renderScale',value:value/100})}/></FieldRow>
    <p className="cad-form-note">Higher resolution smooths edges and uses more graphics memory. Multisampling stays enabled; this does not change CAD geometry.</p>
    <Checkbox label="Studio reflections" checked={appearance.studioReflections!==false} onChange={e=>cadAppearance.dispatch({type:'set-advanced',key:'studioReflections',value:e.target.checked})}/>
    <Level field="reflectionIntensityPercent" label="Reflection intensity" value={appearance.reflectionIntensityPercent??45}/>
    <Level field="reflectionRotationDegrees" label="Reflection rotation" value={appearance.reflectionRotationDegrees??0} unit="°"/>
    <p className="cad-form-note">Studio reflections reveal glossy and metallic finishes. Rotation moves the reflected soft lights around the model.</p>
    <Color field="selectionColor" label="Selected geometry" value={base.selectionColor}/>
    <Color field="hoverColor" label="Hovered geometry" value={base.hoverColor}/>
    <Button onClick={()=>requestCADPropertyPanel('view')}>Camera and display controls</Button>
  </InspectorSection>;
}
