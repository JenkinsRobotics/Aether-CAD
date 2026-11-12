import { AetherIcon, Button, Popover, SelectField, type PanelPlacement } from '@aether/ui';

/** Presentation controls only; the CAD shell owns the actual layout state. */
export function CADWorkspaceLayoutPopover({anchor,onClose,panels,onPlacement,onReset}: {
  anchor: HTMLElement | null; onClose: () => void;
  panels: readonly {id:string;label:string;placement:PanelPlacement}[];
  onPlacement: (id:string,placement:PanelPlacement)=>void; onReset:()=>void;
}) {
  return <Popover open={!!anchor} anchor={anchor} onClose={onClose} ariaLabel="Workspace layout" placement="bottom-end">
    <div style={{width:280,maxWidth:'calc(100vw - 48px)',display:'grid',gap:14,padding:14}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <strong>Workspace layout</strong>
        <Button aria-label="Close workspace layout" onClick={onClose}><AetherIcon name="close"/></Button>
      </div>
      {panels.map(panel=><label key={panel.id} style={{display:'grid',gridTemplateColumns:'1fr 140px',alignItems:'center',gap:10}}>
        {panel.label}
        <SelectField aria-label={`${panel.label} placement`} value={panel.placement}
          options={[{value:'docked',label:panel.id==='properties'?'Dock right':'Dock left'},{value:'floating',label:'Float'},{value:'hidden',label:'Hidden'}]}
          onChange={event=>onPlacement(panel.id,event.target.value as PanelPlacement)}/>
      </label>)}
      <Button onClick={onReset}>Reset panel placements</Button>
    </div>
  </Popover>;
}
