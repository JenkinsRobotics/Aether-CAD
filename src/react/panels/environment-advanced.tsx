import { Checkbox, ColorField, FieldRow, InspectorSection, SelectField, Slider, TextField } from '@aether/ui';
import { useEffect, useState } from 'react';
import { advancedNumberRanges, type AdvancedColorKey, type AdvancedNumberKey } from '../../cad-advanced-appearance';
import { cadAppearance, type CADAppearanceSnapshot } from '../../cad-appearance-store';
import type { ResolvedAppearance } from '../../viewport/appearance-themes';
const hex = (n: number) => `#${n.toString(16).padStart(6,'0')}`;

function NumberControl({ field, label, value, unit = '', step = 1 }: { field: AdvancedNumberKey; label: string; value: number; unit?: string; step?: number }) {
  const [text,setText] = useState(String(value));
  useEffect(()=>setText(String(Number(value.toFixed(3)))),[value]);
  const [min,max]=advancedNumberRanges[field];
  const valid=text.trim()!=='' && Number.isFinite(Number(text)) && Number(text)>=min && Number(text)<=max;
  return <FieldRow label={label}>
    <TextField type="number" aria-label={label} aria-invalid={!valid} min={min} max={max} step={step} value={text}
      onChange={event=>{const next=event.target.value;setText(next);if(next.trim() && Number.isFinite(Number(next)) && Number(next)>=min && Number(next)<=max)cadAppearance.dispatch({type:'set-advanced',key:field,value:Number(next)});}}
      onBlur={()=>{if(!valid)setText(String(value));}} />
    <span>{unit}</span>
  </FieldRow>;
}
export function Level({ field, label, value, unit='%', step=1 }: {field:AdvancedNumberKey;label:string;value:number;unit?:string;step?:number}) {
  const [min,max]=advancedNumberRanges[field];
  return <FieldRow label={label}><Slider ariaLabel={label} min={min} max={max} step={step} unit={unit} value={Number(value.toFixed(2))}
    onChange={value=>cadAppearance.dispatch({type:'set-advanced',key:field,value})}/></FieldRow>;
}
export function Color({field,label,value}:{field:AdvancedColorKey;label:string;value:number|string}) {
  return <FieldRow label={label}><ColorField ariaLabel={label} value={typeof value==='number'?hex(value):value}
    onChange={value=>cadAppearance.dispatch({type:'set-advanced',key:field,value})}/></FieldRow>;
}
export function RenderColor({field,label,value}:{field:'backgroundColor'|'gridMinorColor'|'gridMajorColor'|'edgeColor';label:string;value:number}) {
  return <FieldRow label={label}><ColorField ariaLabel={label} value={hex(value)} onChange={color=>cadAppearance.dispatch({type:'set-render-color',target:field,color})}/></FieldRow>;
}
export function EnvironmentAdvanced({appearance:a,resolved:r}:{appearance:CADAppearanceSnapshot;resolved:ResolvedAppearance}) {
  return <div aria-label="Advanced environment controls">
    <InspectorSection title="Background layers" defaultOpen>
      <FieldRow label="Color transform"><SelectField aria-label="Color transform" value={r.colorTransform} options={[{value:'standard',label:'Standard — exact colors'},{value:'filmic',label:'Filmic — soft highlights'}]}
        onChange={e=>cadAppearance.dispatch({type:'set-advanced',key:'colorTransform',value:e.target.value})}/></FieldRow>
      <p className="cad-form-note">Standard preserves background and guide colors. Filmic compresses bright surfaces and also changes the displayed background and grid colors.</p>
      <FieldRow label="Background style"><SelectField aria-label="Background style" value={r.backgroundMode} options={[{value:'solid',label:'Solid color'},{value:'gradient',label:'Vertical gradient'}]}
        onChange={e=>cadAppearance.dispatch({type:'set-advanced',key:'backgroundMode',value:e.target.value})}/></FieldRow>
      <RenderColor field="backgroundColor" label={r.backgroundMode==='gradient'?'Top color':'Background color'} value={r.background}/>
      {r.backgroundMode==='gradient' && <Color field="backgroundBottomColor" label="Bottom color" value={r.backgroundBottom}/>}
    </InspectorSection>
    <InspectorSection title="Grid spacing and lines" defaultOpen>
      <NumberControl field="gridSpacingMillimeters" label="Grid spacing" value={r.grid.spacing} unit="mm" step={.1}/>
      <NumberControl field="sketchGridSpacingMillimeters" label="Sketch grid spacing" value={r.sketchGridSpacing} unit="mm" step={.1}/>
      <NumberControl field="gridExtentMillimeters" label="Grid extent" value={r.grid.extent} unit="mm"/>
      <NumberControl field="gridMajorEvery" label="Major line every" value={r.grid.majorEvery} unit="cells"/>
      {r.grid.extent/r.grid.spacing>2000 && <p className="cad-form-note">At this spacing, the visible grid is limited to {r.grid.spacing*2000} mm to keep navigation responsive.</p>}
      <RenderColor field="gridMinorColor" label="Minor line color" value={r.gridMinor}/>
      <Level field="gridMinorOpacityPercent" label="Minor line opacity" value={r.gridOpacity*100}/>
      <Level field="gridMinorWidthPx" label="Minor line thickness" value={r.grid.minorWidth} unit="px" step={.25}/>
      <RenderColor field="gridMajorColor" label="Major line color" value={r.gridMajor}/>
      <Level field="gridMajorOpacityPercent" label="Major line opacity" value={r.grid.majorOpacity*100}/>
      <Level field="gridMajorWidthPx" label="Major line thickness" value={r.grid.majorWidth} unit="px" step={.25}/>
      <Color field="gridXAxisColor" label="X axis color" value={r.grid.xColor}/>
      <Color field="gridYAxisColor" label="Y axis color" value={r.grid.yColor}/>
      <Color field="gridZAxisColor" label="Z axis color" value={r.grid.zColor}/>
      <p className="cad-form-note">The two ground axes follow the workspace up direction: X/Y for Z-up, X/Z for Y-up.</p>
      <Level field="gridAxisOpacityPercent" label="Axis line opacity" value={r.grid.axisOpacity*100}/>
      <Level field="gridAxisWidthPx" label="Axis line thickness" value={r.grid.axisWidth} unit="px" step={.25}/>
      <p className="cad-form-note">Opacity is absolute: 100% is fully opaque. Grid spacing changes the visual guide, not sketch snapping. The world grid uses Ground: Grid or Both; the sketch grid follows its sketch plane.</p>
    </InspectorSection>
    <InspectorSection title="Reference and sketch planes" defaultOpen>
      <Color field="planeTopColor" label="Top plane color" value={r.planeTheme.colors.top}/>
      <Color field="planeFrontColor" label="Front plane color" value={r.planeTheme.colors.front}/>
      <Color field="planeRightColor" label="Right plane color" value={r.planeTheme.colors.right}/>
      <Color field="planeCustomColor" label="Custom plane color" value={r.planeTheme.colors.custom}/>
      <Level field="planeFillOpacityPercent" label="Plane fill opacity" value={r.planeTheme.style.fillOpacity*100}/>
      <Level field="planeBorderOpacityPercent" label="Plane border opacity" value={r.planeTheme.style.borderOpacity*100}/>
      <Level field="planeBorderWidthPx" label="Plane border thickness" value={r.planeTheme.style.borderWidthPx} unit="px" step={.25}/>
      <NumberControl field="planeSizeMillimeters" label="Reference plane size" value={r.planeTheme.style.sizeMillimeters} unit="mm"/>
      <Checkbox label="Show plane labels" checked={r.planeTheme.style.labelsVisible} onChange={e=>cadAppearance.dispatch({type:'set-advanced',key:'planeLabelsVisible',value:e.target.checked})}/>
      <Color field="planeLabelColor" label="Plane label color" value={r.planeTheme.style.labelColor}/>
      <Level field="planeLabelOpacityPercent" label="Plane label opacity" value={r.planeTheme.style.labelOpacity*100}/>
      <p className="cad-form-note">Show or hide individual datums in the Features tree. The active sketch retains its own editing area.</p>
    </InspectorSection>
    <InspectorSection title="Sketch curves" defaultOpen>
      <Color field="sketchStrokeColor" label="Sketch curve color" value={r.sketchStroke}/>
      <Level field="sketchLineWidthPx" label="Sketch curve thickness" value={r.sketchLineWidth} unit="px" step={.1}/>
      <p className="cad-form-note">Constraint-state colors remain available while editing a sketch. Model surfaces and edges are in Material properties; selection colors are in Display and quality.</p>
    </InspectorSection>
    <InspectorSection title="Lighting and surface contrast" defaultOpen>
      <Level field="exposure" label="Exposure" value={r.exposure} unit="×" step={.05}/>
      <Level field="ambientLightPercent" label="Ambient intensity" value={a.ambientLightPercent??100}/>
      <Color field="ambientSkyColor" label="Ambient sky" value={r.lights.sky}/>
      <Color field="ambientGroundColor" label="Ambient ground" value={r.lights.ground}/>
      <Level field="keyLightPercent" label="Key light intensity" value={a.keyLightPercent??100}/>
      <Color field="keyLightColor" label="Key light color" value={r.lights.keyColor}/>
      <Level field="keyLightAzimuthDegrees" label="Key light azimuth" value={r.lights.keyAzimuth} unit="°"/>
      <Level field="keyLightElevationDegrees" label="Key light elevation" value={r.lights.keyElevation} unit="°"/>
      <Level field="fillLightPercent" label="Fill light intensity" value={a.fillLightPercent??100}/>
      <Color field="fillLightColor" label="Fill light color" value={r.lights.fillColor}/>
      <Level field="fillLightAzimuthDegrees" label="Fill light azimuth" value={r.lights.fillAzimuth} unit="°"/>
      <Level field="fillLightElevationDegrees" label="Fill light elevation" value={r.lights.fillElevation} unit="°"/>
      <Level field="rimLightPercent" label="Rim light intensity" value={a.rimLightPercent??100}/>
      <Color field="rimLightColor" label="Rim light color" value={r.lights.rimColor}/>
      <Level field="rimLightAzimuthDegrees" label="Rim light azimuth" value={r.lights.rimAzimuth} unit="°"/>
      <Level field="rimLightElevationDegrees" label="Rim light elevation" value={r.lights.rimElevation} unit="°"/>
      <p className="cad-form-note">Light percentages scale the selected lighting preset. Reduce fill and ambient light for stronger surface contrast; increase them for softer shading.</p>
    </InspectorSection>
    <InspectorSection title="Floor" defaultOpen>
      <Color field="floorColor" label="Floor color" value={r.floorColor}/>
      <Level field="floorOpacityPercent" label="Floor opacity" value={r.floorOpacity*100}/>
      <Level field="floorRoughness" label="Floor roughness" value={r.floorRoughness} unit="" step={.01}/>
      <p className="cad-form-note">Visible with Ground: Floor or Both. Contact shadows use the setting on the Presets tab.</p>
    </InspectorSection>
  </div>;
}
