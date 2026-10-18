import { AetherIcon, Button, Popover, SelectField, type PanelPlacement } from '@aether/ui';

/** Presentation controls only; the CAD shell owns the actual layout state. */
export function CADWorkspaceLayoutPopover({anchor,onClose,toolbarMode,onToolbarMode,panels,onPlacement,onReset}: {
  anchor: HTMLElement | null; onClose: () => void;
  toolbarMode: 'traditional' | 'floating'; onToolbarMode: (mode:'traditional'|'floating')=>void;
  panels: readonly {id:string;label:string;placement:PanelPlacement}[];
  onPlacement: (id:string,placement:PanelPlacement)=>void; onReset:()=>void;
}) {
  return <Popover open={!!anchor} anchor={anchor} onClose={onClose} ariaLabel="Workspace layout" placement="bottom-end">
    <div style={{width:280,maxWidth:'calc(100vw - 48px)',display:'grid',gap:14,padding:14}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <strong>Workspace layout</strong>
        <Button aria-label="Close workspace layout" onClick={onClose}><AetherIcon name="close"/></Button>
      </div>
      <label style={{display:'grid',gridTemplateColumns:'1fr 140px',alignItems:'center',gap:10}}>
        Commands
        <SelectField aria-label="Commands presentation" value={toolbarMode} options={[{value:'traditional',label:'Top ribbon'},{value:'floating',label:'Floating tools'}]} onChange={event=>onToolbarMode(event.target.value as 'traditional'|'floating')}/>
      </label>
      {panels.map(panel=><label key={panel.id} style={{display:'grid',gridTemplateColumns:'1fr 140px',alignItems:'center',gap:10}}>
        {panel.label}
        <SelectField aria-label={`${panel.label} placement`} value={panel.placement}
          options={[{value:'docked',label:panel.id==='inspector'?'Dock right':'Dock left'},{value:'floating',label:'Float'},{value:'hidden',label:'Hidden'}]}
          onChange={event=>onPlacement(panel.id,event.target.value as PanelPlacement)}/>
      </label>)}
      <Button onClick={onReset}>Reset panel placements</Button>
    </div>
  </Popover>;
}
